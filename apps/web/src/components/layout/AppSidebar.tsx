import {
  BarChart3,
  FolderOpen,
  Home,
  LogOut,
  MessageSquare,
  Search,
  Settings,
} from "lucide-react"
import { NavLink } from "react-router-dom"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const EXPANDED_LABEL_CLASS =
  "min-w-0 overflow-hidden truncate whitespace-nowrap transition-[max-width,opacity,transform] duration-[180ms] ease-out"

const PRIMARY_ITEMS = [
  { to: "/dashboard", icon: Home, label: "Home" },
  { to: "/moris", icon: MessageSquare, label: "Moris" },
  { to: "/reports", icon: BarChart3, label: "Reports" },
] as const

const PROJECTS = [{ id: "default", name: "Default project" }] as const

function SidebarTooltip({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean
  label: string
  children: React.ReactNode
}) {
  if (!collapsed) {
    return <>{children}</>
  }

  return (
    <Tooltip label={label} delayDuration={120} contentProps={{ side: "right", sideOffset: 8 }}>
      {children}
    </Tooltip>
  )
}

function NavItem({
  to,
  icon: Icon,
  label,
  collapsed,
}: {
  to: string
  icon: typeof Home
  label: string
  collapsed: boolean
}) {
  return (
    <SidebarTooltip collapsed={collapsed} label={label}>
      <NavLink
        to={to}
        end={to === "/dashboard"}
        className={({ isActive }) =>
          cn(
            "hf-sidebar-link transition-[background-color,color,padding,gap] duration-[180ms] ease-out",
            collapsed && "justify-center gap-0 px-0",
            isActive && "hf-sidebar-link-active",
          )
        }
      >
        <Icon className="hf-sidebar-link-icon" data-slot="icon" strokeWidth={1.9} />
        <span
          className={cn(
            EXPANDED_LABEL_CLASS,
            collapsed
              ? "pointer-events-none max-w-0 -translate-x-1 opacity-0"
              : "max-w-[10rem] translate-x-0 opacity-100",
          )}
          aria-hidden={collapsed}
        >
          {label}
        </span>
      </NavLink>
    </SidebarTooltip>
  )
}

function ProjectItem({
  projectId,
  name,
  collapsed,
}: {
  projectId: string
  name: string
  collapsed: boolean
}) {
  return (
    <SidebarTooltip collapsed={collapsed} label={name}>
      <NavLink
        to={`/projects/${projectId}`}
        className={({ isActive }) =>
          cn(
            "hf-sidebar-link transition-[background-color,color,padding,gap] duration-[180ms] ease-out",
            collapsed && "justify-center gap-0 px-0",
            isActive && "hf-sidebar-link-active",
          )
        }
      >
        <FolderOpen className="hf-sidebar-link-icon" data-slot="icon" strokeWidth={1.9} />
        <span
          className={cn(
            EXPANDED_LABEL_CLASS,
            collapsed
              ? "pointer-events-none max-w-0 -translate-x-1 opacity-0"
              : "max-w-[10rem] translate-x-0 opacity-100",
          )}
          aria-hidden={collapsed}
        >
          {name}
        </span>
      </NavLink>
    </SidebarTooltip>
  )
}

