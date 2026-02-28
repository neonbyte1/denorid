/**
 * Enumeration of HTTP request methods supported by the framework.
 *
 * The enum covers the most commonly used HTTP methods for RESTful API design and
 * web application routing.
 */
export enum HttpMethod {
  /**
   * HTTP GET method for retrieving resources.
   *
   * Used for read-only operations that should not modify server state.
   * GET requests are idempotent and cacheable.
   */
  GET = 0,

  /**
   * HTTP POST method for creating new resources.
   *
   * Used for operations that create new resources or submit data for processing.
   * POST requests are not idempotent and typically not cacheable.
   */
  POST,

  /**
   * HTTP PUT method for updating or replacing resources.
   *
   * Used for operations that replace an entire resource with new data.
   * PUT requests are idempotent.
   */
  PUT,

  /**
   * HTTP PATCH method for partially updating resources.
   *
   * Used for operations that modify specific fields of a resource without
   * replacing the entire resource. PATCH requests may or may not be idempotent
   * depending on the implementation.
   */
  PATCH,

  /**
   * HTTP DELETE method for removing resources.
   *
   * Used for operations that delete resources from the server.
   * DELETE requests are idempotent.
   */
  DELETE,

  /**
   * HTTP OPTIONS method for describing communication options.
   *
   * Used to determine which HTTP methods and headers are supported by a resource.
   * Commonly used for CORS preflight requests.
   */
  OPTIONS,

  /**
   * HTTP HEAD method for retrieving resource metadata.
   *
   * Similar to GET but returns only headers without the response body.
   * Used for checking if a resource exists or retrieving metadata without
   * downloading the entire resource.
   */
  HEAD,
}
