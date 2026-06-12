# Requirements — interviewee-portal

> 前置:`foundation-setup/design.md`(`issueLivekitToken` Function、Appwrite schema、契约边界)、ADR-0001(LiveKit Supervisor 访谈控制器)、`docs/design/multimodal-interview-and-structured-rendering.md §9`(Design Interviewer Page 原型)、`.kiro/steering/{architecture,contracts,scope,design-system}.md`。

本 Spec **追认并治理** 已落地的受访者端实时访谈实现(分支 `feat/studies-workspace`),把"能跑但无规格"变成"有契约、可回归、边界明确"。**纯治理,无新增产品形态**:不重做 UI、不改 LiveKit 控制器架构、不引入任何新字段/集合。

> 历史说明:本 Spec 初稿(commit 92a8b09)曾规划一个 per-interviewee `IntervieweeContext` 增量(借 PostHog `user_interviews.IntervieweeContext`)。**已撤销**——Merism 受访者匿名无账户,无法可靠按受访者身份建键;PostHog 能这么做是因为它持有 email/distinct_id,领域假设不同(`scope.md` borrow 纪律)。"给 AI 主持人的指令"这一真实需求改由 **survey-editor 的 `Survey.moderatorInstruction`** 承载(合成进既有 `supervisorInstruction`),不属本 Spec。

## 1. 既有实现清单(治理对象)

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

- **R1 链接换 token**:受访者持 `linkToken` 访问 `/interview?link=<token>`;客户端调用 `issueLivekitToken`,得到 `{sessionId, livekitUrl, token, surveyMeta, linkKind}`。失败按既有错误码呈现(`link_not_found`/`link_expired`/`link_revoked`/`link_exhausted`/`survey_not_published`/`quota_exceeded`/`invalid_input`/`internal_error`)。
- **R2 受访者无账户**:受访者从不认证;唯一入口是 Function;客户端绝不直写任何 collection(`scope.md` / `architecture.md`)。**这也是为何"按受访者个性化"不可建键——无稳定受访者身份。**
- **R3 预访谈流**:加入房间前完成设备自检 + 摄像头自览 + 屏幕共享授权 + 知情同意。任一硬权限缺失须给出可恢复的提示而非静默失败。
- **R4 两栏房间**:左转写、右刺激物(`StimulusDisplay`),遵循 Design Interviewer Page 原型与 Mauve Quiet。
- **R5 转写流**:转写片段经 LiveKit transcription stream 到达,按稳定 `id` interim→final 升级(upsert by id),区分 `agent`/`you`。
- **R6 提交答案 RPC**:答案经 `SUBMIT_ANSWER_RPC_METHOD` 提交,返回 `{ok, nextQuestionId?, completed}`;不经 Appwrite 往返算"下一题"(`architecture.md` realtime↔persistence 边界)。
- **R7 断线重连**:transport 暴露 `connecting/connected/reconnecting/disconnected/error` 相位;重连不丢失已确认的转写。
- **R8 并发与回滚**:token 签发的并发安全与回滚由 `issueLivekitToken` 既有实现保证(确定性 `s_<link>_<k>` session $id 作 CAS;部分失败回滚 room/session/usedCount)。本 Spec 不改该逻辑,仅纳入验收。

## 3. 非目标(显式)

- 不重做受访者 UI、不改 LiveKit Supervisor/TaskGroup 架构、不引入新字段/集合。
- 不引入受访者账户、邮件/通知邀请、访谈 campaign/topic 概念,**不做任何 per-interviewee 个性化键**(`scope.md` 永久排除 + 匿名无身份)。
- 不把 `/interview?link=` 改名为 `/i/[linkToken]`(roadmap 旧命名);保留既有 query-param 入口。
- 不实现 skipLogic 运行时分支(属 ai-interview-engine;且产品决策:不做声明式 skip logic,由 AI Supervisor 动态判断收集)。
- AI 主持指令(语调/语速/风格)不在此——由 survey-editor `Survey.moderatorInstruction` 承载。

## 4. 缺口标注(收口债,显式记录而非隐藏)

- **缺 live e2e**:受访者端无 Playwright/真 stack 端到端(链接→预访谈→加入→转写→提交→完成)。`tasks.md` 标注为必补项(gated by `MERISM_LIVE_TESTS=1`,需 stack + agent 起)。
- **mock 残留**:`app/page.tsx` 根预览 + `lib/mock-session.ts` 仍服务结构化渲染预览;与 live `useLiveInterview` 的整合是既有已知漂移(`AGENTS.md`),本 Spec 记录为后续,不强制消除。
