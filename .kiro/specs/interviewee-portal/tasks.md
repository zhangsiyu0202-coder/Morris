# Implementation Plan — interviewee-portal

本 Spec 为 **纯治理**:无新增产品代码。任务是"锁定既有实现为基线" + "标注唯一收口债(live e2e)"。

## 治理基线(无代码,追认)

- [ ] **G1** 确认 design §A 治理结论(边界 / room-metadata 同包 / 错误码 / 并发回滚 / 匿名无身份)与当前 `apps/web/{app/interview,components/interview,lib/interview,lib/hooks/use-live-interview}` + `apps/functions/issueLivekitToken` 实现一致。`pnpm test`(既有 issueLivekitToken 套件)绿 = 基线锁定。
- [ ] **G2** 确认无任何 per-interviewee 个性化字段/集合被引入(scope 守卫)。`pnpm scope-guard` 对受访者端文件 0 命中。

## 收口债(显式 NEXT,不阻断基线)

- [ ] **D1**(live e2e)受访者端真 stack 端到端:`/interview?link=<token>` → 预访谈(设备/屏幕共享/同意)→ 加入 → 转写流 → 提交答案 RPC → 完成。gated `MERISM_LIVE_TESTS=1`,需 `pnpm stack:up` + agent(`uv sync --extra realtime`)+ fake providers。**本轮 stack/agent 不可用即记 NEXT。** 注:`db9e94a` 已让语音 supervisor 每题发布完整 `currentQuestion`(结构化控件 live 渲染),此 e2e 应一并验证单选/多选/量表/排序控件按题准确渲染 + 选项被语音读出。
- [ ] **D2**(后续)消除 `lib/mock-session.ts` 根预览与 live `useLiveInterview` 的双轨(`AGENTS.md` 已知漂移)。非本 Spec 必交。

> 主持指令(语调/语速/风格)不在本 Spec:见 survey-editor 的 `Survey.moderatorInstruction` 增量(已落地,合成进 `supervisorInstruction`)。
