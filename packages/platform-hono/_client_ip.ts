import type { Context } from "@hono/hono";
import { isIP } from "node:net";
import type { ClientIpOptions, TrustProxy, TrustProxyFn } from "./adapter.ts";

/** Returned when the socket peer address is unknown. */
const UNKNOWN_ADDRESS = "0.0.0.0";

/** Header field name token (RFC 9110, section 5.6.2). */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** `[address]` or `[address]:port`, as used for IPv6 addresses with a port. */
const BRACKETED = /^\[([^\]]+)\](?::\d{1,5})?$/;

/** `a.b.c.d:port`, as appended by some proxies. */
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;

/** Named ranges accepted in a trusted proxy list. */
const NAMED_RANGES: Record<string, readonly string[]> = {
  loopback: ["127.0.0.0/8", "::1/128"],
  linklocal: ["169.254.0.0/16", "fe80::/10"],
  uniquelocal: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
};

/**
 * Superset of the `c.env` bindings passed by the servers `HonoAdapter` starts:
 * the `Deno.serve` handler info (`remoteAddr`), the `Bun.serve` server
 * (`requestIP`) and the `@hono/node-server` bindings (`incoming`).
 */
interface ServeBindings {
  /** Peer address of the connection (Deno). */
  remoteAddr?: { hostname?: string };
  /** Resolves the peer address of the original request (Bun). */
  requestIP?(request: Request): { address: string } | null;
  /** Raw `node:http` request exposing the socket (Node.js). */
  incoming?: { socket?: { remoteAddress?: string } };
}

/** Network address with the number of leading bits that have to match. */
interface IpRange {
  bytes: Uint8Array;
  prefix: number;
}

/**
 * Reads the socket peer address from the runtime specific `c.env` bindings.
 *
 * @param {Context} ctx - Hono context of the current request.
 * @return {string | undefined} The peer address, or `undefined` when unknown.
 */
function getRemoteAddress(ctx: Context): string | undefined {
  // Hono types `c.env` per app; the adapter serves an untyped app, so the shape
  // is only known from the serving runtime and every field is checked below.
  const env = ctx.env as ServeBindings | null | undefined;

  if (env?.remoteAddr) {
    return env.remoteAddr.hostname;
  }

  if (typeof env?.requestIP === "function") {
    return env.requestIP(ctx.req.raw)?.address;
  }

  return env?.incoming?.socket?.remoteAddress;
}

/**
 * Parses a valid IPv6 address without zone index into its 16 bytes.
 *
 * @param {string} value - IPv6 address, optionally ending in an IPv4 address.
 * @return {Uint8Array} The address bytes.
 */
function parseIPv6(value: string): Uint8Array {
  let text = value;

  if (text.includes(".")) {
    const colon = text.lastIndexOf(":");
    const [a, b, c, d] = text.slice(colon + 1).split(".").map(Number);

    text = `${text.slice(0, colon + 1)}${((a << 8) | b).toString(16)}:${
      ((c << 8) | d).toString(16)
    }`;
  }

  const [head, tail] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups = tail === undefined ? left : [
    ...left,
    ...new Array<string>(8 - left.length - right.length).fill("0"),
    ...right,
  ];
  const bytes = new Uint8Array(16);

  groups.forEach((group, index) => {
    const value = parseInt(group, 16);

    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });

  return bytes;
}

/**
 * Parses an IP address into its bytes. IPv4-mapped IPv6 addresses
 * (`::ffff:a.b.c.d`) yield the IPv4 address, IPv6 zone indexes are dropped.
 *
 * @param {string} value - The address to parse.
 * @return {Uint8Array | undefined} 4 or 16 bytes, or `undefined` when `value`
 * is no IP address.
 */
