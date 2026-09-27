export const CONTROLLER_METADATA = Symbol.for("denorid.controller");
export const HTTP_CONTROLLER_METADATA = Symbol.for("denorid.http_controller");
export const CONTROLLER_REQUEST_MAPPING = Symbol.for("denorid.request_mapping");

export const EXCEPTION_FILTER = Symbol.for("denorid.exception_filter");
export const EXCEPTION_FILTER_METADATA = Symbol.for(
  "denorid.exception_filter.metadata",
);

export const MESSAGE_PATTERN_METADATA = Symbol.for(
  "denorid.message_pattern",
);

export const MESSAGE_CONTROLLER_METADATA = Symbol.for(
  "denorid.message_controller",
);

export const CLI_COMMAND_METADATA = Symbol.for("denorid.cli.command");
export const CLI_OPTIONS_METADATA = Symbol.for("denorid.cli.options");

export const WEBSOCKET_GATEWAY = Symbol.for("denorid.websocket_gateway");
export const WEBSOCKET_GATEWAY_OPTIONS = Symbol.for(
  "denorid.websocket_gateway.options",
);
export const WEBSOCKET_SUBSCRIBE_MESSAGE = Symbol.for(
  "denorid.websocket_gateway.subscribe_message",
);
export const WEBSOCKET_MESSAGE_BODY = Symbol.for(
  "denorid.websocket_gateway.message_body",
);
export const WEBSOCKET_SERVER = Symbol.for(
  "denorid.websocket_gateway.server",
);
