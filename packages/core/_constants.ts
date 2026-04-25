export const CONTROLLER_METADATA = Symbol.for("denorid.controller");
export const HTTP_CONTROLLER_METADATA = Symbol.for("denorid.http_controller");
export const CONTROLLER_REQUEST_MAPPING = Symbol.for("denorid.request_mapping");

export const EXCEPTION_FILTER = Symbol.for("denorid.exception_filter");
export const EXCEPTION_FILTER_METADATA = Symbol.for(
  "denorid.exception_filter.metadata",
);

export const MESSAGE_PATTERN_METADATA: unique symbol = Symbol.for(
  "denorid.message_pattern",
);

export const MESSAGE_CONTROLLER_METADATA: unique symbol = Symbol.for(
  "denorid.message_controller",
);
