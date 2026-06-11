# Requirements — interviewee-portal

> 前置:`foundation-setup/design.md`(`issueLivekitToken` Function、Appwrite schema、契约边界)、ADR-0001(LiveKit Supervisor 访谈控制器)、`docs/design/multimodal-interview-and-structured-rendering.md §9`(Design Interviewer Page 原型)、`.kiro/steering/{architecture,contracts,scope,design-system}.md`。

本 Spec 的目的是 **追认并治理** 已落地的受访者端实时访谈实现(分支 `feat/studies-workspace`),把"能跑但无规格"变成"有契约、可回归、边界明确",并纳入一个 scope 内的增量:**per-interviewee 访谈上下文(IntervieweeContext)**。本 Spec 不重做 UI,不改 LiveKit 控制器架构。

## 1. 背景:既有实现清单(治理对象)

下列代码已存在且为 live 接线(非 mock),本 Spec 为其补规格,不重写:

| 区域 | 文件 | 现状 |
|---|---|---|
| 入口路由 | `apps/web/app/interview/page.tsx`(`/interview?link=<token>`) | RSC 读 `searchParams.link`,交给客户端房间 |
| 房间外壳 | `components/interview/{interview-room,interview-room-shell,conversation-panel,stimulus-display}.tsx` | 两栏(转写 + 刺激物)房间 |
| 预访谈流 | `components/interview/{pre-interview-flow,self-cam}.tsx` | 屏幕共享授权、设备自检、摄像头自览 |
| 传输层 | `lib/interview/transport.ts` | 真 `livekit-client`:Room/Track/TranscriptionSegment、submit-answer RPC、room metadata、`merism.interviewState` attribute |
| token 交换 | `lib/interview/issue-token.ts` → Function `issueLivekitToken` | 浏览器拿 link token 换短时 LiveKit token,密钥只在 Function 内 |
| 状态消费 | `lib/hooks/use-live-interview.ts` | 订阅 transport 回调,渲染进度/转写 |

## 2. 功能需求(既有实现的验收基线)

- **R1 链接换 token**:受访者持 `linkToken` 访问 `/interview?link=<token>`;客户端调用 `issueLivekitToken` Function,得到 `{sessionId, livekitUrl, token, surveyMeta, linkKind}`。失败按既有错误码呈现(`link_not_found`/`link_expired`/`link_revoked`/`link_exhausted`/`survey_not_published`/`quota_exceeded`/`invalid_input`/`internal_error`)。
- **R2 受访者无账户**:受访者从不认证;唯一入口是 Function;客户端绝不直写任何 collection(`scope.md` / `architecture.md`)。
- **R3 预访谈流**:加入房间前完成设备自检 + 摄像头自览 + 屏幕共享授权 + 知情同意。任一硬权限缺失须给出可恢复的提示而非静默失败。
- **R4 两栏房间**:左转写、右刺激物(`StimulusDisplay`),遵循 Design Interviewer Page 原型与 Mauve Quiet。
- **R5 转写流**:转写片段经 LiveKit transcription stream 到达,按稳定 `id` interim→final 升级(upsert by id),区分 `agent`/`you`。
- **R6 提交答案 RPC**:答案经 `SUBMIT_ANSWER_RPC_METHOD` 提交,返回 `{ok, nextQuestionId?, completed}`;不经 Appwrite 往返算"下一题"(`architecture.md` realtime↔persistence 边界)。
- **R7 断线重连**:transport 暴露 `connecting/connected/reconnecting/disconnected/error` 相位;重连不丢失已确认的转写。
- **R8 并发与回滚**:token 签发的并发安全与回滚由 `issueLivekitToken` 既有实现保证(确定性 `s_<link>_<k>` session $id 作为 CAS;部分失败回滚 room/session/usedCount)。本 Spec 不改该逻辑,仅将其纳入验收。

## 3. 增量需求:per-interviewee 访谈上下文(IntervieweeContext)

借鉴 PostHog `user_interviews` 的 `IntervieweeContext`(`unique(topic, interviewee_identifier)` + `agent_context`)的 **shape**(非概念照搬:Merism 用 `InterviewLink` 而非 topic/campaign)。`AGENTS.md` 明确背书该扩展:"若需 per-interviewee 个性化(不同受访者不同探询背景),扩展 link 概念或加 keyed on `linkId + intervieweeIdentifier` 的薄表"。

