"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";

// 不显示主菜单的全屏路由(受访者端访谈页等外部页面)。
// "/" 与 "/interview" 均为受访端,不挂内部主菜单。
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
