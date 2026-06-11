# Design — interviewee-portal

> 对应 Spec `interviewee-portal`。前置见 requirements.md §前置。本设计分两部分:(A) 既有实现的治理映射(不改代码,只钉契约与边界);(B) IntervieweeContext 增量的 contracts-first 落地。

## A. 既有实现治理映射

数据流(链接 → token → 房间 → agent),全部已存在:

```mermaid
flowchart LR
  Browser["/interview?link=&id= (RSC)"] --> Room["InterviewRoom (client)"]
  Room -->|issueLivekitToken(linkToken, alias, id?)| Fn["Function issueLivekitToken"]
  Fn -->|findLink + claim s_<link>_<k> + createRoom(metadata)| AW[("Appwrite")]
  Fn -->|signToken| Room
  Room -->|connect| LK["LiveKit Room"]
  Agent["agent main.py"] -->|_parse_room_metadata| Meta["InterviewRoomMetadata"]
  Meta --> WF["workflow_config_from_metadata"]
  LK -. transcription / RPC / merism.interviewState .- Room
```

治理结论(写入本设计作为契约,不改实现):
- **边界**:turn-by-turn 状态(转写、下一题、attribute)留在 LiveKit 房间;只有 finalized artifact 过 Appwrite(`architecture.md`)。既有实现遵守。
- **错误码**:沿用 `issueLivekitToken` 既有注册码(§requirements R1)。不新增。
- **并发/回滚**:确定性 `s_<linkId>_<k>` session $id 作 CAS + best-effort 回滚(room→session→usedCount),既有实现保证,纳入验收基线。

## B. IntervieweeContext 增量(contracts-first)

### B.1 契约改动(`packages/contracts`,先行)

`entities.ts` 新增:

```ts
export const IntervieweeContextSchema = z.object({
  $id: z.string(),
  linkId: z.string().min(1),
  intervieweeIdentifier: z.string().min(1),
  agentContext: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type IntervieweeContext = z.infer<typeof IntervieweeContextSchema>;
```

`api.ts` 改动:
- `IssueLivekitTokenRequestSchema` 增 `intervieweeIdentifier: z.string().min(1).optional()`(既有 `{linkToken, alias}` 不变)。
- `InterviewRoomMetadataSchema` 增 `intervieweeContext: z.string().optional()`(放顶层,与 `runtimeStudy`/`workflowConfig` 并列;可选 → 缺失即今天行为)。
- upsert 请求载荷 `UpsertIntervieweeContextRequestSchema = { linkId, intervieweeIdentifier, agentContext }`。

`apps/agent/agent/contracts.py`:`InterviewRoomMetadata` 镜像增 `intervieweeContext: str | None = None`(同 PR,字段名一致)。

### B.2 Appwrite schema(`packages/appwrite-schema`)

新增 collection `interviewee_contexts`:
- attributes:`linkId`(string,required)、`intervieweeIdentifier`(string,required)、`agentContext`(string,JSON_SIZE 不需要——普通长文本 size)、`createdAt`(datetime)、`ownerUserId`(string,required,owner 闸门)。
- 索引:**唯一** `by_link_interviewee` on `[linkId, intervieweeIdentifier]`(R-IC1 唯一性 + upsert 确定性 doc id 依据)。
- 权限:写仅 owner 研究员(`Permission.write(Role.user(ownerUserId))`);匿名无读写。Function 用 admin key 读(注入路径),不暴露给客户端。
- `apply` 幂等非破坏;`schema:verify` 对 live stack。

### B.3 写路径(研究员 upsert)

`apps/web/lib/actions/interviewee-context.ts`(`"use server"`):
- `upsertIntervieweeContext({ linkId, intervieweeIdentifier, agentContext })`:`getCurrentUserId()` → 校验 link 属当前用户(经既有 read layer / link ownership)→ 用确定性 doc id `ic_<linkId>_<hash(identifier)>`(≤36 字符,沿用 workspaces-billing 教训)upsert → `withErrorBoundary`/`traceId`。
- 边界 `UpsertIntervieweeContextRequestSchema.parse`;非属主拒绝(P-PORT-IC-02)。

> doc id 长度:`linkId`(≤20)+ identifier 可能超长 → 对 identifier 取短 hash 进 doc id,真值存 attribute;唯一索引仍以 `[linkId, intervieweeIdentifier]` 真值保证唯一(避免 hash 碰撞误判)。

### B.4 注入路径(Function `issueLivekitToken`)

- `IssueDeps` 增可选 `findIntervieweeContext?(linkId, intervieweeIdentifier): Promise<string | null>`(返回 `agentContext` 或 null)。可选 → 不配置即跳过(与 `checkQuota` 同模式)。
- handler:解析出 `intervieweeIdentifier` 后,若有值且 `deps.findIntervieweeContext` 存在 → 查 `agentContext`;查到则在构造 `InterviewRoomMetadata` 时带上 `intervieweeContext`。查无/缺失 → 不带(fail-open,P-PORT-IC-03)。
- `deps.ts`(SDK wrapper):`findIntervieweeContext` 用 admin client 按唯一索引查 `interviewee_contexts`;`buildInterviewRoomMetadataFromDraft` 的产物 + `intervieweeContext` 合并进 room metadata。注意 createRoom 两条路径(base / draft-loaded)都要带上。
- pure core 不见密钥(admin key 在 `main.ts`/`deps.ts`)。

### B.5 消费路径(agent)

- `agent/main.py::_parse_room_metadata` 已解析 `InterviewRoomMetadata`;新增字段自动可用。
- `agent/interview/supervisor.py`:构造 supervisor 系统指令时,若 `metadata.intervieweeContext` 存在,前置一段"受访者背景:<context>"。缺失则不变(R-IC5)。
- 不进 turn-by-turn 状态;只在会话初始化读一次(realtime↔persistence 边界)。

## C. 测试设计(与实现同 PR)

| 属性 | 位置 | 层 |
|---|---|---|
| P-PORT-IC-01 唯一性往返 | `apps/web/lib/actions/__tests__/interviewee-context.test.ts`(内存 Deps) | unit |
| P-PORT-IC-02 权限 | `tests/properties/interviewee-portal/owner-scope.test.ts` | property |
| P-PORT-IC-03 注入 fail-open | `apps/functions/issueLivekitToken/tests/handler.test.ts`(扩展:有/无 identifier、查到/查无) | unit/property |
| P-PORT-IC-04 schema 往返+拒绝 | `packages/contracts/test/*`(IntervieweeContext + 改动的 request/metadata) | unit |
| Python 镜像 | `apps/agent/tests/test_contracts.py`(InterviewRoomMetadata 带 intervieweeContext 往返) | unit |
| live e2e(收口债) | `apps/web/e2e` 或 functions live,gated `MERISM_LIVE_TESTS=1` | live(标注,见 tasks) |

## D. 关键决策

- **D1 注入点选 room metadata 顶层而非 workflowConfig**:`intervieweeContext` 是"这位受访者"的背景,正交于"这套问卷怎么跑"(workflowConfig)。放顶层语义清晰,agent 一处读取。
- **D2 fail-open 而非 fail-closed**:查无上下文绝不阻断访谈(它是增强而非门禁)。与 workspaces-billing 的 quota fail-open 决策一致。
- **D3 doc id 用 hash(identifier)**:identifier 可能是邮箱/长串,超 Appwrite 36 字符上限;唯一性以索引真值保证,doc id 仅作确定性 upsert 句柄。
- **D4 不引入 campaign**:PostHog 的 topic 维度由 Merism 的 `InterviewLink` 承担(一条 link 即一次招募);per-interviewee 维度才是新薄表。
