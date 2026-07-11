import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request / run / session-local runtime context.
 *
 * Node's AsyncLocalStorage is the official stable primitive for propagating
 * per-request state across async boundaries.
 * Source: https://nodejs.org/api/async_context.html#class-asynclocalstorage
 */
export interface RuntimeContext {
  traceId: string;
}

const runtimeContextStorage = new AsyncLocalStorage<RuntimeContext>();

export function runWithRuntimeContext<T>(context: RuntimeContext, fn: () => T): T {
  return runtimeContextStorage.run(context, fn);
}

export function getRuntimeContext(): RuntimeContext | undefined {
  return runtimeContextStorage.getStore();
}

export function getRuntimeTraceId(): string | undefined {
  return runtimeContextStorage.getStore()?.traceId;
}
