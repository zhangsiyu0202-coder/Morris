/**
 * Morris 工具公共类型 (避免 tools/* 与 tools.ts/agent.ts 之间的循环 import)。
 */
import type { WorkspaceAccessContext } from "./access-control";

export interface AssistantToolContext {
  /** 由路由层从 Appwrite cookie 会话解出;未登录为 null。 */
  ownerUserId: string | null;
  /**
   * 当前研究员的活跃 workspace 上下文 (robustness-hardening REQ-4).
   * - undefined / null = 没有 workspace 归属 (solo 研究员 / 未登录) 或调用方
   *   未显式传(测试 fixture 多走这条)。两种情况均跳过 checkWorkspaceAccess。
   * - 工具体顶部用 `if (ctx.workspace) { const denied = checkWorkspaceAccess(...) }`.
   *
   * Wave A: `role` 默认 "member" (最严格), Appwrite Permissions 仍是数据隔离
   * 的 canonical 来源。引入 role-differentiated scope (`workspace:settings` /
   * `billing:edit`) 时再做真正的 role 解析子规格。
   */
  workspace?: WorkspaceAccessContext | null;
}
