# Original User Request

## Initial Request — 2026-06-27T16:08:10Z

对 MerismV2（AI 驱动的语音访谈定性研究平台）进行一次聚焦于「已有但未完成」的完整性审查：找出代码库中存在骨架/占位/半成品的模块，评估每个模块距离真正可用状态的差距，输出结构化报告和优先级任务清单。审查为只读模式，不修改任何代码。

Working directory: /home/jia/MerismV2
Integrity mode: development

## Requirements

### R1. 发现所有「存在但未完成」的代码单元

扫描整个代码库，识别以下类型的不完整实现：
- TODO / FIXME / HACK / XXX / PLACEHOLDER 注释（TypeScript 和 Python）
- 抛出 NotImplementedError 或 throw new Error("not implemented") 的函数体
- 返回硬编码假数据 / mock 数据的实现（如函数直接 return [] 或 return mockData）
- 仅有类型定义但缺少对应实现的模块（如 interface/zod schema 已定义，但调用方或 handler 不存在）
- 导入了但从未被实际使用的关键模块（表明集成尚未完成）
- apps/web/lib/mock-session.ts 等明确标记为临时的文件被引用的路径

重点扫描目录：packages/contracts/src/、packages/observability/src/、apps/agent/agent/、apps/functions/、apps/web/app/、apps/web/lib/、apps/web/components/

### R2. 对照规格文档评估实现差距

读取以下规格文件，逐项核查每个任务的完成状态：
- .kiro/specs/foundation-setup/tasks.md — 逐 wave 核查每个 task 是否真正完成
- .kiro/specs/foundation-setup/requirements.md — 核查 acceptance criteria 是否能被现有代码满足
- AGENTS.md 中 Current gaps and known drifts 章节 — 评估每个已知漂移点的当前实际状态

对每个 task/requirement，给出三种状态之一：
- 已完成 — 实现存在且逻辑完整
- 部分完成 — 骨架存在但有明显缺口（说明缺什么）
- 未开始 — 文件不存在或仅有空壳

### R3. 识别「假完成」的集成点

重点检查跨模块集成是否真正联通：
- apps/web 的 API route 是否真正调用了 apps/functions 或 Appwrite SDK
- apps/agent 的 LiveKit supervisor/workflow 是否真正实现了多 section 的 TaskGroup 流程
- Morris 页面助手（app/api/assistant/route.ts）的工具是否全部有真实实现
- packages/contracts 中定义的 schema 是否在 apps/agent/agent/contracts.py 中有完整镜像
- Appwrite schema（packages/appwrite-schema）中定义的 collection/index 是否与 contracts 中的实体字段一致

### R4. 评估「可用性」风险

核心流程：研究员创建调研 → 生成访谈链接 → 受访者加入语音访谈 → AI 实时访谈 → 转录/录音 → 分析报告生成

标记每个不完整项属于哪个流程节点，并评估阻塞级别：
- 阻塞（BLOCKING）— 核心流程中断
- 降级（DEGRADED）— 可运行但缺少关键功能
- 边缘（EDGE）— 不影响核心流程

## Acceptance Criteria

### 报告输出
- 产出主报告文件：/home/jia/MerismV2/docs/review/completeness-report.md
- 主报告包含：执行摘要（3-5 句话总结整体完成度）、按模块分节的详细发现、每条发现包含文件路径+行号+具体描述
- 产出任务清单：/home/jia/MerismV2/docs/review/action-items.md，按优先级 P0/P1/P2 分组

### 覆盖完整性
- .kiro/specs/foundation-setup/tasks.md 中的每一个 task 都有明确的完成状态标注
- AGENTS.md 中列举的所有 current gaps 都被重新评估（要看实际代码，不只是复述）
- 至少检查了 apps/web、apps/agent、apps/functions、packages/contracts、packages/appwrite-schema 五个核心目录

### 结论质量
- 每个「部分完成」的项目必须说明缺少什么、差多少
- 阻塞级别覆盖所有发现条目
- 任务清单中 P0 项目不超过 15 条
