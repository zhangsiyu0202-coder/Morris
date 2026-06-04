"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";

// 不显示主菜单的全屏路由(受访者端访谈页)。
// "/" 与 "/interview" 均为受访者端访谈页,面向外部受访者,
// 不能挂研究者主菜单(会泄露内部 studies 并破坏受访体验)。
// 其余全部研究者工作台页面共用主菜单。
const FULLSCREEN_ROUTES = ["/", "/interview"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullscreen = FULLSCREEN_ROUTES.some(
    (r) => pathname === r || (r !== "/" && pathname?.startsWith(`${r}/`)),
  );

  if (fullscreen) return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden bg-mauve-50">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
