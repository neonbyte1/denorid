import type { InjectableOptions } from "@denorid/injector";

/**
 * Configuration options for controller registration and routing.
 *
 * This interface extends InjectableOptions to provide additional routing-specific
 * configuration for controllers. It allows you to define the base path(s) and
 * host restrictions for all routes within a controller.
 *
 * @extends InjectableOptions
 */
export interface ControllerOptions extends InjectableOptions {
  /**
   * The base path(s) for all routes in the controller.
   *
   * This path is prepended to all route paths defined in the controller's methods.
   * When multiple paths are provided, the controller registers routes for each path.
   *
   * - Single string: All routes use this base path
   * - Array of strings: Routes are registered under each base path
   * - Undefined: Routes are registered at the root level
   *
   * @default undefined
   */
  path?: string | string[];

  /**
   * Host restriction(s) for the controller's routes.
   *
   * When specified, the controller's routes only respond to requests matching
   * the given host pattern(s). This is useful for multi-tenant applications or
   * subdomain-based routing.
   *
   * - String: Exact host match (e.g., "api.example.com")
   * - RegExp: Pattern matching for dynamic hosts (e.g., /^(.+)\.example\.com$/)
   * - Array: Multiple host patterns, routes respond to any matching pattern
   * - Undefined: No host restriction, routes respond to all hosts
   *
   * @default undefined
   */
  host?: string | RegExp | Array<string | RegExp>;
}
