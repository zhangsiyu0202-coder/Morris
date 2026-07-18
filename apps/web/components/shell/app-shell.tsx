"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentResearcher } from "@merism/contracts";
import { AssistantDock } from "@/components/assistant/assistant-dock";
import { Sidebar, type SidebarStudy } from "./sidebar";

// 不显示研究者 chrome (Sidebar + Morris dock) 的全屏路由。
// "/" 是公开产品首页，"/interview" 是匿名受访者端访谈页；两者都
//   绝不能挂研究者主菜单或 Morris (会泄露 studies、且 Morris 工具要求
//   研究者会话, 在 interviewee 上下文中调用必 401)。
// "/login" "/signup" "/auth/*" 为研究者认证页,登录前不应出现工作台 chrome。
// 其余研究者工作台页面共用 chrome。
// 借鉴 posthog `Navigation.tsx::mode !== 'full'` 的 layout-level chrome gate。
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

  // Defense-in-depth (mirror of posthog `TABS_REQUIRING_A_TEAM`):
  // 即使路由通过, 没有研究者会话仍不挂 Morris — 任何调用都会被
  // server action 401 拒掉, UI 不该提供入口。
  const showAssistantDock = researcher !== null;

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
      {showAssistantDock ? <AssistantDock /> : null}
    </div>
  );
}
