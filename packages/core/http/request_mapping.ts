import type { MethodDecorator } from "@denorid/injector";
import { createRequestMappingDecorator } from "./_request_mapping.ts";
import { HttpMethod } from "./method.ts";

type RouteDecoratorFactory = (path?: string | string[]) => MethodDecorator;

function createRequestMapping(
  method: HttpMethod,
): RouteDecoratorFactory {
  return (path: string | string[] = "/"): MethodDecorator => {
    return createRequestMappingDecorator({
      name: HttpMethod[method].charAt(0).toUpperCase() +
        HttpMethod[method].slice(1).toLowerCase(),
      initializer: (entry): void => {
        entry.method = method;
        entry.path = path;
      },
    });
  };
}

/**
 * Route handler (method) decorator. Routes HTTP POST requests to the specified path.
 */
export const Get: RouteDecoratorFactory = createRequestMapping(HttpMethod.GET);

/**
 * Route handler (method) decorator. Routes HTTP GET requests to the specified path.
 */
export const Post: RouteDecoratorFactory = createRequestMapping(
  HttpMethod.POST,
);

/**
 * Route handler (method) decorator. Routes HTTP PUT requests to the specified path.
 */
export const Put: RouteDecoratorFactory = createRequestMapping(HttpMethod.PUT);

/**
 * Route handler (method) decorator. Routes HTTP PATCH requests to the specified path.
 */
export const Patch: RouteDecoratorFactory = createRequestMapping(
  HttpMethod.PATCH,
);

/**
 * Route handler (method) decorator. Routes HTTP DELETE requests to the specified path.
 */
export const Delete: RouteDecoratorFactory = createRequestMapping(
  HttpMethod.DELETE,
);

/**
 * Route handler (method) decorator. Routes HTTP OPTIONS requests to the specified path.
 */
export const Options: RouteDecoratorFactory = createRequestMapping(
  HttpMethod.OPTIONS,
);

/**
 * Route handler (method) decorator. Routes HTTP HEAD requests to the specified path.
 */
export const Head: RouteDecoratorFactory = createRequestMapping(
  HttpMethod.HEAD,
);
