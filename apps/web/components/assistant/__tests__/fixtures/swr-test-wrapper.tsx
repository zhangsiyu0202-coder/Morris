/**
 * SWR test wrapper — gives every render an isolated cache (`provider: () =>
 * new Map()`) + zero deduping. Tests can use successive `mockResolvedValueOnce`
 * calls without state bleed across tests; each `render()` starts with a fresh
 * cache.
 *
 * Requires `useInvalidateConversations()` (hook-based scoped invalidator)
 * rather than a module-level `mutate(KEY)` — otherwise the invalidator targets
 * the GLOBAL cache and misses the isolated cache, breaking
 * "click-delete-then-refetch" flows. See `use-conversations.ts` for the
 * production-side hook.
 *
 * Use as: `render(<Component />, { wrapper: SWRTestWrapper })`.
 */

import { SWRConfig } from "swr";
import type { ReactNode } from "react";

export function SWRTestWrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}
