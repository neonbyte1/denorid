/**
 * Thrown when a method is called in an unsupported execution context.
 */
export class ContextNotAvailableException extends Error {
  /**
   * @param {string} contextName - Name of the current execution context.
   * @param {string} forbiddenMethod - Method that was illegally invoked.
   * @param {string | undefined} expectedMethod - Method that should be used instead.
   */
  public constructor(
    contextName: string,
    forbiddenMethod: string,
    expectedMethod: string | undefined,
  ) {
    super(
      `${forbiddenMethod}() is not available in ${contextName} context.${
        expectedMethod ? ` Use ${expectedMethod}() instead.` : ""
      }`,
    );
  }
}
