import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContextData {
  id: string;
  instances: Map<unknown, unknown>;
}

const requestContextStorage = new AsyncLocalStorage<RequestContextData>();

export function getRequestContext(): RequestContextData | undefined {
  return requestContextStorage.getStore();
}

export function getRequestId(): string | undefined {
  return getRequestContext()?.id;
}

export function isInRequestContext(): boolean {
  return getRequestContext() !== undefined;
}

export function runInRequestContext<T>(
  requestId: string,
  fn: () => T,
): T {
  const context: RequestContextData = {
    id: requestId,
    instances: new Map(),
  };
  return requestContextStorage.run(context, fn);
}

export function runInRequestContextAsync<T>(
  requestId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const context: RequestContextData = {
    id: requestId,
    instances: new Map(),
  };
  return requestContextStorage.run(context, fn);
}
