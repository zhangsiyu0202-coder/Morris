"use client";

import { useState } from "react";
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
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
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
export type SidebarStudy = { id: string; title: string; status: StudyStatus };

const DOT: Record<StudyStatus, string> = {
  live: "#10B981",
  draft: "#8B5CF6",
  closed: "#D1D5DB",
};

const COLLAPSED_W = 48;
const EXPANDED_W = 232;

/**
 * Product sidebar, matched to the reference export:
 * collapsed 48px, hover-expanded 232px, compact 13px desktop density.
 */
export function Sidebar({ studies = [] }: { studies?: SidebarStudy[] }) {
  const pathname = usePathname();
  const [hovered, setHovered] = useState(false);
  const expanded = hovered;

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-expanded={expanded}
      style={{
        width: expanded ? EXPANDED_W : COLLAPSED_W,
        transition: "width 180ms cubic-bezier(0.4,0,0.2,1)",
        backgroundColor: "#ffffff",
        borderRight: "1px solid #E5E7EB",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
        height: "100%",
        fontFamily: "'Inter','Helvetica Neue',Arial,sans-serif",
        zIndex: 10,
      }}
    >
        {expanded ? (
          <div className="flex h-full flex-col overflow-y-auto">
            <div
              className="flex items-center justify-between"
              style={{ padding: "14px 16px 10px", cursor: "pointer" }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", whiteSpace: "nowrap" }}>
                NEW concept test demo
              </span>
              <ChevronDown size={14} color="#4B5563" style={{ flexShrink: 0, marginLeft: 6 }} />
            </div>

            <div className="flex flex-col" style={{ padding: "4px 8px" }}>
              {NAV.map((item) => (
                <NavLink key={item.label} item={item} active={pathname === item.href} expanded />
              ))}
            </div>

            <div style={{ height: 1, backgroundColor: "#F3F4F6", margin: "8px 0" }} />

            <div style={{ padding: "4px 8px", flex: 1 }}>
              <div className="flex items-center gap-2" style={{ padding: "6px 10px", marginBottom: 2 }}>
                <BookOpen size={16} strokeWidth={1.8} color="#374151" />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", whiteSpace: "nowrap" }}>
                  Studies
                </span>
              </div>

              {studies.map((study) => {
                const selected = pathname.startsWith(`/studies/${study.id}`);
                return (
                  <Link
                    key={study.id}
                    href={`/studies/${study.id}`}
                    aria-current={selected ? "true" : undefined}
                    className="flex w-full items-center gap-2.5 rounded-md transition-colors"
                    style={{
                      padding: "6px 10px",
                      fontSize: 13,
                      fontWeight: selected ? 500 : 400,
                      color: selected ? "#4F46E5" : "#374151",
                      backgroundColor: selected ? "#EEF2FF" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: DOT[study.status],
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {study.title}
                    </span>
                  </Link>
                );
              })}

              <Link
                href="/home"
                className="flex items-center gap-2 rounded-md"
                style={{
                  padding: "6px 10px",
                  fontSize: 13,
                  color: "#4B5563",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  marginTop: 2,
                }}
              >
                <Plus size={13} strokeWidth={2} />
                新建调研
              </Link>
            </div>

            <div style={{ borderTop: "1px solid #F3F4F6", padding: "12px 16px" }}>
              <div className="flex items-center gap-2.5">
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    backgroundColor: "#F97316",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  O
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", whiteSpace: "nowrap" }}>
                    No Name
                  </div>
                  <div style={{ fontSize: 11, color: "#4B5563", whiteSpace: "nowrap" }}>
                    Outset · Main account
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center" style={{ paddingTop: 10, paddingBottom: 10 }}>
            <div className="mb-3 flex cursor-pointer items-center gap-0.5">
              <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>D</span>
              <ChevronRight size={12} color="#4B5563" strokeWidth={2} />
            </div>

            {NAV.map((item) => (
              <NavLink key={item.label} item={item} active={pathname === item.href} expanded={false} />
            ))}

            <div style={{ width: 28, height: 1, backgroundColor: "#E5E7EB", margin: "8px 0" }} />

            <Link
              href="/home"
              title="Studies"
              style={{
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "#4B5563",
              }}
            >
              <BookOpen size={16} strokeWidth={1.6} />
            </Link>

            <div className="flex-1" />
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", paddingBottom: 4 }}>O</div>
          </div>
        )}
    </aside>
  );
}

function NavLink({ item, active, expanded }: { item: NavItem; active: boolean; expanded: boolean }) {
  const Icon = item.icon;
  if (!expanded) {
    return (
      <Link
        href={item.href}
        title={item.label}
        aria-current={active ? "page" : undefined}
        style={{
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          border: "none",
          background: active ? "#EEF2FF" : "transparent",
          cursor: "pointer",
          color: active ? "#4F46E5" : "#4B5563",
          marginBottom: 1,
        }}
      >
        <Icon size={16} strokeWidth={1.6} />
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className="flex items-center gap-2.5 rounded-md transition-colors"
      style={{
        padding: "7px 10px",
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        color: "#111827",
        backgroundColor: active ? "#F3F4F6" : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={16} strokeWidth={1.8} color={active ? "#4F46E5" : "#374151"} style={{ flexShrink: 0 }} />
      {item.label}
    </Link>
  );
}
