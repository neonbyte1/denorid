import type { MessageOptions } from "./message_options.ts";

export interface MessageMetadata extends MessageOptions {
  method: string | symbol;
}
