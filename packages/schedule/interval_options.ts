/**
 * Options for the {@linkcode Interval} decorator.
 */
export interface IntervalOptions {
  /**
   * Explicit name under which the interval is registered in
   * {@linkcode SchedulerRegistry}. When omitted or empty, the name defaults
   * to `ClassName_methodName` with every character other than ASCII
   * letters, digits, `_`, `-` and space replaced by `_`.
   */
  name?: string;
}
