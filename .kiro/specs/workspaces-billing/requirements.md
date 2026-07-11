# Requirements Document

## Feature: workspaces-billing（工作区 / 席位 / 套餐 / 用量计费）

## Introduction

本需求文档对应 Spec **workspaces-billing**，把 MerismV2 从单研究员产品扩展为多租户商业云 SaaS：研究员归属一个 **Workspace**（= Appwrite Team），席位（seats）限制成员数，套餐（Plus / Pro）决定权益，计费 = 席位订阅 + 按"完成的访谈次数"计量的用量。

本 Spec 是 **ADR-0006 的落地契约**。ADR-0006 是唯一推翻 `scope.md` 永久排除项（teams / billing / quotas / plans / seats / usage metering）的架构决策；本 Spec 的每一条都锚定 ADR-0006，不得越出其许可范围（仍禁止：协同编辑、分享/评论、模板市场、per-resource RBAC、访谈者持久账号）。

本文档只规定"必须做什么 / 必须满足什么验收"。设计与决策细节见 `design.md` 与 `docs/adr/0006-workspaces-seats-plans-and-usage-billing.md`。

## Prerequisite

- `docs/adr/0006-workspaces-seats-plans-and-usage-billing.md`（核心决策 D1–D8；定价见其 "Update 2026-06-11 — pricing locked"）
- `foundation-setup/design.md`（Function `handler+main+deps` 形态、Appwrite schema/permission 基线）
- `.kiro/steering/{architecture,contracts,errors-and-observability,testing,scope}.md`
- Appwrite Teams + document permissions（租户 + 访问模型原语）

## Glossary

| 术语 | 含义 |
|---|---|
| **Workspace** | 租户边界。`teamId === workspaceId`，即一个 Appwrite Team；**成员与角色的真相源是原生 Teams**，无自建成员表（ADR-0006 D1） |
| **席位 seat** | 套餐授予的成员数上限。`activeMemberCount <= subscription.seats` |
| **seat-reservation 台账** | `workspace_memberships` 集合，仅作席位上限的确定性 id CAS（`seat_<ws>_<k>`）；**不**承担成员/角色真相 |
| **角色 role** | `owner` / `admin` / `member`，映射为 Appwrite Team membership roles |
| **Plan** | `plus` / `pro`，权益 + 价格档（`plans` 集合）；金额在 Stripe，不在仓库 |
| **Subscription** | 工作区订阅状态（`subscriptions` 集合 `sub_<ws>`：planKey/status/seats/period） |
| **UsageEvent** | 完成访谈的可计费事件（append-only，按 sessionId 幂等，每会话至多计一次） |
| **Quota** | 工作区配额（`workspace_quota` 集合 `wq_<ws>`：usedInterviews/includedInterviews/hardCeiling/state） |

## Scope

**包含**：Workspace=Team 租户模型、三角色、读共享/写私有访问模型、席位上限 CAS、Plus/Pro 套餐与权益、Stripe 直连计费、用量计量（完成访谈）、配额门、web 设置页（成员/席位/账单）读层接真 Appwrite。

**不包含**（ADR-0006 显式保留为禁止）：协同编辑（study 仍单作者）、跨工作区分享/评论、模板市场、per-resource RBAC / 自定义角色、org→project→team 多层、self-host + license、访谈者持久账号。

## Functional Requirements

### FR-1 Workspace = Appwrite Team（租户真相源）
- **Intent**：工作区作为租户根，以原生 Appwrite Team 承载；成员与角色从 Teams 读，不从任何集合读。
- **Success**：`createWorkspace` 建 Team + owner membership；`inviteMember.getCallerRole`、web 成员读层均经 `teams.listMemberships` 取角色；全仓无"从 `workspace_memberships` 读 role 作为权威"的路径。

### FR-2 三角色 owner / admin / member
- **Intent**：成员恰好三种角色，映射 Team roles；owner 唯一（创建者/付款人）。
- **Success**：`getCallerRole` 按 owner>admin>member 优先级解析 Team roles；非成员解析为 null → 邀请 Function 返回 403 `not_workspace_member`。

