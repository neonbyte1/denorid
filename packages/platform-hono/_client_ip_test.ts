import type { Context } from "@hono/hono";
import { assertEquals, assertThrows } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { describe, it } from "node:test";
import { createClientIpResolver } from "./_client_ip.ts";
import type { ClientIpOptions, TrustProxy } from "./adapter.ts";

describe(createClientIpResolver.name, () => {
  function makeCtx(env: unknown, headers: HeadersInit = {}): Context {
    const raw = new Request("http://localhost/", { headers });

    return {
      env,
      req: {
        raw,
        header: (name: string) => raw.headers.get(name) ?? undefined,
      },
    } as unknown as Context;
  }

  function resolveIp(
    options: ClientIpOptions,
    socket: string,
    forwarded?: string,
  ): string {
    const headers: HeadersInit = forwarded === undefined
      ? {}
      : { "x-forwarded-for": forwarded };

    return createClientIpResolver(options)(
      makeCtx({ remoteAddr: { hostname: socket } }, headers),
    );
  }

  function isTrusted(trustProxy: TrustProxy, address: string): boolean {
    return resolveIp({ trustProxy }, address, "203.0.113.9") !== address;
  }

  describe("socket peer address", () => {
    it("reads remoteAddr from the Deno.serve handler info", () => {
      assertEquals(
        createClientIpResolver()(
          makeCtx({ remoteAddr: { hostname: "192.168.1.42", port: 443 } }),
        ),
        "192.168.1.42",
      );
    });

    it("returns '0.0.0.0' when the Deno.serve remoteAddr carries no hostname", () => {
      assertEquals(
        createClientIpResolver()(
          makeCtx({ remoteAddr: { transport: "unix", path: "/tmp/app.sock" } }),
        ),
        "0.0.0.0",
      );
    });

    it("asks the Bun.serve server for the address of the original request", () => {
      const server = {
        requestIP: spy((_request: Request) => ({
          address: "198.51.100.7",
          family: "IPv4",
          port: 54321,
        })),
      };
      const ctx = makeCtx(server);

      assertEquals(createClientIpResolver()(ctx), "198.51.100.7");
      assertSpyCall(server.requestIP, 0, { args: [ctx.req.raw], self: server });
    });

    it("returns '0.0.0.0' when the Bun.serve server cannot resolve the address", () => {
      assertEquals(
        createClientIpResolver()(makeCtx({ requestIP: () => null })),
        "0.0.0.0",
      );
    });

    it("reads the socket remoteAddress from the @hono/node-server bindings", () => {
      assertEquals(
        createClientIpResolver()(
          makeCtx({
            incoming: { socket: { remoteAddress: "198.51.100.8" } },
            outgoing: {},
          }),
        ),
        "198.51.100.8",
      );
    });

    it("returns '0.0.0.0' when the @hono/node-server socket is already gone", () => {
      assertEquals(
        createClientIpResolver()(makeCtx({ incoming: {}, outgoing: {} })),
        "0.0.0.0",
      );
    });

    it("returns '0.0.0.0' for unrecognized bindings", () => {
      assertEquals(createClientIpResolver()(makeCtx({})), "0.0.0.0");
    });

    it("returns '0.0.0.0' when the app was invoked without bindings", () => {
      assertEquals(createClientIpResolver()(makeCtx(undefined)), "0.0.0.0");
    });

    it("returns '0.0.0.0' when the socket address is no IP address", () => {
      assertEquals(resolveIp({}, "localhost"), "0.0.0.0");
    });
  });

  describe("normalization", () => {
    const cases: [string, string][] = [
      ["::ffff:127.0.0.1", "127.0.0.1"],
      ["::ffff:7f00:1", "127.0.0.1"],
      ["::ff00:1", "::ff00:1"],
      ["::1.2.3.4", "::102:304"],
      ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
      ["fe80::1%eth0", "fe80::1"],
      ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2:3:4:5:6"],
      ["2001:db8:0:1:2:3:4:5", "2001:db8:0:1:2:3:4:5"],
      ["1:0:0:2:0:0:3:4", "1::2:0:0:3:4"],
      ["1:0:0:2:0:0:0:3", "1:0:0:2::3"],
      ["::", "::"],
      ["1::", "1::"],
      ["[2001:db8::1]:8080", "2001:db8::1"],
      ["[::1]", "::1"],
      ["203.0.113.9:1234", "203.0.113.9"],
      ["  203.0.113.9  ", "203.0.113.9"],
    ];

    for (const [input, expected] of cases) {
      it(`formats ${JSON.stringify(input)} as ${expected}`, () => {
        assertEquals(resolveIp({}, input), expected);
      });
    }

    for (const input of ["[::1", "[::1]:port", "01.2.3.4", "1.2.3.4%eth0"]) {
      it(`rejects ${JSON.stringify(input)}`, () => {
        assertEquals(resolveIp({}, input), "0.0.0.0");
      });
    }
  });

  describe("forwarded addresses", () => {
    it("ignores the forwarding header by default", () => {
      assertEquals(resolveIp({}, "127.0.0.1", "203.0.113.9"), "127.0.0.1");
    });

    it("ignores the forwarding header when no proxy is trusted", () => {
      assertEquals(
        resolveIp({ trustProxy: false }, "127.0.0.1", "203.0.113.9"),
        "127.0.0.1",
      );
    });

    it("returns the leftmost address when every proxy is trusted", () => {
      assertEquals(
        resolveIp({ trustProxy: true }, "127.0.0.1", "6.6.6.6, 203.0.113.9"),
        "6.6.6.6",
      );
    });

    it("returns the socket address when a trusted peer forwards nothing", () => {
      assertEquals(resolveIp({ trustProxy: true }, "127.0.0.1"), "127.0.0.1");
    });

    it("returns the address the given number of hops away", () => {
      const forwarded = "6.6.6.6, 203.0.113.9, 10.0.0.2";

      assertEquals(
        resolveIp({ trustProxy: 0 }, "127.0.0.1", forwarded),
        "127.0.0.1",
      );
      assertEquals(
        resolveIp({ trustProxy: 1 }, "127.0.0.1", forwarded),
        "10.0.0.2",
      );
      assertEquals(
        resolveIp({ trustProxy: 2 }, "127.0.0.1", forwarded),
        "203.0.113.9",
      );
      assertEquals(
        resolveIp({ trustProxy: 9 }, "127.0.0.1", forwarded),
        "6.6.6.6",
      );
    });

    it("skips trusted proxies and ignores addresses the client prepended", () => {
      assertEquals(
        resolveIp(
          { trustProxy: ["loopback", "10.0.0.0/8"] },
          "127.0.0.1",
          "6.6.6.6, 203.0.113.9, 10.0.0.2",
        ),
        "203.0.113.9",
      );
    });

    it("ignores the forwarding header of an untrusted peer", () => {
      assertEquals(
        resolveIp({ trustProxy: ["loopback"] }, "198.51.100.1", "6.6.6.6"),
        "198.51.100.1",
      );
    });

    it("ends the walk at the proxy that forwarded a malformed address", () => {
      assertEquals(
        resolveIp({ trustProxy: true }, "127.0.0.1", "203.0.113.9, unknown"),
        "127.0.0.1",
      );
      assertEquals(
        resolveIp({ trustProxy: true }, "127.0.0.1", "1.2.3.4, , 10.0.0.2"),
        "10.0.0.2",
      );
    });

    it("normalizes forwarded addresses", () => {
      assertEquals(
        resolveIp({ trustProxy: 1 }, "127.0.0.1", " [2001:DB8::1]:443 "),
        "2001:db8::1",
      );
    });

    it("joins repeated forwarding headers in order", () => {
      const headers = new Headers();

      headers.append("x-forwarded-for", "6.6.6.6");
      headers.append("x-forwarded-for", "203.0.113.9");

      assertEquals(
        createClientIpResolver({ trustProxy: 1 })(
          makeCtx({ remoteAddr: { hostname: "127.0.0.1" } }, headers),
        ),
        "203.0.113.9",
      );
    });

    it("reads the configured header", () => {
      const resolve = createClientIpResolver({
        trustProxy: 1,
        header: "CF-Connecting-IP",
      });
      const ctx = makeCtx({ remoteAddr: { hostname: "127.0.0.1" } }, {
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "6.6.6.6",
      });

      assertEquals(resolve(ctx), "203.0.113.9");
    });

    it("asks a trust function about every hop until it declines", () => {
      const trust = spy((address: string) => address !== "203.0.113.9");

      assertEquals(
        resolveIp(
          { trustProxy: trust },
          "::ffff:127.0.0.1",
          "6.6.6.6, 203.0.113.9, 10.0.0.2",
        ),
        "203.0.113.9",
      );
      assertSpyCalls(trust, 3);
      assertSpyCall(trust, 0, { args: ["127.0.0.1", 0] });
      assertSpyCall(trust, 1, { args: ["10.0.0.2", 1] });
      assertSpyCall(trust, 2, { args: ["203.0.113.9", 2] });
    });
  });

  describe("trusted proxy list", () => {
    it("expands loopback", () => {
      assertEquals(isTrusted(["loopback"], "127.10.0.1"), true);
      assertEquals(isTrusted(["loopback"], "::1"), true);
      assertEquals(isTrusted(["loopback"], "128.0.0.1"), false);
    });

    it("expands linklocal", () => {
      assertEquals(isTrusted(["linklocal"], "169.254.3.4"), true);
      assertEquals(isTrusted(["linklocal"], "febf::1"), true);
      assertEquals(isTrusted(["linklocal"], "fec0::1"), false);
    });

    it("expands uniquelocal", () => {
      assertEquals(isTrusted(["uniquelocal"], "10.1.2.3"), true);
      assertEquals(isTrusted(["uniquelocal"], "172.31.255.255"), true);
      assertEquals(isTrusted(["uniquelocal"], "172.32.0.1"), false);
      assertEquals(isTrusted(["uniquelocal"], "192.168.0.1"), true);
      assertEquals(isTrusted(["uniquelocal"], "fd12::1"), true);
      assertEquals(isTrusted(["uniquelocal"], "fe00::1"), false);
    });

    it("matches single addresses exactly", () => {
      assertEquals(isTrusted(["198.51.100.1"], "198.51.100.1"), true);
      assertEquals(isTrusted(["198.51.100.1"], "198.51.100.2"), false);
      assertEquals(isTrusted(["2001:db8::1"], "2001:db8::1"), true);
    });

    it("matches IPv4-mapped peers against IPv4 ranges", () => {
      assertEquals(isTrusted(["10.0.0.0/8"], "::ffff:10.0.0.1"), true);
    });

    it("never matches across address families", () => {
      assertEquals(isTrusted(["0.0.0.0/0"], "::1"), false);
      assertEquals(isTrusted(["::/0"], "127.0.0.1"), false);
      assertEquals(isTrusted(["0.0.0.0/0"], "198.51.100.1"), true);
    });

    it("ignores host bits of a range", () => {
      assertEquals(isTrusted(["10.1.2.3/8"], "10.200.0.1"), true);
    });

    it("accepts surrounding whitespace", () => {
      assertEquals(isTrusted([" 10.0.0.0/8 "], "10.0.0.1"), true);
    });
  });

  describe("validation", () => {
    for (const hops of [-1, 1.5, Number.NaN, Infinity]) {
      it(`rejects the hop count ${hops}`, () => {
        assertThrows(
          () => createClientIpResolver({ trustProxy: hops }),
          RangeError,
          "non-negative integer",
        );
      });
    }

    for (
      const entry of [
        "10.0.0.0/33",
        "::/129",
        "10.0.0.0/",
        "10.0.0.0/abc",
        "10.0.0.0/8/8",
        "example.com",
        "constructor",
      ]
    ) {
      it(`rejects the trusted proxy ${JSON.stringify(entry)}`, () => {
        assertThrows(
          () => createClientIpResolver({ trustProxy: [entry] }),
          TypeError,
          `Invalid trusted proxy "${entry}"`,
        );
      });
    }

    for (const header of ["", "x forwarded for"]) {
      it(`rejects the header ${JSON.stringify(header)}`, () => {
        assertThrows(
          () => createClientIpResolver({ header }),
          TypeError,
          "Invalid client IP header",
        );
      });
    }
  });
});
