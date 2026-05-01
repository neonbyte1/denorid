/**
 * Thrown when a scheduler item (interval, timeout, or cron job) with the
 * given name is already registered.
 */
export class SchedulerItemAlreadyExistsException extends Error {
  /**
   * @param {"Interval" | "Timeout" | "CronJob"} type - The item type.
   * @param {string} name - The duplicate name.
   */
  public constructor(
    type: "Interval" | "Timeout" | "CronJob",
    name: string,
  ) {
    super(`${type} "${name}" is already registered.`);
  }
}

/**
 * Thrown when a scheduler item with the given name cannot be found.
 */
export class SchedulerItemNotFoundException extends Error {
  /**
   * @param {"Interval" | "Timeout" | "CronJob"} type - The item type.
   * @param {string} name - The name that was not found.
   */
  public constructor(
    type: "Interval" | "Timeout" | "CronJob",
    name: string,
  ) {
    super(`${type} "${name}" not found.`);
  }
}
