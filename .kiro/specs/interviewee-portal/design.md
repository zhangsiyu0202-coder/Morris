# Design — interviewee-portal

> 对应 Spec `interviewee-portal`。前置见 requirements.md §前置。本设计是 **既有实现的治理映射**:钉死契约与边界,不改代码、不加产品形态。

## A. 既有实现治理映射

数据流(链接 → token → 房间 → agent),全部已存在:

```mermaid
flowchart LR
  Browser["/interview?link= (RSC)"] --> Room["InterviewRoom (client)"]
  Room -->|issueLivekitToken(linkToken, alias?)| Fn["Function issueLivekitToken"]
  Fn -->|findLink + claim s_<link>_<k> + createRoom(metadata)| AW[("Appwrite")]
  Fn -->|signToken| Room
  Room -->|connect| LK["LiveKit Room"]
  Agent["agent main.py"] -->|_parse_room_metadata| Meta["InterviewRoomMetadata"]
  Meta --> WF["workflow_config_from_metadata"]
  LK -. transcription / RPC / merism.interviewState .- Room
```

治理结论(写入本设计作为契约,不改实现):

- **边界**:turn-by-turn 状态(转写、下一题、`merism.interviewState` attribute)留在 LiveKit 房间;只有 finalized artifact 过 Appwrite(`architecture.md`)。既有实现遵守。
- **room metadata 同包**:`issueLivekitToken` 把 `InterviewRoomMetadata`(含 `workflowConfig.supervisorInstruction` + `sections[].questions[]`)序列化成一条 room metadata 发给 agent。问题与主持指令是 `workflowConfig` 里两个分开的字段,同包到达——这是所有同类项目(PostHog user_interviews、Vapi 范式)的通用形态。本 Spec 锁定此边界:**新的主持指令内容由 survey-editor 合成进 `supervisorInstruction`,不在受访者端引入任何新通道/字段。**
- **错误码**:沿用 `issueLivekitToken` 既有注册码(requirements R1)。不新增。
- **并发/回滚**:确定性 `s_<linkId>_<k>` session $id 作 CAS + best-effort 回滚(room→session→usedCount),既有实现保证,纳入验收基线。
- **匿名身份**:受访者无账户、无稳定身份(仅可选自填 `alias`)。这是架构事实,直接排除任何"按受访者建键"的个性化设计。

## B. 测试设计

既有实现已被 `issueLivekitToken` 的 handler/property 测试覆盖(token TTL ≤ 上限、identity 前缀 `interviewee:`、并发单会话、回滚无孤儿、无密钥泄漏)。本 Spec 不新增单元/属性测试(无新代码),只标注唯一缺口:

| 项 | 状态 |
|---|---|
| `issueLivekitToken` handler/property(并发/回滚/泄漏/TTL) | 已有,纳入基线 |
| 受访者端 live e2e(链接→预访谈→加入→转写→提交→完成) | **缺**,gated `MERISM_LIVE_TESTS=1`,见 tasks 收口债 |

## C. 关键决策

- **D1 纯治理**:本 Spec 不产生新代码,只把既有 live 实现的契约/边界写成可回归的规格 + 标注 live e2e 债。
- **D2 拒绝 per-interviewee 个性化**:受访者匿名无身份 ⇒ 任何 keyed-on-interviewee 的上下文表不可建(撤销了初稿的 IntervieweeContext)。"给 AI 主持人的指令"是 per-Survey 的研究员意图,归 survey-editor `Survey.moderatorInstruction` → 合成进既有 `supervisorInstruction`。
- **D3 不碰 mock 残留**:`lib/mock-session.ts` 等历史预览的整合留作后续(`AGENTS.md` 已知漂移)。
