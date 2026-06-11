# Implementation Plan — ai-interview-engine

本 Spec 为 **纯治理**:无新增产品代码。任务 = 锁定既有引擎为基线 + 标注唯一收口债(live 语音端到端)。

## 治理基线(无代码,追认)

- [ ] **G1** 确认 design §B 分层/边界结论(workflow.py 纯、supervisor 委托、realtime↔persistence、provider 窄接口、懒导入)与 `apps/agent/agent/interview/*` + `persistence/*` + `providers/*` 一致。`pnpm test:py` 全绿 = 基线锁定。
- [ ] **G2** 确认无被禁形态混入:`grep` 无 LangGraph 作主控、无第二 LLM/ASR-TTS provider、`agent/interview/*` 顶层无 livekit 导入、引擎不消费 `skipLogic`、未新增 classifications 字段。`pnpm scope-guard` 绿。
- [ ] **G3** 确认主持指令通路:`InterviewSupervisorAgent(instructions=workflowConfig.supervisorInstruction)`,且 `buildInterviewWorkflowConfigFromDraft` 已把 `Survey.moderatorInstruction` 合成进该串(survey-editor 增量已落地)。agent 侧无需改。

## 收口债(显式 NEXT,不阻断基线)

- [ ] **L1**(live 语音 e2e)真 LiveKit + deterministic fake provider 跑通一整场:join → 逐 section TaskGroup → 每题采集+追问 → 完成判定 → finalize(转写/录音/collectedAnswers 落 Appwrite)。门控:`pnpm stack:up` + `cd apps/agent && uv sync --extra realtime` + `MERISM_FAKE_PROVIDERS=1` + `MERISM_LIVE_TESTS=1`。
  - 阻塞点:`MERISM_FAKE_PROVIDERS` 在 steering 标"规划中,未实现"——L1 依赖先落地 fake provider 工厂。本轮记 NEXT。
- [ ] **L2**(后续)把 moderatorInstruction 在真实语音里的效果纳入 L1 断言(supervisor 是否按语调/节奏行事)——属 L1 的扩展断言。

## 依赖

```
G1 ─ G2 ─ G3      (基线, 本轮可锁)
L1 (需 fake provider 工厂 + realtime extra + stack) ── L2
```
