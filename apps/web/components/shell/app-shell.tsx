"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentResearcher } from "@merism/contracts";
import { Sidebar, type SidebarStudy } from "./sidebar";

// 不显示主菜单的全屏路由。
// "/" 与 "/interview" 均为受访者端访谈页,面向外部受访者,
// 不能挂研究者主菜单(会泄露内部 studies 并破坏受访体验)。
// "/login" "/signup" "/auth/*" 为研究者认证页,登录前不应出现工作台主菜单。
// 其余全部研究者工作台页面共用主菜单。
const FULLSCREEN_ROUTES = ["/", "/interview", "/login", "/signup", "/auth"];

export function AppShell({
  children,
  studies = [],
  researcher = null,
}: {
  children: React.ReactNode;
  studies?: SidebarStudy[];
  researcher?: CurrentResearcher | null;
}) {
  const pathname = usePathname();
  const fullscreen = FULLSCREEN_ROUTES.some(
    (r) => pathname === r || (r !== "/" && pathname?.startsWith(`${r}/`)),
  );

  if (fullscreen) return <>{children}</>;

  const showVerifyBanner =
    researcher && !researcher.emailVerified && !pathname?.startsWith("/settings/account");

  return (
    <div className="flex h-screen overflow-hidden bg-mauve-50">
      <Sidebar studies={studies} researcher={researcher} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {showVerifyBanner ? (
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-mauve-100 px-4 py-2 sm:px-6">
            <p className="font-ui text-body-sm text-ink-800">
              邮箱尚未验证,部分功能可能受限。
            </p>
            <Link
              href="/settings/account"
              className="shrink-0 font-ui text-body-sm text-ink-900 underline-offset-2 hover:underline"
            >
              去验证
            </Link>
          </div>
        ) : null}
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
