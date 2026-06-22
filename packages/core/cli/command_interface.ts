import type { InputOptionValue } from "./options.ts";

/**
 * Parsed runtime values handed to {@linkcode ConsoleCommandInterface.execute}.
 *
 * Keys correspond to declared {@linkcode InputOption.name} entries. Array-valued
 * options always materialise as an array, scalar options resolve to a single primitive.
 */
export interface ConsoleCommandInput {
  /** Resolved option values, keyed by the option's long name. */
  options: Record<string, InputOptionValue | InputOptionValue[]>;
  /** Trailing positional arguments captured after `--` or unrecognised tokens. */
  args: string[];
}

/**
 * Contract implemented by every console command.
 *
 * Implementations are normal `@Injectable()` providers; the `@ConsoleCommand`
 * decorator handles the wiring so all DI features (injection, lifecycle hooks)
 * are available.
 */
export interface ConsoleCommandInterface {
  /**
   * Executes the command body.
   *
   * @param {ConsoleCommandInput} input - Parsed CLI arguments.
   * @returns {Promise<number>|number} The process exit code (0 = success).
   */
  execute(input: ConsoleCommandInput): Promise<number> | number;
}
