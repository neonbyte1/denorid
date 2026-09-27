/** A path parameter of a path template. */
export interface PathParameter {
  /** Name of the parameter. */
  name: string;
  /** Anchored pattern of a `:name{pattern}` parameter. */
  pattern?: string;
}

/** An OpenAPI path template, e.g. `/users/{id}`, with its parameters. */
export interface PathTemplate {
  /** The path template. */
  path: string;
  /** Parameters in path order. */
  parameters: PathParameter[];
}

/** A `:name`, `:name{pattern}` or optional `:name?` segment. */
const PARAMETER_SEGMENT = /^:([^{}?]+)(?:\{(.+)\})?(\?)?$/;

/**
 * Splits a route path at the slashes that are not part of a `{pattern}`.
 *
 * @param {string} path - The route path.
 * @return {string[]} The non-empty segments.
 */
function splitSegments(path: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let segment = "";

  for (const char of path) {
    if (char === "/" && depth === 0) {
      segments.push(segment);
      segment = "";
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}" && depth > 0) {
      depth--;
    }

    segment += char;
  }

  segments.push(segment);

  return segments.filter((part) => part !== "");
}

/**
 * Converts a registered route path to OpenAPI path templates.
 *
 * - `:name` becomes `{name}`.
 * - `:name{pattern}` becomes `{name}` with the anchored pattern.
 * - An optional `:name?` yields one template without and one with the
 *   segment, since OpenAPI path parameters are always required.
 * - Other segments, including `*`, are kept as they are.
 *
 * @param {string} path - The route path, e.g. `/users/:id{[0-9]+}`.
 * @return {PathTemplate[]} The templates, e.g. `/users/{id}`.
 */
export function toPathTemplates(path: string): PathTemplate[] {
  let templates: PathTemplate[] = [{ path: "", parameters: [] }];

  for (const segment of splitSegments(path)) {
    const match = PARAMETER_SEGMENT.exec(segment);

    if (match === null) {
      templates = templates.map((template) => ({
        path: `${template.path}/${segment}`,
        parameters: template.parameters,
      }));
      continue;
    }

    const [, name, pattern, optional] = match;
    const parameter: PathParameter = pattern === undefined
      ? { name }
      : { name, pattern: `^(?:${pattern})$` };
    const withParameter = templates.map((template) => ({
      path: `${template.path}/{${name}}`,
      parameters: [...template.parameters, parameter],
    }));

    templates = optional === undefined
      ? withParameter
      : [...templates, ...withParameter];
  }

  return templates.map((template) => ({
    path: template.path === "" ? "/" : template.path,
    parameters: template.parameters,
  }));
}