export function AppSidebar({
  collapsed,
  onExpand,
  onCollapse,
  onExpandImmediate,
  onCollapseImmediate,
}: {
  collapsed: boolean
  onExpand: () => void
  onCollapse: () => void
  onExpandImmediate: () => void
  onCollapseImmediate: () => void
}) {
  return (
    <aside
      data-slot="layout-sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      onMouseEnter={onExpand}
      onMouseLeave={onCollapse}
      onFocusCapture={onExpandImmediate}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onCollapseImmediate()
        }
      }}
      className={cn(
        "hf-sidebar-surface fixed inset-y-0 left-0 z-20 hidden flex-col rounded-r-[30px] transition-[width,box-shadow] duration-[180ms] ease-out lg:flex",
        collapsed ? "w-[4.25rem]" : "w-[17.5rem]",
      )}
    >
      <div className={cn("px-5 pt-7", collapsed && "px-3.5")}>
        <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}>
          <div className="hf-brand-mark">
            <span className="hf-brand-mark-dot" />
            <span className="hf-brand-mark-core" />
          </div>
          <div
            className={cn(
              EXPANDED_LABEL_CLASS,
              collapsed
                ? "pointer-events-none max-w-0 -translate-x-1 opacity-0"
                : "max-w-[10rem] translate-x-0 opacity-100",
            )}
            aria-hidden={collapsed}
          >
            <div className="hf-sidebar-brand text-[1.05rem] font-semibold tracking-tight">Merism</div>
          </div>
        </div>

        <SidebarTooltip collapsed={collapsed} label="Search">
          <button
            type="button"
            className={cn(
              "hf-sidebar-search mt-7",
              collapsed
                ? "h-11 w-11 justify-center gap-0 rounded-full px-0"
                : "h-11 w-full justify-start gap-3 px-4",
            )}
          >
            <Search className="h-4 w-4 shrink-0 text-[rgba(var(--hf-sidebar-muted))]" strokeWidth={1.9} />
            <span
              className={cn(
                EXPANDED_LABEL_CLASS,
                "text-sm text-[rgba(var(--hf-sidebar-muted))]",
                collapsed
                  ? "pointer-events-none max-w-0 -translate-x-1 opacity-0"
                  : "max-w-[8rem] translate-x-0 opacity-100",
              )}
              aria-hidden={collapsed}
            >
              Search
            </span>
          </button>
        </SidebarTooltip>
      </div>

      <div className={cn("scrollbar flex flex-1 flex-col px-5 pb-5 pt-6", collapsed && "px-3.5")}>
        <nav className="flex flex-col gap-2">
          {PRIMARY_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} />
          ))}
        </nav>

        <div className="mt-6 flex-1">
          <div
            className={cn(
              EXPANDED_LABEL_CLASS,
              "px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(var(--hf-sidebar-subtle))]",
              collapsed ? "pointer-events-none max-w-0 opacity-0" : "max-w-[10rem] opacity-100",
            )}
            aria-hidden={collapsed}
          >
            Projects
          </div>
          <nav className="flex flex-col gap-2">
            {PROJECTS.map((project) => (
              <ProjectItem
                key={project.id}
                projectId={project.id}
                name={project.name}
                collapsed={collapsed}
              />
            ))}
          </nav>
        </div>

        <div className={cn("mt-auto border-t pt-5", collapsed ? "px-0" : "px-0")}>
          <SidebarTooltip collapsed={collapsed} label="Researcher">
            <div
              className={cn(
                "flex items-center rounded-[22px] transition-[background-color,padding,gap] duration-[180ms] ease-out",
                collapsed ? "justify-center px-0 py-2" : "gap-3 px-2 py-2.5",
              )}
            >
              <div className="hf-sidebar-avatar">R</div>
              <div
                className={cn(
                  EXPANDED_LABEL_CLASS,
                  collapsed
                    ? "pointer-events-none max-w-0 -translate-x-1 opacity-0"
                    : "max-w-[10rem] translate-x-0 opacity-100",
                )}
                aria-hidden={collapsed}
              >
                <div className="truncate text-[0.96rem] font-medium text-primary">Researcher</div>
                <div className="mt-1 inline-flex rounded-full bg-[rgba(var(--hf-sidebar-badge-bg))] px-2 py-0.5 text-[11px] font-medium text-[rgba(var(--hf-sidebar-accent))]">
                  Admin
                </div>
              </div>
            </div>
          </SidebarTooltip>

          <div className="mt-2 flex flex-col gap-1.5">
            <SidebarTooltip collapsed={collapsed} label="Settings">
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  cn(
                    "hf-sidebar-link transition-[background-color,color,padding,gap] duration-[180ms] ease-out",
                    collapsed && "justify-center gap-0 px-0",
                    isActive && "hf-sidebar-link-active",
                  )
                }
              >
                <Settings className="hf-sidebar-link-icon" data-slot="icon" strokeWidth={1.9} />
                <span
                  className={cn(
                    EXPANDED_LABEL_CLASS,
                    collapsed
                      ? "pointer-events-none max-w-0 -translate-x-1 opacity-0"
                      : "max-w-[10rem] translate-x-0 opacity-100",
                  )}
                  aria-hidden={collapsed}
                >
                  Settings
                </span>
              </NavLink>
            </SidebarTooltip>

            <SidebarTooltip collapsed={collapsed} label="Log out">
              <button
                type="button"
                className={cn(
                  "hf-sidebar-link hf-sidebar-link-danger transition-[background-color,color,padding,gap] duration-[180ms] ease-out",
                  collapsed && "justify-center gap-0 px-0",
                )}
              >
                <LogOut className="h-[1.05rem] w-[1.05rem] shrink-0" strokeWidth={1.9} />
                <span
                  className={cn(
                    EXPANDED_LABEL_CLASS,
                    collapsed
                      ? "pointer-events-none max-w-0 -translate-x-1 opacity-0"
                      : "max-w-[10rem] translate-x-0 opacity-100",
                  )}
                  aria-hidden={collapsed}
                >
                  Log out
                </span>
              </button>
            </SidebarTooltip>
          </div>
        </div>
      </div>
    </aside>
  )
}
