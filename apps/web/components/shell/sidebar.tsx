"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MessageSquare,
  Lightbulb,
  PieChart,
  Bookmark,
  Settings,
  BookOpen,
  Plus,
  ChevronsLeft,
  ChevronDown,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

const NAV: NavItem[] = [
  { label: "Home", href: "/", icon: Home },
  { label: "Conversations", href: "/interview", icon: MessageSquare },
  { label: "Insights", href: "/assistant", icon: Lightbulb },
  { label: "Reports", href: "/report", icon: PieChart },
  { label: "Bookmarks", href: "#bookmarks", icon: Bookmark },
  { label: "Project Settings", href: "#settings", icon: Settings },
];

type StudyStatus = "live" | "draft" | "closed";

type StudyItem = { id: string; title: string; status: StudyStatus };

// 状态点颜色:仅在此处引入语义色,其余保持中性。
const DOT: Record<StudyStatus, string> = {
  live: "bg-positive", // 进行中 — 低饱和青绿
  draft: "bg-mauve-400", // 进行中草稿 — 莫兰迪点缀
  closed: "bg-ink-200", // 已停用 — 中性灰
};

const STUDIES: StudyItem[] = [
  { id: "st_travel", title: "差旅住宿预订习惯调研", status: "live" },
  { id: "st_onboard", title: "新用户引导体验访谈", status: "live" },
  { id: "st_pricing", title: "订阅定价敏感度研究", status: "closed" },
  { id: "st_mobile", title: "移动端导航可用性测试", status: "draft" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [activeStudy, setActiveStudy] = useState("st_travel");

  return (
    <aside
      data-collapsed={collapsed}
      // 白底为主;右侧用 inset 阴影代替边框(无投影、无外框)
      className="flex h-screen flex-col bg-ink-0 shadow-[inset_-1px_0_0_var(--color-ink-100)] transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? 68 : 264 }}
    >
      {/* 头部:项目名 + 折叠切换 */}
      <div className="flex h-14 items-center gap-2 px-3">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="展开侧边栏"
            title="展开侧边栏"
            className="mx-auto grid size-9 place-items-center rounded-md bg-mauve-100 font-ui text-body-sm font-semibold text-ink-900 transition-colors hover:bg-mauve-200"
          >
            D
          </button>
        ) : (
          <>
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-mauve-100 font-ui text-caption font-semibold text-ink-900">
              D
            </span>
            <span className="min-w-0 flex-1 truncate font-ui text-body-sm font-semibold text-ink-900">
              NEW concept test demo
            </span>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="折叠侧边栏"
              title="折叠侧边栏"
              className="grid size-7 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-mauve-50 hover:text-ink-700"
            >
              <ChevronsLeft className="size-4" strokeWidth={2} />
            </button>
          </>
        )}
      </div>

      {/* 主导航 */}
      <nav className="flex flex-col gap-0.5 px-2 pt-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <NavLink key={item.label} item={item} active={active} collapsed={collapsed} />
          );
        })}
      </nav>

      <Divider />

      {/* Studies 区 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className={`flex h-9 items-center px-3 ${collapsed ? "justify-center" : "gap-2"}`}
        >
          <BookOpen className="size-[18px] shrink-0 text-ink-700" strokeWidth={2} />
          {!collapsed && (
            <span className="font-ui text-body-sm font-semibold text-ink-900">Studies</span>
          )}
        </div>

        <div className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {STUDIES.map((s) => {
            const selected = activeStudy === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveStudy(s.id)}
                title={collapsed ? s.title : undefined}
                aria-current={selected ? "true" : undefined}
                className={`group flex h-9 items-center rounded-md text-left transition-colors ${
                  collapsed ? "justify-center px-0" : "gap-3 px-3"
                } ${
                  selected ? "bg-mauve-100" : "hover:bg-mauve-50"
                }`}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${DOT[s.status]}`}
                  aria-hidden
                />
                {!collapsed && (
                  <span
                    className={`min-w-0 flex-1 truncate font-ui text-body-sm ${
                      selected ? "font-medium text-ink-900" : "text-ink-700"
                    }`}
                  >
                    {s.title}
                  </span>
                )}
              </button>
            );
          })}

          {/* 功能按钮:新增 study */}
          <button
            type="button"
            title={collapsed ? "Add new study" : undefined}
            className={`flex h-9 items-center rounded-md text-ink-400 transition-colors hover:bg-mauve-50 hover:text-ink-700 ${
              collapsed ? "justify-center px-0" : "gap-3 px-3"
            }`}
          >
            <Plus className="size-[18px] shrink-0" strokeWidth={2} />
            {!collapsed && <span className="font-ui text-body-sm">Add new study</span>}
          </button>
        </div>
      </div>

      {/* 底部账户 */}
      <div className="shadow-[inset_0_1px_0_var(--color-ink-100)]">
        <div className={`flex h-16 items-center px-3 ${collapsed ? "justify-center" : "gap-3"}`}>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-mauve-400 font-ui text-caption font-semibold text-ink-0">
            O
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate font-ui text-body-sm font-medium text-ink-900">No Name</p>
              <p className="truncate font-ui text-caption text-ink-400">Outset · Main account</p>
            </div>
          )}
          {!collapsed && (
            <ChevronDown className="size-4 shrink-0 text-ink-400" strokeWidth={2} />
          )}
        </div>
      </div>
    </aside>
  );
}

function NavLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={`flex h-9 items-center rounded-md transition-colors ${
        collapsed ? "justify-center px-0" : "gap-3 px-3"
      } ${active ? "bg-mauve-100 text-ink-900" : "text-ink-700 hover:bg-mauve-50"}`}
    >
      <Icon
        className={`size-[18px] shrink-0 ${active ? "text-ink-900" : "text-ink-400"}`}
        strokeWidth={2}
      />
      {!collapsed && <span className="font-ui text-body-sm">{item.label}</span>}
    </Link>
  );
}

function Divider() {
  return <div className="mx-3 my-2 h-px bg-ink-100" />;
}
