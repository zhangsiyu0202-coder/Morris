# Design Document — workspaces-billing

## Introduction

本设计文档记录 **ADR-0006** 在代码中的落地形态，并固化 **B.3 收口决策**：成员/角色真相源统一到原生 Appwrite Teams，`workspace_memberships` 集合降级为纯席位预留台账。本文是 as-built + 收口设计，downstream（实现/审查/测试）以此为准；架构原则与备选拒绝项见 `docs/adr/0006-...md`。

## D-A 租户模型：Workspace = Appwrite Team（ADR-0006 D1）

- `teamId === workspaceId`。`createWorkspace` 用 `teams.create` 建 Team，`teams.createMembership(ws, ["owner"], userId)` 把创建者设为 owner 成员。
- **成员 + 角色的唯一真相源是原生 Teams**。读路径一律 `teams.listMemberships(ws)`：`userId / userName / userEmail / roles[] / confirm`。`confirm===true` → `active`，否则 `invited`（pending email 邀请）。
- 角色解析按优先级 `owner > admin > member`。
- 文档租户隔离用 Appwrite 权限表达：`Permission.read(Role.team(workspaceId))` + `Permission.update/delete(Role.user(authorId))`（D3 读共享/写私有）。web 读层走调用者 session client，Appwrite 原生强制隔离（见 ADR-0006 B 迁移）。

### `workspace_memberships` 集合的角色收窄（B.3）

ADR-0006 D1 显式拒绝"自建成员表"。历史实现曾让 `inviteMember.getCallerRole` 从该集合读 `role`——这是对自身 ADR 的 drift。收口后：

- **唯一保留用途 = 席位上限的确定性 id CAS**：`claimSeat` 以 `seat_<ws>_<k>` 为 id `createDocument`，409 即"该席位已占"，是 architecture.md 并发契约要求的 CAS 门（Appwrite Teams 无原子的成员上限原语，故此台账有正当存在理由）。
- 集合中的 `role / status / userId` 字段对成员真相**不再权威**（仅占位，保持 `member_unique` 索引不撞）。任何"谁是成员 / 谁是什么角色"的查询都走 Teams。

## D-B Functions（`apps/functions/*`，handler 纯核 + deps SDK 包装）

| Function | 职责 | 关键点 |
|---|---|---|
| `createWorkspace` | 建 Team + owner membership；claim owner 席位 0；seed `subscriptions sub_<ws>`(trialing/seats=1/14d) + `workspace_quota wq_<ws>` | 纯核算 hardCeiling/period；deps 做 Teams+DB 写 |
| `inviteMember` | 校验 caller 角色(Teams) → 席位 CAS → Team email 邀请 | `getCallerRole` 读 Teams；`createInvite` 返回真 Team membership `$id`；handler + P-WB-01 deps-agnostic |
| `changePlan` | 改 `subscriptions.planKey` | 仅 owner |
| `stripeWebhook` | 验签 + 重放幂等同步订阅状态 | 密钥 main.ts 读，纯核不见 |
| `aggregateWorkspaceUsage` | CRON 把 `UsageEvent` 滚成 `workspace_quota` + 上报 Stripe | 复用 ADR-0005 定时 Function 形态 |
| `issueLivekitToken`(改) | 边界查 `quotaState`，超硬顶拒 `quota_exceeded` | 新开访谈 = 新计费单位 |

席位 CAS 流（inviteMember handler，已实现且不动）：caller 角色非 owner/admin → 403；`for k in [0, seats)` 逐个 `claimSeat`，首个成功的 slot 即占；全占 → 409 `seat_limit_reached`；邀请失败 → `releaseSeat` 回滚（best-effort，不抛出边界）。

## D-C Appwrite Schema（`packages/appwrite-schema/src/schema.ts`）

集合（均 `read(Role.team(ws))`）：
- `plans`（id=planKey）：seats / features[] / includedInterviews / priceRef
- `subscriptions`（id=`sub_<ws>`）：planKey / status / seats / currentPeriodStart/End
- `workspace_quota`（id=`wq_<ws>`）：usedInterviews / includedInterviews / hardCeiling / state
- `workspace_memberships`（id=`seat_<ws>_<k>`）：**席位预留台账**（见 D-A 收窄）
- `usage_events` / `usage_counters`：append-only 计费事件 + 周期滚总（D6）

> A.1 修复：`morris_memories.metadataKeys` 是数组属性，Appwrite 1.6 拒绝带 default 的数组（`attribute_default_unsupported`），曾阻断 `schema:apply`。已去掉该 default（数组默认空）。与本 Spec 同栈验证 `schema:apply OK`。

## D-D Web 读层（`apps/web/lib/workspace-billing/`，B.2）

设置页 `app/settings/{members,billing}/page.tsx` 先 `requireResearcher()` 再调 loader，故 loader 运行时已登录。

- `members-data.ts::loadWorkspaceMembers`：session client → `teams.list()[0]` → `teams.listMemberships` 映射 `MemberRow[]`；seats 读 `subscriptions sub_<ws>`。无 team → `account.get()` 给真·单人 owner 视图。
- `billing-data.ts::loadBilling`：读 `subscriptions sub_<ws>`(planKey/status/seats/periodEnd) + `workspace_quota wq_<ws>`(used/included) + `plans[planKey]`(included fallback)。
- 错误策略：仅 Appwrite 404（未 seed）经 `ignore404` 吞并降级默认；其余错误抛出（errors-and-observability try/catch 矩阵：已知预期错→降级，未知→传播）。**已去除 mock 降级**。
- 纯函数 `usageMeter` / `seatUsage` 不变（单测覆盖）。

数据流（成员设置页）：

`requireResearcher → loadWorkspaceMembers → session Teams.list/listMemberships(原生) + Databases.getDocument(subscriptions) → MemberRow[]+seats → <MembersSettings>`

## D-E 契约（`packages/contracts`）

Workspace / WorkspaceMembership(role enum) / Plan / PlanFeature / Subscription / UsageEvent / UsageCounter / QuotaState；既有实体加 `workspaceId`(租户键) + `ownerUserId` 复用为 `authorId`(作者)。`hardCeilingFor` / plan key 等纯谓词在 contracts。agent 侧 mirror `InterviewSession.workspaceId` + 完成时 UsageEvent emit 形状。

## 收口尚未完成项（明示，见 tasks.md）

1. `plans` 集合未 seed（Plus/Pro 行）→ web `includedInterviews` fallback 为 0；属数据播种，非代码缺陷。
2. Stripe 端到端（Checkout/Portal/Webhook 真验签）与 `aggregateWorkspaceUsage` CRON 上报、`issueLivekitToken` 配额门、会话完成 emit `UsageEvent` 的全链路 —— 形状/契约就位，端到端接线 + live 测试为后续波次。
3. 一次性数据迁移（现存账号 → 个人默认工作区）。
4. `MERISM_FAKE_PROVIDERS` 未实现 → 计费/配额的 Layer-4 live 集成测试受阻（与 ai-interview-engine 共享此前置）。

## Property 编号（ADR-0006 强制，testing.md）

P-WB-01 席位上限并发 / P-WB-02 计费幂等 / P-WB-03 配额不变量 / 租户隔离（已 live e2e）/ Stripe webhook 验签幂等。
