"use client";

/**
 * Cross-component conversations-list cache backed by SWR (Vercel 官方).
 *
 * 替换早期自写的 EventTarget bus + useEffect 拉取模式. 选 SWR 而不是 TanStack
 * Query 的理由:
 *  - Vercel 自家, 与 Next.js / AI SDK 同生态;
 *  - 极简 API: useSWR(key, fetcher) 给出 data/error/isLoading, mutate(key)
 *    全局触发 revalidate;
 *  - 包小, 没多余功能;
 *  - 内置 SSR-safe + 自动 cleanup, 不需要 mountedRef 之类的 guard.
 *
 * 设计取舍:
 *  - 一个进程内的 conversations 列表用同一个 cache key, 任何 mutation 后调
 *    `useInvalidateConversations()` 返回的 callback 即可同时刷新
 *    `ConversationHistory` / `HistoryPreview` / 任何调用了 `useConversations()`
 *    的组件;
 *  - **hook-based invalidator** 而不是 module-level `mutate(KEY)`: 让 invalidator
 *    用 `useSWRConfig().mutate` (scope 到当前 SWRConfig provider) 而不是顶层
 *    `swr` import 的全局 mutate。这样测试可以用 `<SWRConfig value={{provider:
 *    () => new Map()}}>` 完全隔离每次 render 的 cache, 不需要担心 in-flight
 *    fetcher / dedupe 跨测试泄漏;生产代码默认走 global provider, 行为一致。
 *  - `revalidateOnFocus: false`: 对话列表不需要 tab 切回前台时刷新, 避免无谓
 *    的 Appwrite 调用;
 *  - `revalidateOnReconnect: true`: 离线再上线刷一次, 保证不丢漂移.
 *
 * 来源: https://swr.vercel.app/docs/getting-started + https://swr.vercel.app/docs/mutation
 */

import useSWR, { useSWRConfig, type SWRResponse } from "swr";
import { useCallback } from "react";

import { listConversations } from "@/lib/conversations/actions";
import type { ConversationListItem } from "@merism/contracts";

/** SWR cache key. 不带任何参数; 当前 Morris 列表对单个登录研究员唯一. */
export const CONVERSATIONS_KEY = "morris-conversations" as const;

/**
 * 拉取 + 订阅当前研究员的 conversation 列表. SWR 内部完成去重 / 缓存 /
 * 自动 cleanup, 调用方只读 `data` / `error` / `isLoading` / `mutate`.
 *
 * 返回 SWRResponse 直接透出, 让调用方使用全部 SWR 能力 (mutate / isValidating 等).
 */
export function useConversations(): SWRResponse<ConversationListItem[], Error> {
  return useSWR<ConversationListItem[], Error>(CONVERSATIONS_KEY, () => listConversations(), {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });
}

/**
 * Hook returning a stable invalidator callback for the conversations cache.
 *
 * 用 `useSWRConfig().mutate` 而不是顶层 `swr` import 的 `mutate`, 这样
 * invalidator 走当前 SWRConfig provider — 测试里用 isolated provider 时
 * invalidator 与 useConversations() 用同一份 cache, 不会发生"测试隔离 cache
 * 但 invalidator 打到全局 cache, mutation 不触发组件 refetch"的错配。
 *
 * 生产代码默认走 global provider, 行为与曾经的 module-level mutate(KEY) 一致。
 *
 * Stability: 返回值用 `useCallback` 包过, 依赖 SWR 的 `mutate` 引用 (SWR 内部
 * 保证 mutate 在同一个 provider 下引用稳定)。这样 consumer 把 invalidate 放进
 * `useEffect` / `useCallback` 的 deps 不会触发无限循环。
 *
 * Usage:
 *   const invalidate = useInvalidateConversations();
 *   await createConversation();
 *   await invalidate();
 */
export function useInvalidateConversations(): () => Promise<unknown> {
  const { mutate } = useSWRConfig();
  return useCallback(() => mutate(CONVERSATIONS_KEY), [mutate]);
}
