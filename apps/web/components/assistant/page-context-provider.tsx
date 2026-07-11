"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  EMPTY_PAGE_CONTEXT,
  type PageContext,
} from "@/lib/assistant/page-context";

interface PageContextHandle {
  /** 当前 PageContext 快照(用于 React 渲染依赖)。 */
  context: PageContext;
  /** 始终持有最新值的 ref(用于 transport 等命令式钩子)。 */
  ref: { readonly current: PageContext };
  /** 合并写入(局部更新);新值覆盖旧值。 */
  set: (patch: Partial<PageContext>) => void;
  /** 整体替换。 */
  replace: (next: PageContext) => void;
}

const PageContextHandleCtx = createContext<PageContextHandle | null>(null);

/**
 * 给 Morris 路由层提供"当前页面状态"的 React 容器。
 *
 * 各使用页面通过 `usePageContextSetter()` 写入 surveyId / sessionId 等;
 * `Conversation` 在构造 transport 时通过 `usePageContextRef()` 拿到一个
 * 始终读最新值的 ref, 在 `prepareSendMessagesRequest` 里把 PageContext
 * 注入到请求体。
 */
export function PageContextProvider({ children }: { children: ReactNode }) {
  const [context, setContextState] = useState<PageContext>(EMPTY_PAGE_CONTEXT);
  const ref = useRef<PageContext>(context);

  const set = useCallback((patch: Partial<PageContext>) => {
    setContextState((prev) => {
      const next: PageContext = { ...prev, ...patch };
      ref.current = next;
      return next;
    });
  }, []);

  const replace = useCallback((next: PageContext) => {
    ref.current = next;
    setContextState(next);
  }, []);

  const handle = useMemo<PageContextHandle>(
    () => ({ context, ref, set, replace }),
    [context, set, replace],
  );

  return (
    <PageContextHandleCtx.Provider value={handle}>{children}</PageContextHandleCtx.Provider>
  );
}

function useHandle(): PageContextHandle {
  const h = useContext(PageContextHandleCtx);
  if (!h) {
    // 不强制要求 Provider 必存在: 没有 Provider 时, 各页面是只读的"无上下文"状态。
    // 这让把 PageContextProvider 装到 layout 后再逐步在子页面用 setter, 不会触发 throw。
    return {
      context: EMPTY_PAGE_CONTEXT,
      ref: { current: EMPTY_PAGE_CONTEXT },
      set: () => undefined,
      replace: () => undefined,
    };
  }
  return h;
}

/** 读取当前 PageContext(渲染依赖)。 */
export function usePageContext(): PageContext {
  return useHandle().context;
}

/** 写入或合并 PageContext。 */
export function usePageContextSetter() {
  const { set, replace } = useHandle();
  return { set, replace };
}

/** 拿到 PageContext 的 ref。命令式读取(不会触发渲染)。 */
export function usePageContextRef(): { readonly current: PageContext } {
  return useHandle().ref;
}