### FR-3 访问模型：工作区内读共享、写私有
- **Intent**：工作区内每个成员可读全部 study/report/notebook（`read(Role.team(ws))`）；仅作者可改删自己的（`update/delete(Role.user(authorId))`）；admin/owner 可治理（归档/删除）但**不可编辑内容**。
- **Success**：租户隔离 property（用户在 ws X 永不可读/写 `workspaceId!=X` 的行）绿；跨工作区读返回空，经 live stack e2e 验证（已在 ADR-0006 B 迁移中证明）。

### FR-4 席位上限（并发安全）
- **Intent**：N 个并发邀请绝不把 `activeMemberCount` 推过 `subscription.seats`。
- **Success**：P-WB-01 property：N 并发邀请产出恰好 `min(N, seats)` 成员；门是确定性 id CAS（`seat_<ws>_<k>` 的 409），非读-改-写计数器；超额返回 409 `seat_limit_reached`。

### FR-5 套餐 Plus / Pro + 权益
- **Intent**：两套餐，权益经 `Plan.features[]` 驱动 UI gating 与 Function 级强制；金额/权益分配为 PRD-locked（见 ADR 定价更新），live 在 Stripe。
- **Success**：`plans` 集合可 seed Plus/Pro 行；`changePlan` 改 `subscriptions.planKey`；web 账单页读 `subscriptions`+`plans` 真值。

### FR-6 计费 = 席位订阅 + 用量（完成访谈），Stripe 直连
- **Intent**：可计费单位 = `state=completed`（且 >=60s + >=1 实质回答）的访谈会话；Stripe 直连（Checkout/Portal/Webhook），无自建计费微服务。
- **Success**：会话完成时写幂等 `UsageEvent`（每 sessionId 至多一次，P-WB-02）；`stripeWebhook` 验签 + 重放幂等同步订阅状态。

### FR-7 用量计量 + 配额门（降级不毁数据）
- **Intent**：定时聚合器（`aggregateWorkspaceUsage` CRON）把 UsageEvent 滚成 `workspace_quota`；`issueLivekitToken` 在边界查 `quotaState`，超硬顶拒新访谈 `quota_exceeded`；超额只挡新开，绝不删/藏既有数据。
- **Success**：P-WB-03 配额不变量；超额阻断新 `issueLivekitToken` 且不改既有 study/report/recording。

### FR-8 web 设置页读真 Appwrite
- **Intent**：成员/席位/账单设置页读真数据，不降级 mock。
- **Success**：`loadWorkspaceMembers` 读 Teams + subscription；`loadBilling` 读 subscriptions+quota+plans；无 workspace 时给真·单人 owner 视图（非 mock）；仅 404（未 seed）被吞，其余错误抛出。已 live stack 验证。

## Non-Functional Requirements

- **NFR-1 安全**：Stripe 密钥服务端只读、`maskSecret`、永不入 `handler.ts` 纯核；webhook 必须验签。
- **NFR-2 并发**：席位/计费/配额门一律确定性 id CAS，禁内存锁/计数器读-改-写（architecture.md 并发契约）。
- **NFR-3 数据迁移**：把每个现存单研究员账号数据包进一个个人默认工作区；幂等、非破坏（appwrite-schema 规则）。
- **NFR-4 scope-guard 收窄**：在引入每个被解禁概念的 PR 同步把 `scope.md`/`scope-guard` 从"永久排除"改为"ADR-0006 治理下在范围"，仍禁止保留项。

## Success Signal

研究员可创建工作区（Team + 订阅 + 配额自动 seed）、按席位上限邀请成员（三角色）、成员能读全工作区 study 但只能改自己的；设置页展示真实成员/席位/账单；完成访谈累计用量、超配额挡新访谈而不毁数据；Plus/Pro 经 Stripe 订阅与用量后付计费。全部门禁 + ADR-0006 强制的五条 property（租户隔离 / 席位上限 / 计费幂等 / 配额门 / webhook 验签幂等）绿。
