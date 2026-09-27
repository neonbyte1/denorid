export const isPlainObject = (fn: unknown): fn is object => {
  if (typeof fn !== "object" || fn === null || fn === undefined) {
    return false;
  }
  const proto = Object.getPrototypeOf(fn);
  if (proto === null) {
    return true;
  }
  const ctor = Object.prototype.hasOwnProperty.call(proto, "constructor") &&
    proto.constructor;
  return (
    typeof ctor === "function" &&
    ctor instanceof ctor &&
    Function.prototype.toString.call(ctor) ===
      Function.prototype.toString.call(Object)
  );
};

export const DEFAULT_DEPTH = 5;

/**
 * Creates a `JSON.stringify` replacer that runs `convert` on every value and
 * replaces references to an object that is still being serialised (a cycle)
 * with `"[Circular]"`. Objects referenced more than once without forming a
 * cycle are serialised every time.
 *
 * The returned function relies on `JSON.stringify` passing the holder object
 * as `this`, so create a fresh replacer for every `JSON.stringify` call.
 *
 * @param {(key: string, value: unknown) => unknown} convert - Converts a single value (e.g. `bigint` to `string`).
 * @return {(this: unknown, key: string, value: unknown) => unknown} The replacer.
 */
export const createCircularSafeReplacer = (
  convert: (key: string, value: unknown) => unknown,
): (this: unknown, key: string, value: unknown) => unknown => {
  // objects on the path from the root to the value currently serialised
  const ancestors: object[] = [];

  return function (this: unknown, key: string, raw: unknown): unknown {
    const value = convert(key, raw);

    if (typeof value !== "object" || value === null) {
      return value;
    }

    while (ancestors.length > 0 && ancestors.at(-1) !== this) {
      ancestors.pop();
    }

    if (ancestors.includes(value)) {
      return "[Circular]";
    }

    ancestors.push(value);

    return value;
  };
};

export const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  day: "2-digit",
  month: "2-digit",
});
