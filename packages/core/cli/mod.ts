/**
 * Symfony-style console command system for `@denorid/core`.
 *
 * Decorate a class with `@ConsoleCommand({ command: "cache:clear" })`, implement
 * {@linkcode ConsoleCommandInterface.execute}, and register it as a provider in
 * any module that participates in the application. The command is then
 * resolvable by name via {@linkcode ConsoleCommandRunner} (or, more commonly,
 * the `runCommandLine()` helper on the application context).
 *
 * # Example
 *
 * ```ts
 * import { ConsoleCommand, type ConsoleCommandInterface, Option } from "@denorid/core/cli";
 * import { Injectable } from "@denorid/injector";
 *
 * @ConsoleCommand({
 *   command: "cache:clear",
 *   description: "Clears the cache",
 *   options: [{ name: "scope", type: "string", default: "all" }],
 * })
 * export class ClearCacheCommand implements ConsoleCommandInterface {
 *   public async execute({ options }): Promise<number> {
 *     // ... clear cache for `options.scope`
 *     return 0;
 *   }
 * }
 * ```
 *
 * @module
 */
export type {
  ConsoleCommandInput,
  ConsoleCommandInterface,
} from "./command_interface.ts";
export {
  ConsoleCommandRunner,
  type ConsoleCommandRunnerOptions,
  type ConsoleWriter,
} from "./command_runner.ts";
export { ConsoleCommand, Option } from "./decorator.ts";
export type {
  CommandOptions,
  InputOption,
  InputOptionValue,
} from "./options.ts";