function parseIp(value: string): Uint8Array | undefined {
  const version = isIP(value);

  if (version === 4) {
    return Uint8Array.from(value.split("."), Number);
  }

  if (version === 0) {
    return undefined;
  }

  const bytes = parseIPv6(value.split("%", 1)[0]);
  const mapped = bytes.subarray(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff && bytes[11] === 0xff;

  return mapped ? bytes.slice(12) : bytes;
}

/**
 * Formats address bytes in their canonical text form: dotted decimal for IPv4,
 * RFC 5952 for IPv6.
 *
 * @param {Uint8Array} bytes - 4 or 16 address bytes.
 * @return {string} The formatted address.
 */
function formatIp(bytes: Uint8Array): string {
  if (bytes.length === 4) {
    return bytes.join(".");
  }

  const groups = Array.from(
    { length: 8 },
    (_, index) => (bytes[index * 2] << 8) | bytes[index * 2 + 1],
  );
  let start = -1;
  let length = 1;

  // Compress the longest run of two or more zero groups, the first one on ties.
  for (let index = 0; index < 8; index++) {
    let end = index;

    while (groups[end] === 0) {
      end++;
    }

    if (end - index > length) {
      start = index;
      length = end - index;
    }

    index = end;
  }

  const hex = groups.map((group) => group.toString(16));

  if (start === -1) {
    return hex.join(":");
  }

  return `${hex.slice(0, start).join(":")}::${
    hex.slice(start + length).join(":")
  }`;
}

/**
 * Normalizes an address taken from a socket or a forwarding header: surrounding
 * whitespace, brackets and ports are removed and the address is formatted
 * canonically.
 *
 * @param {string} value - The raw address.
 * @return {string | undefined} The canonical address, or `undefined` when
 * `value` is no IP address.
 */
function normalizeIp(value: string): string | undefined {
  const text = value.trim();
  const bytes = parseIp(
    BRACKETED.exec(text)?.[1] ?? IPV4_WITH_PORT.exec(text)?.[1] ?? text,
  );

  return bytes === undefined ? undefined : formatIp(bytes);
}

/**
 * Parses a trusted proxy entry (`address` or `address/prefix`).
 *
 * @param {string} entry - The entry to parse.
 * @return {IpRange} The parsed range.
 * @throws {TypeError} When the entry is no address or CIDR range.
 */
function parseRange(entry: string): IpRange {
  const [address, bits, ...rest] = entry.trim().split("/");
  const bytes = parseIp(address);
  const max = (bytes?.length ?? 0) * 8;
  const prefix = bits === undefined
    ? max
    : /^\d{1,3}$/.test(bits)
    ? Number(bits)
    : NaN;

  if (bytes === undefined || rest.length > 0 || !(prefix <= max)) {
    throw new TypeError(`Invalid trusted proxy "${entry}"`);
  }

  return { bytes, prefix };
}

/**
 * Checks whether an address lies within a range.
 *
 * @param {Uint8Array} bytes - The address bytes.
 * @param {IpRange} range - The range to check against.
 * @return {boolean} `true` when the address is part of the range.
 */
function inRange(bytes: Uint8Array, range: IpRange): boolean {
  if (bytes.length !== range.bytes.length) {
    return false;
  }

  const whole = range.prefix >> 3;

  for (let index = 0; index < whole; index++) {
    if (bytes[index] !== range.bytes[index]) {
      return false;
    }
  }

  const mask = (0xff00 >> (range.prefix & 7)) & 0xff;

  return (bytes[whole] & mask) === (range.bytes[whole] & mask);
}

/**
 * Turns the trusted proxy configuration into a predicate.
 *
 * @param {TrustProxy} trust - The configuration.
 * @return {TrustProxyFn} Decides whether an address is a trusted proxy.
 * @throws {RangeError} When a hop count is no non-negative integer.
 * @throws {TypeError} When a list entry is no address or CIDR range.
 */
function compileTrustProxy(trust: TrustProxy): TrustProxyFn {
  if (typeof trust === "function") {
    return trust;
  }

  if (typeof trust === "boolean") {
    return () => trust;
  }

  if (typeof trust === "number") {
    if (!Number.isInteger(trust) || trust < 0) {
      throw new RangeError(
        `Trusted proxy hop count must be a non-negative integer, got ${trust}`,
      );
    }

    return (_address, hop) => hop < trust;
  }

  const ranges = trust
    .flatMap((entry) =>
      Object.hasOwn(NAMED_RANGES, entry) ? NAMED_RANGES[entry] : [entry]
    )
    .map(parseRange);

  return (address) => {
    // Only normalized addresses reach trust functions, parsing cannot fail.
    const bytes = parseIp(address) as Uint8Array;

    return ranges.some((range) => inRange(bytes, range));
  };
}

/**
 * Creates the function resolving the client address of a request.
 *
 * Starting at the socket peer, the addresses of the forwarding header are
 * walked from right to left while the current address is a trusted proxy. The
 * first untrusted address is the client; when every address is trusted, the
 * leftmost one is. A malformed forwarded address ends the walk at the proxy
 * that sent it.
 *
 * @param {ClientIpOptions} [options] - Trusted proxies and forwarding header.
 * @return {(ctx: Context) => string} Resolves the canonical client address,
 * `"0.0.0.0"` when the socket peer is unknown.
 * @throws {RangeError} When `trustProxy` is an invalid hop count.
 * @throws {TypeError} When `trustProxy` lists an invalid address or `header`
 * is no valid header name.
 */
export function createClientIpResolver(
  options: ClientIpOptions = {},
): (ctx: Context) => string {
  const trust = compileTrustProxy(options.trustProxy ?? false);
  const header = options.header ?? "x-forwarded-for";

  if (!HEADER_NAME.test(header)) {
    throw new TypeError(`Invalid client IP header "${header}"`);
  }

  return (ctx) => {
    let address = normalizeIp(getRemoteAddress(ctx) ?? "");

    if (address === undefined) {
      return UNKNOWN_ADDRESS;
    }

    if (!trust(address, 0)) {
      return address;
    }

    const forwarded = ctx.req.header(header)?.split(",") ?? [];

    for (let hop = 1; hop <= forwarded.length; hop++) {
      const next = normalizeIp(forwarded[forwarded.length - hop]);

      if (next === undefined) {
        return address;
      }

      address = next;

      if (!trust(address, hop)) {
        return address;
      }
    }

    return address;
  };
}
