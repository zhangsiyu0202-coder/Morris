# Qwen-VL LLM Swap — Tasks

## Task Dependency Graph

```
T1 (settings) ──┬─► T2 (qwen_llm) ──► T3 (__init__) ──► T6 (engine)
                └─► T4 (workflow passthrough) ──► T5 (question instructions + inject)
T1,T3,T4,T5 ──► T7 (tests) ──► T8 (verify)
```

## Tasks

- [ ] 1. settings.py：Qwen-VL LLM 解析 + Gemini speech 解耦
  - `resolve_llm_settings` 读 `QWEN_API_KEY`/`DASHSCOPE_API_KEY`，model 默认
    `DEFAULT_QWEN_VL_MODEL`、可被 `QWEN_VL_MODEL` 覆盖；base_url 用
    `DEFAULT_QWEN_BASE_URL`
  - `ProviderSettings.speech` 标注改为 `SpeechSettings | None`
  - `resolve_provider_settings`：Gemini 分支返回 `speech=None` 且不调
    `resolve_speech_settings`；cascade 分支解析 `llm` + `speech`
  - 保留 DeepSeek 常量 dormant（不被读）
  - _Requirements: 1.1–1.5, 6.1–6.5_

- [ ] 2. providers/qwen_llm.py：Qwen-VL 适配器（已存在则核对）
  - `build_llm(LLMSettings) -> openai.LLM`，`livekit.plugins` lazy import
  - _Requirements: 2.1, 2.2_

- [ ] 3. providers/__init__.py：re-export 清理
  - `build_llm` 来自 `qwen_llm`；移除任何 `qwen_vl_*` 符号
  - _Requirements: 2.3_

- [ ] 4. workflow.py：stimulus 透传
  - `_section_config_from_runtime` 传 `stimulus=question.stimulus`
  - _Requirements: 3.1–3.3_

- [ ] 5. tasks/question.py：per-type 指令 + 图像注入
  - `build_question_instructions`：text 内联 + "Reference it directly"；
    image `(image)`+"attached frame"；video `(video)`+"not attached"
  - `_maybe_inject_visual_stimulus`：image-only，`role=user`，stage-context
    label + `ImageContent(image=stim.url)`；`ImageContent` lazy import
  - _Requirements: 4.1–4.4, 5.1–5.4_

- [ ] 6. engine.py：切换 LLM import + cascade 类型守卫
  - import 改 `from agent.providers.qwen_llm import build_llm`
  - cascade 分支前加 `assert llm/speech is not None`
  - Gemini 分支不变（仅 `llm=build_realtime_llm`）
  - 更新默认 cascade 注释提 Qwen-VL
  - _Requirements: 7.1–7.3_

- [ ] 7. 测试
  - `test_providers.py`：Qwen-VL 默认断言；Gemini 模式 `llm is None` 且
    `speech is None`、不含 Qwen key 仍成功；`provider_settings_available`
    per-mode（default 需 DashScope；Gemini 仅需 Gemini key；缺 Gemini key
    → False）
  - `test_workflow.py`：stimulus 透传 + text/image/video 三类指令文案
  - _Requirements: 8.1–8.5_

- [ ] 8. 验证（按序）
  - `cd apps/agent && uv run pytest tests/test_providers.py tests/test_workflow.py -v`
  - `pnpm test:py`（无 `--extra realtime` 全绿）
  - smoke import：`from agent.providers import build_llm, resolve_provider_settings`
    + `from agent.interview.engine import InterviewEngine`
  - 解析 sanity：default 模式 `llm.model == "qwen3-vl-plus"`、`speech` 非 None、
    `gemini is None`；Gemini 模式 `llm is None`、`speech is None`、`gemini` 非 None
  - _Requirements: 8.4_
