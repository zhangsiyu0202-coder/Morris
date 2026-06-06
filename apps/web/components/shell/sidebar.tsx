"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MessageSquare,
  Lightbulb,
  Sparkles,
  PieChart,
  Bookmark,
  Settings,
  BookOpen,
  Plus,
  Pin,
  PinOff,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

const NAV: NavItem[] = [
  { label: "首页", href: "/home", icon: Home },
  { label: "访谈", href: "/interview", icon: MessageSquare },
  { label: "洞察", href: "/insights", icon: Lightbulb },
  { label: "Morris AI", href: "/assistant", icon: Sparkles },
  { label: "报告", href: "/reports", icon: PieChart },
  { label: "书签", href: "#bookmarks", icon: Bookmark },
  { label: "项目设置", href: "#settings", icon: Settings },
];

type StudyStatus = "live" | "draft" | "closed";
type StudyItem = { id: string; title: string; status: StudyStatus };

const DOT: Record<StudyStatus, string> = {
  live: "bg-positive",
  draft: "bg-mauve-400",
  closed: "bg-ink-200",
};

const STUDIES: StudyItem[] = [
  { id: "st_travel", title: "差旅住宿预订习惯调研", status: "live" },
  { id: "st_onboard", title: "新用户引导体验访谈", status: "live" },
  { id: "st_pricing", title: "订阅定价敏感度研究", status: "closed" },
  { id: "st_mobile", title: "移动端导航可用性测试", status: "draft" },
];

const COLLAPSED_W = 72;
const EXPANDED_W = 264;
const LEAVE_DELAY = 300;

/**
 * 产品侧边栏 —— 三态(设计系统绑定):
 * - Collapsed(默认 72px,内联)
 * - Hover-Expanded(264px,悬浮覆盖于内容之上,不挤压布局)
 * - Pinned(264px,内联,布局重排一次;偏好持久化)
 */
export function Sidebar() {
  const pathname = usePathname();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar.pinned");
    if (saved !== null) setPinned(saved === "1");
  }, []);

  const togglePinned = () => {
    setPinned((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar.pinned", next ? "1" : "0");
      return next;
    });
  };

  const expanded = pinned || hovered;
  const overlay = hovered && !pinned;

  const handleEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHovered(true);
  };
  const handleLeave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setHovered(false), LEAVE_DELAY);
  };

  return (
    // 内联占位:折叠 72px;固定(pinned)时 264px,布局重排一次。
    <div className="relative h-full shrink-0" style={{ width: pinned ? EXPANDED_W : COLLAPSED_W }}>
      <aside
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        data-expanded={expanded}
        style={{ width: expanded ? EXPANDED_W : COLLAPSED_W }}
        className={`absolute inset-y-0 left-0 flex flex-col bg-ink-0 transition-[width] duration-200 ease-out ${
          overlay
            ? "z-40 shadow-lg"
            : "shadow-[inset_-1px_0_0_var(--color-ink-100)]"
        }`}
      >
        {/* 品牌行 + pin 切换 */}
        <div className={`flex h-14 items-center ${expanded ? "gap-2 px-3" : "justify-center px-0"}`}>
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-mauve-100 font-ui text-body-sm font-semibold text-ink-900">
            D
          </span>
          {expanded && (
            <>
              <span className="min-w-0 flex-1 truncate font-ui text-body-sm font-semibold text-ink-900">
                NEW concept test demo
              </span>
              <button
                type="button"
                onClick={togglePinned}
                aria-label={pinned ? "取消固定侧边栏" : "固定侧边栏"}
                aria-pressed={pinned}
                title={pinned ? "取消固定" : "固定侧边栏"}
                className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors ${
                  pinned
                    ? "bg-mauve-200 text-ink-900"
                    : "text-ink-400 hover:bg-ink-100 hover:text-ink-900"
                }`}
              >
                {pinned ? (
                  <PinOff className="size-4" strokeWidth={2} />
                ) : (
                  <Pin className="size-4" strokeWidth={2} />
                )}
              </button>
            </>
          )}
        </div>

        {/* 主导航 */}
        <nav className="flex flex-col gap-0.5 px-2 pt-1">
          {NAV.map((item) => (
            <NavLink
              key={item.label}
              item={item}
              active={pathname === item.href}
              expanded={expanded}
            />
          ))}
        </nav>

        <Divider expanded={expanded} />

        {/* Studies */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={`flex h-9 items-center ${expanded ? "gap-2 px-3" : "justify-center px-0"}`}>
            <BookOpen className="size-[18px] shrink-0 text-ink-600" strokeWidth={2} />
            {expanded && (
              <span className="font-ui text-body-sm font-semibold text-ink-900">Studies</span>
            )}
          </div>

          <div className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-2">
            {STUDIES.map((s) => {
              const selected = pathname.startsWith(`/studies/${s.id}`);
              return (
                <Link
                  key={s.id}
                  href={`/studies/${s.id}`}
                  title={!expanded ? s.title : undefined}
                  aria-current={selected ? "true" : undefined}
                  className={`group flex h-9 items-center rounded-md transition-colors ${
                    expanded ? "gap-3 px-3" : "justify-center px-0"
                  } ${selected ? "bg-mauve-100" : "hover:bg-ink-100"}`}
                >
                  <span className={`size-2 shrink-0 rounded-full ${DOT[s.status]}`} aria-hidden />
                  {expanded && (
                    <span
                      className={`min-w-0 flex-1 truncate font-ui text-body-sm ${
                        selected ? "font-medium text-ink-900" : "text-ink-600"
                      }`}
                    >
                      {s.title}
                    </span>
                  )}
                </Link>
              );
            })}

            <Link
              href="/home"
              title={!expanded ? "新建调研" : undefined}
              className={`flex h-9 items-center rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 ${
                expanded ? "gap-3 px-3" : "justify-center px-0"
              }`}
            >
              <Plus className="size-[18px] shrink-0" strokeWidth={2} />
              {expanded && <span className="font-ui text-body-sm">新建调研</span>}
            </Link>
          </div>
        </div>

        {/* 账户 */}
        <div className="shadow-[inset_0_1px_0_var(--color-ink-100)]">
          <div className={`flex h-16 items-center ${expanded ? "gap-3 px-3" : "justify-center px-0"}`}>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-mauve-400 font-ui text-caption font-semibold text-ink-0">
              O
            </span>
            {expanded && (
              <div className="min-w-0 flex-1">
                <p className="truncate font-ui text-body-sm font-medium text-ink-900">No Name</p>
                <p className="truncate font-ui text-caption text-ink-400">Outset · Main account</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function NavLink({
  item,
  active,
  expanded,
}: {
  item: NavItem;
  active: boolean;
  expanded: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={!expanded ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={`flex h-9 items-center rounded-md transition-colors ${
        expanded ? "gap-3 px-3" : "justify-center px-0"
      } ${active ? "bg-mauve-100 text-ink-900" : "text-ink-600 hover:bg-ink-100"}`}
    >
      <Icon
        className={`size-[18px] shrink-0 ${active ? "text-ink-900" : "text-ink-400"}`}
        strokeWidth={2}
      />
      {expanded && <span className="font-ui text-body-sm">{item.label}</span>}
    </Link>
  );
}

function Divider({ expanded }: { expanded: boolean }) {
  return <div className={`my-2 h-px bg-ink-100 ${expanded ? "mx-3" : "mx-3"}`} />;
}
