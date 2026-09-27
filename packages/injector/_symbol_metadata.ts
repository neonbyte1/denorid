/**
 * Shape of a constructor that may or may not expose the well-known
 * `Symbol.metadata` symbol.
 */
export interface SymbolMetadataHost {
  metadata?: symbol;
}

/**
 * Installs `Symbol.metadata` on `host` when the runtime does not provide it.
 *
 * Deno ships `Symbol.metadata` natively, Bun and Node.js do not. Without it,
 * TC39 decorator metadata is either never attached (Bun, TypeScript helpers)
 * or attached under `Symbol.for("Symbol.metadata")` (esbuild / swc helpers
 * used by JSR), while every reader in denorid looks it up via
 * `target[Symbol.metadata]`. Using the registered `Symbol.for` key keeps both
 * paths consistent.
 *
 * @param {SymbolMetadataHost} host - The object receiving the symbol (normally `Symbol`).
 * @returns {void}
 */
export function installSymbolMetadata(host: SymbolMetadataHost): void {
  host.metadata ??= Symbol.for("Symbol.metadata");
}

installSymbolMetadata(Symbol as SymbolMetadataHost);
