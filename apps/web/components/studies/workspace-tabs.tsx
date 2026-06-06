"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Study 工作台 Tab 导航。用真正的 App Router 路由切换(取代 Make 的
 * useState 开关),active 态由 usePathname 推断。
 */

const TABS = [
  { slug: "overview", label: "概览" },
  { slug: "guide", label: "提纲" },
  { slug: "screener", label: "筛选问卷" },
  { slug: "recruit", label: "招募" },
  { slug: "results", label: "结果" },
] as const;

export function WorkspaceTabs({ studyId }: { studyId: string }) {
  const pathname = usePathname();
  const base = `/studies/${studyId}`;

  return (
    <nav className="flex shrink-0 items-end gap-1 border-b border-ink-200 px-4">
      {TABS.map((tab) => {
        const href = `${base}/${tab.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.slug}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`relative px-2.5 py-2 font-ui text-body-sm transition-colors ${
              active
                ? "font-medium text-ink-900"
                : "text-ink-400 hover:text-ink-700"
            }`}
          >
            {tab.label}
            {active && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-ink-900" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
