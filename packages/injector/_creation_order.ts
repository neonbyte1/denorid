/**
 * Creation sequence of the instances tracked by any container, so lifecycle
 * sweeps across containers run dependencies before (bootstrap) or after
 * (shutdown) their consumers.
 *
 * @internal
 */
const creationOrder = new WeakMap<object, number>();

/**
 * The sequence number of the latest recorded creation.
 *
 * @internal
 */
let lastCreation = 0;

/**
 * Checks whether `value` can be recorded (objects and functions).
 *
 * @param {unknown} value - The value to check
 * @returns {boolean} `true` for objects and functions, `false` for primitives.
 *
 * @internal
 */
function isRecordable(value: unknown): value is object {
  return (typeof value === "object" && value !== null) ||
    typeof value === "function";
}

/**
 * Records `instance` as created now, unless it was recorded before (a value
 * tracked by several containers keeps its first position). Primitives are
 * ignored.
 *
 * @param {unknown} instance - The created instance
 *
 * @internal
 */
export function recordCreation(instance: unknown): void {
  if (isRecordable(instance) && !creationOrder.has(instance)) {
    creationOrder.set(instance, ++lastCreation);
  }
}

/**
 * Returns the recorded instances among `instances`, oldest first. Primitives
 * and unrecorded values are left out.
 *
 * @param {Iterable<unknown>} instances - The instances to sort
 * @returns {object[]} The recorded instances in creation order.
 *
 * @internal
 */
export function sortByCreation(instances: Iterable<unknown>): object[] {
  const recorded: object[] = [];

  for (const instance of instances) {
    if (isRecordable(instance) && creationOrder.has(instance)) {
      recorded.push(instance);
    }
  }

  return recorded.sort((a, b) => creationOrder.get(a)! - creationOrder.get(b)!);
}
