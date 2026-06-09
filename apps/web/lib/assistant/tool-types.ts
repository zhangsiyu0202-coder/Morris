/**
 * Morris 工具公共类型 (避免 tools/* 与 tools.ts/agent.ts 之间的循环 import)。
 */

export interface AssistantToolContext {
  /** 由路由层从 Appwrite cookie 会话解出;未登录为 null。 */
  ownerUserId: string | null;
}