合法性论证(`scope.md` borrow-or-build):
- 不被 `Survey.flowConfig`(研究背景,全局)覆盖;
- 不被 `SurveySection.supervisorInstruction`(分节指令)覆盖;
- 不被 `InterviewLink`(访问授权)覆盖;
- 故为合法 **新薄表**,命名 `IntervieweeContext`(不引入 team/campaign/email 邀请等 scope 外概念)。

需求:
- **R-IC1 数据形状**:`IntervieweeContext = { $id, linkId, intervieweeIdentifier, agentContext, createdAt }`,以 `(linkId, intervieweeIdentifier)` 唯一。`agentContext` 是研究员为某一受访者准备的探询背景文本(如"这位是重度用户,已用 3 年")。
- **R-IC2 研究员撰写**:owner-scoped server action 以 `(linkId, intervieweeIdentifier)` upsert 一条上下文;非属主拒绝;受访者无任何写权限。
- **R-IC3 携带标识**:受访者入口可带 `intervieweeIdentifier`(`/interview?link=<token>&id=<identifier>`);`issueLivekitToken` 请求新增可选 `intervieweeIdentifier`。
- **R-IC4 注入 agent**:`issueLivekitToken` 用 `(linkId, intervieweeIdentifier)` 查上下文,把 `agentContext` 注入 `InterviewRoomMetadata`(新增可选字段 `intervieweeContext`);缺失则不注入(fail-open,正常访谈不受影响)。
- **R-IC5 agent 消费**:agent 读取 `InterviewRoomMetadata.intervieweeContext`,由 Supervisor 在系统指令中前置该背景;字段缺失时行为与今天一致。
- **R-IC6 镜像纪律**:`InterviewRoomMetadata` 既被 Python 镜像(`agent/contracts.py`),新增字段同 PR 镜像(字段名 `intervieweeContext`,camelCase 不转 snake)。

## 4. 非目标(显式)

- 不重做受访者 UI、不改 LiveKit Supervisor/TaskGroup 架构。
- 不引入受访者账户、邮件/通知邀请、访谈 campaign/topic 概念(`scope.md` 永久排除;PostHog 的 `UserInterviewTopic.invite_*` 明确不借)。
- 不把 `/interview?link=` 改名为 `/i/[linkToken]`(roadmap 旧命名);保留既有 query-param 入口,`intervieweeIdentifier` 以 `&id=` 追加。
- 不实现 skipLogic 运行时分支(属 ai-interview-engine)。
- IntervieweeContext 的撰写 UI(recruit-view 集成)非本 Spec 必交;本 Spec 必交 server action + Function 注入 + agent 消费的端到端数据通路。

## 5. 正确性属性(与实现同 PR)

- **P-PORT-IC-01 唯一性往返**:对随机 `(linkId, intervieweeIdentifier, agentContext)`,upsert 后按键读回语义等价;同键二次 upsert 覆盖而非新建。
- **P-PORT-IC-02 权限**:匿名角色对 `interviewee_contexts` 无读写;非属主研究员 upsert 被拒。
- **P-PORT-IC-03 注入 fail-open**:`intervieweeIdentifier` 缺失或查无上下文时,`issueLivekitToken` 仍返回 200 且 `InterviewRoomMetadata` 无 `intervieweeContext`,正常访谈不受影响。
- **P-PORT-IC-04 schema 往返 + 拒绝**:`IntervieweeContextSchema` parse 幂等;空 `intervieweeIdentifier`/空 `agentContext` 被拒(稳定 issue path)。
- **P-SEC(既有复用)**:token TTL ≤ `TOKEN_TTL_SECONDS`、identity 前缀 `interviewee:`、无密钥泄漏——复用 `issueLivekitToken` 既有 property 测试。

## 6. 缺口标注(收口债,显式记录而非隐藏)

- **缺 live e2e**:受访者端无 Playwright/真 stack 端到端(链接→预访谈→加入→转写→提交→完成)。本 Spec 在 `tasks.md` 标注为必补项(gated by `MERISM_LIVE_TESTS=1`,需 stack + agent 起)。
- **mock 残留**:`app/page.tsx` 根预览 + `lib/mock-session.ts` 仍服务结构化渲染预览;与 live `useLiveInterview` 的整合是既有已知漂移(`AGENTS.md`),本 Spec 不强制消除,但记录为后续。
