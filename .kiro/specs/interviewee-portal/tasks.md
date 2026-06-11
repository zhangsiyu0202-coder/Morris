# Implementation Plan — interviewee-portal

每个任务保持 `pnpm typecheck` 绿、可独立提交与回退。涉及 Appwrite 读写的任务需本地 stack(`pnpm stack:up` + `pnpm schema:apply`)验证。契约先行 → schema → Function 注入 → agent 消费 → 写路径 → 验证。

## Wave 0 — 治理基线(无代码,仅追认)

- [ ] **G0** 确认 §A 既有实现治理结论(边界/错误码/并发回滚)与当前代码一致;不改实现。`pnpm test`(既有 issueLivekitToken 套件)绿即视为基线锁定。

## Wave A — 契约(contracts-first)

- [ ] **T1** `packages/contracts/src/entities.ts` 加 `IntervieweeContextSchema`(+ 导出 type)。
- [ ] **T2** `api.ts`:`IssueLivekitTokenRequestSchema` 加可选 `intervieweeIdentifier`;`InterviewRoomMetadataSchema` 加可选 `intervieweeContext`;新增 `UpsertIntervieweeContextRequestSchema`。`index.ts` 导出。
- [ ] **T3** `pnpm -F @merism/contracts build` + 契约测试:`IntervieweeContext` 往返/拒绝(P-PORT-IC-04)、改动后的 request/metadata 往返。**契约改后必重新 build dist(Functions 消费 dist)**。
- [ ] **T4** `apps/agent/agent/contracts.py`:`InterviewRoomMetadata` 镜像加 `intervieweeContext: str | None = None`;`apps/agent/tests/test_contracts.py` 加带该字段的往返。`pnpm test:py` 绿。

## Wave B — Appwrite schema

- [ ] **T5** `packages/appwrite-schema/src/schema.ts` 加 `interviewee_contexts`(attributes + 唯一索引 `[linkId, intervieweeIdentifier]` + 权限:owner 写、匿名无读写)。`schema.test` FORBIDDEN 正则不误伤。`pnpm schema:apply` 幂等、`pnpm schema:verify` 对 live stack 通过。

## Wave C — Function 注入(读路径)

- [ ] **T6** `issueLivekitToken/src/deps.ts`:`IssueDeps` 加可选 `findIntervieweeContext`;`createRealDeps` 用 admin client 按唯一索引查询(两条 createRoom 路径都注入 `intervieweeContext`)。
- [ ] **T7** `issueLivekitToken/src/handler.ts`:解析 `intervieweeIdentifier`,有值且 dep 存在则查上下文并注入 metadata;fail-open。扩展 `tests/handler.test.ts`:有/无 identifier × 查到/查无 四象限(P-PORT-IC-03)。pure core 不见密钥。

## Wave D — agent 消费

- [ ] **T8** `agent/interview/supervisor.py`:`metadata.intervieweeContext` 存在则在 supervisor 系统指令前置受访者背景;缺失不变。加/扩 `apps/agent/tests/test_workflow.py` 覆盖有/无上下文两路。

## Wave E — 写路径(研究员 upsert)

- [ ] **T9** `apps/web/lib/actions/interviewee-context.ts`:`upsertIntervieweeContext`,owner 闸门 + 确定性 doc id `ic_<linkId>_<hash(identifier)>`(≤36 字符)+ `withErrorBoundary`/`traceId`。内存 Deps 单测(P-PORT-IC-01)。
- [ ] **T10** `tests/properties/interviewee-portal/owner-scope.test.ts`:匿名无读写、非属主 upsert 拒绝(P-PORT-IC-02)。

## Wave F — 验证 + 收口债

- [ ] **T11** 全量:`pnpm typecheck`/`pnpm test`/`pnpm test:py`/`pnpm test:properties`/`pnpm scope-guard` 全绿;`pnpm schema:verify` 对 live stack。
- [ ] **T12**(收口债,标注)受访者端 live e2e:链接→预访谈→加入→转写→提交→完成,gated `MERISM_LIVE_TESTS=1`(需 stack + agent 起)。**本轮若 stack/agent 不可用则记为 NEXT,不阻断 Wave A–F 合并**。

## 依赖波次

```
G0
A(T1→T2→T3→T4) ── B(T5) ── C(T6→T7) ── D(T8) ── F
                          └─ E(T9→T10) ┘
```

> scope-guard:`interviewee_contexts`/`IntervieweeContext`/`intervieweeContext` 是 scope 内的 per-interviewee 个性化薄表(`AGENTS.md` 背书),非 teams/campaign/email-invite;若 scope-guard 误报,按既有 EXEMPT 机制收窄而非放宽禁词。
