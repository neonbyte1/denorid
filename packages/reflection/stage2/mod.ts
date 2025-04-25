import { Reflection } from "./reflection.ts";

export * from "./reflection.ts";
export * from "./types.ts";

// TypeScript expect the metadata API to be on the global Reflect namespace.
// Removing this line will result in undefined results from metadata keys like
// - "design:paramtypes"
// - "design:returntype"
// - "design:type"

if (!(Reflect as Record<string, unknown>).metadata) {
  Object.assign(Reflect, Reflection);
}
