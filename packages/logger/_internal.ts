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

export const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  day: "2-digit",
  month: "2-digit",
});
