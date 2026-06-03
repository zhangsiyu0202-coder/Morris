# Requirements Document

## Feature: foundation-setup（MerismV2 架构基线）

## Introduction

本需求文档对应 Spec **foundation-setup**，定义 MerismV2 平台**架构基线**的需求范围。本 Spec 不交付任何用户可见的功能页面，而是建立支撑后续所有功能子 Spec（survey-editor / interviewee-portal / ai-interview-engine / analysis-report）的**基础设施、数据契约、跨模块约束、本地与 CI 开发环境**。

本架构层的核心干系人：
- **平台研究员 (Researcher)**: 通过登录账户使用平台；本 Spec 为其建立账户体系与数据隔离基线，但不交付任何功能页面。
- **匿名受访者 (Interviewee)**: 仅通过链接进入；本 Spec 为其预留 token 颁发与 Session 创建的契约接口，但不交付落地页 UI。
- **平台开发者**: 本 Spec 的直接受益者，通过本架构获得"一键起栈、契约可校验、属性可测试"的开发体验。

本 Spec 排除（永久排除，不在项目范围）:
- ❌ 多人协作（团队 / 共享 / 评论）
- ❌ 计费 / 订阅 / 计量

设计与决策细节见 `design.md`，本文档只规定"必须做什么 / 必须满足什么验收"。

## Glossary

| 术语 | 含义 |
|---|---|
| **架构基线 (Foundation)** | 本 Spec 的交付物：基础设施、数据 schema、契约、CI/CD、本地开发栈 |
| **Researcher** | 平台登录账户用户 |
| **Interviewee** | 通过匿名链接进入的受访者，无账号 |
| **Survey** | 问卷定义实体（含 SurveySection / QuestionBlock 集合与流程配置） |
| **SurveySection** | 问卷 section；在语音访谈中映射为一个 LiveKit TaskGroup |
| **QuestionTask** | 单个访谈问题；在语音访谈中映射为一个 LiveKit AgentTask |
| **InterviewSession** | 一次访谈实例 |
| **Transcript** | 访谈语音的文本转写记录 |
| **AnalysisReport** | 基于 Transcript 与 Survey 生成的分析报告 |
| **InterviewLink** | 受访者使用的匿名邀请链接 |
| **Permission 矩阵** | (actor × resource × action) 的访问授权枚举 |
| **跨模块契约** | 模块间稳定的接口/数据形态约定，子 Spec 必须遵守 |
| **本地开发栈** | Docker Compose 描述的 Appwrite + LiveKit + 应用容器组合 |
| **正确性属性** | 可执行的不变量，作为 PBT 的目标 |

## Requirements

### Requirement 1: 后端基础设施部署

**User Story:** 作为平台开发者，我需要一份可一键拉起的自托管 Appwrite 与 LiveKit 环境，以便所有功能子 Spec 在统一基础上开发与测试。

#### Acceptance Criteria

1. WHEN 开发者在本地工作目录执行项目根的"启动"脚本 THEN 系统 SHALL 通过 Docker Compose 同时拉起 Appwrite (含其依赖的 MariaDB / Redis / 等) 与 LiveKit Server，并在 5 分钟内进入健康状态。
2. WHERE 项目仓库 THE 系统 SHALL 提供一份 `.env.example` 文件，覆盖 Appwrite endpoint/project/key、LiveKit api-key/api-secret/url、DeepSeek LLM key、Qwen ASR/TTS key 与 STT/TTS provider key 的占位项，且不得提交任何真实凭据。
3. IF 必需的环境变量缺失 THEN 启动脚本 SHALL 在拉起前以非零退出码失败，并给出明确的缺失变量名提示。
4. WHEN Appwrite 与 LiveKit 容器进入健康状态 THEN 健康检查脚本 SHALL 报告"OK"并展示各服务的访问地址。
5. WHILE 服务运行中 THE 系统 SHALL 提供"清理停止"脚本，在不删除数据卷的前提下停止全部容器，并提供"完全重置"脚本以彻底清除卷数据。

### Requirement 2: 数据 Schema 与 Permission 模型

**User Story:** 作为平台开发者，我需要在 Appwrite 中以代码声明全部 Collection、字段、索引、Permission，以便后续子 Spec 直接引用并保证跨环境一致。

#### Acceptance Criteria

1. WHERE 项目仓库 THE 系统 SHALL 以代码（TypeScript 或 JSON 配置）声明以下 Collection: `User`、`Project`、`Survey`、`SurveySection`、`QuestionBlock`、`InterviewLink`、`InterviewSession`、`Transcript`、`Recording`、`AnalysisReport`，覆盖 design.md §Data Models 中列出的全部字段与关系。
2. WHEN 开发者执行"应用 schema"命令 THEN 系统 SHALL 读取声明文件并通过 Appwrite Server SDK 在目标 Appwrite 实例创建/同步 Collection、字段、索引，且**幂等**（重复执行不产生差异变更）。
3. WHEN "应用 schema" 完成后执行"校验 schema"命令 THEN 系统 SHALL 比对声明与实际部署，输出 `OK` 或人类可读的差异清单，差异存在时退出码非零。
4. THE 系统 SHALL 为每个 Collection 声明 Permission 规则，使得：
   - `Project / Survey / SurveySection / QuestionBlock / AnalysisReport` 的读写仅限该资源 owner researcher。
   - `InterviewSession / Transcript / Recording` 仅限 owner researcher 可读；写入由服务端身份（API Key / Function）执行。
   - `InterviewLink` 不向客户端开放直接读写，所有受访者侧操作必须经 Function 中转。
5. THE 系统 SHALL 为下列 Storage Bucket 声明并应用：`recordings`（仅 owner 可读）、`reports`（仅 owner 可读）、`survey-assets`（公开读，受控写）。
6. IF 声明的字段类型与已部署字段类型不兼容 THEN "应用 schema" 命令 SHALL 拒绝执行并打印冲突字段，避免破坏性迁移在生产意外触发。

### Requirement 3: LiveKit Token 颁发与 Session 创建契约

**User Story:** 作为平台开发者，我需要一个稳定的服务端入口来为受访者签发 LiveKit Token 并原子地创建 Session，以便受访者门户子 Spec 直接对接而不必关心私钥与一致性。

#### Acceptance Criteria

1. THE 系统 SHALL 在 Appwrite Functions 中提供 `issueLivekitToken` 函数，接收 `{ linkToken, alias? }` 输入。
2. WHEN 调用方提交合法且未过期未耗尽的 `linkToken` THEN 函数 SHALL 在同一调用中：(a) 创建一条 `InterviewSession` (state=created)、(b) 在 LiveKit 创建对应 Room、(c) 签发受访者身份的 LiveKit JWT，并返回 `{ sessionId, livekitUrl, token, surveyMeta }`。
3. IF `linkToken` 不存在 THEN 函数 SHALL 返回 404，且不进行任何写入。
4. IF `linkToken` 已过期 OR 已达到 `maxUses` THEN 函数 SHALL 返回 410，且不创建 Session、不签发 token。
5. WHILE 多个并发请求同时使用同一 `single_use` 链接 THE 系统 SHALL 保证只有一个请求成功创建 Session，其余收到 410。
6. THE 颁发的 LiveKit JWT SHALL 仅授予对应 `sessionId` 命名 Room 的 `roomJoin / canPublish / canSubscribe` 权限，且 TTL ≤ 30 分钟。
7. THE LiveKit `apiSecret` SHALL 仅存在于 Function 运行时环境变量中；任何客户端代码、构建产物、网络响应体均不得包含该 secret。
8. WHEN 函数内部任一子步骤失败 THEN 函数 SHALL 回滚已创建的 Session 状态为 `failed` 或不持久化，并返回 5xx，且 LiveKit Room 不残留。

### Requirement 4: 应用脚手架与跨模块契约定义

**User Story:** 作为平台开发者，我需要一份带类型与契约的应用脚手架，以便子 Spec 在编写功能时不需要重复决定项目结构与共享类型。

#### Acceptance Criteria

1. WHERE 项目仓库 THE 系统 SHALL 包含一个 Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui 的应用脚手架，可成功执行 `dev / build / lint / typecheck`。
2. THE 系统 SHALL 在仓库内提供一个共享的"契约包"（如 `packages/contracts` 或同级目录），导出以下 schema 与 TypeScript 类型：
   - 数据实体（与 Requirement 2 的 Collection 一一对应）
   - `issueLivekitToken` 的请求/响应
   - `analyzeSession` 的请求/响应及 `AnalysisReport` 输入/输出
   - LiveKit `InterviewWorkflowConfig`、`SectionTaskGroupConfig`、`QuestionTaskConfig`、`QuestionTaskResult`、`InterviewWorkflowState` 的高层结构
3. THE 契约包 SHALL 使用单一权威 schema（如 zod）作为定义来源，并能将该定义导出为 TypeScript 类型；Python 侧（Agent Worker）通过对应工具（如 pydantic 或代码生成）保持契约同步。
4. THE 系统 SHALL 在仓库内提供 LiveKit Agent Worker 的 Python 项目骨架，至少能引导 `livekit-agents` 框架、运行 `hello world` 级 Agent，并为后续 Supervisor / TaskGroup / AgentTask 工作流预留结构。
5. THE 系统 SHALL 提供 CopilotKit Runtime 的 Next.js API Route 骨架，能够接受空 action 列表并返回 200，作为子 Spec 后续填充工具的占位入口。
6. IF 任何契约 schema 的字段被修改 THEN 项目根的 typecheck 命令 SHALL 在依赖该字段的 TS 文件出现编译错误，从而强制呈现破坏性影响。

### Requirement 5: 认证与所有权隔离基线

**User Story:** 作为平台研究员，我需要可靠的账户认证与严格的数据隔离，以便我的问卷、访谈与报告不会被其他账户访问。

#### Acceptance Criteria

1. THE 系统 SHALL 通过 Appwrite Auth 提供 researcher 的邮箱+密码注册与登录入口（脚手架级别可调用，UI 落地放至子 Spec）。
2. WHEN researcher 通过 Web SDK 直连 Appwrite 读取/写入任何 Collection THEN Appwrite SHALL 基于 Permission 规则强制只允许访问其自身资源。
3. THE 系统 SHALL 提供一个自动化测试用例（Permission 矩阵测试），覆盖至少 `Project / Survey / SurveySection / QuestionBlock / InterviewSession / Transcript / Recording / AnalysisReport` 八类资源 × `read / write` 两种动作 × `owner / 其他 researcher / 匿名` 三类 actor 共 ≥ 48 个组合，断言行为符合 Requirement 2.4。
4. WHILE 受访者无 Appwrite 登录身份 THE 系统 SHALL 阻止其通过 Web SDK 直接读写任何 Collection；其所有 Server 调用必须经 `issueLivekitToken` 等专用 Function。
5. WHERE 任何 Function THE 系统 SHALL 不在响应体或日志中以明文回显敏感凭据（API Key、Token 完整体），日志可保留前缀掩码与 `traceId`。

### Requirement 6: 错误处理与可观测性基线

**User Story:** 作为平台开发者，我需要统一的错误处理范式与日志格式，以便后续子 Spec 出现问题时可以快速定位。

#### Acceptance Criteria

1. THE 系统 SHALL 为 Appwrite Function 与 LiveKit Agent Worker 定义统一的日志格式，至少包含 `timestamp / level / sessionId? / traceId / message`。
2. WHEN 任何 Function 抛出未捕获异常 THEN 框架 SHALL 记录带堆栈的错误日志并返回 5xx，同时在响应体中携带 `traceId`（不暴露内部细节）。
3. THE 系统 SHALL 为外部 Provider 调用（LLM / STT / TTS）定义统一的"重试 + 降级"封装：默认指数退避重试 ≤ 3 次后抛出可识别的瞬时/永久错误类型。
4. WHILE LiveKit workflow 或外部调用产生错误 THE Agent SHALL 不会污染其他 Session 的状态（每 Session 独立隔离）。
5. WHEN Session 因不可恢复错误失败 THEN 系统 SHALL 将 `InterviewSession.state` 设置为 `failed` 并保留 `errorContext` 字段供事后分析。

### Requirement 7: 测试基础设施与正确性属性脚手架

**User Story:** 作为平台开发者，我需要一套覆盖单元 / 属性 / 集成 / E2E 四层的测试脚手架，以便每个子 Spec 在交付时都能挂接相应测试。

#### Acceptance Criteria

1. THE 系统 SHALL 在 TypeScript 侧配置 Vitest，在 Python 侧配置 pytest，二者均可通过项目根的统一命令一键执行。
2. THE 系统 SHALL 在 TypeScript 侧引入 fast-check、在 Python 侧引入 hypothesis，并提供至少一个对架构层正确性属性（Permission 矩阵 P-SEC-01 或 LiveKit Secret 不泄露 P-SEC-02）的样例 PBT 用例，跑通后作为子 Spec 模板。
3. THE 系统 SHALL 提供一份"本地开发栈冒烟测试"脚本，依次完成：拉起栈 → 应用 schema → 创建 researcher → 建一份最小 Survey → 调用 `issueLivekitToken` 成功签发，全程在 ≤ 2 分钟内通过。
4. THE 系统 SHALL 在 Playwright 中预置一个最小 E2E 用例（首页可加载且无 console error），作为子 Spec E2E 的脚手架。
5. WHERE CI 配置 THE 系统 SHALL 在每次 push/PR 触发时执行：lint、typecheck、Vitest、pytest、契约 schema 校验、冒烟测试，且任一失败阻止合并。
6. THE 系统 SHALL 维护一份 `tests/properties/` 目录约定，作为后续子 Spec 集中存放 PBT 用例的标准位置。

### Requirement 8: 子 Spec 边界与文档承接

**User Story:** 作为后续子 Spec 的编写者，我需要明确知道架构层为我固化了什么、剩什么需要我自己决定，以便子 Spec 不重复定义也不越界。

#### Acceptance Criteria

1. THE `design.md` SHALL 在"子 Spec 划分"章节列出 `survey-editor / interviewee-portal / ai-interview-engine / analysis-report` 四个子 Spec，并为每个子 Spec 给出范围、依赖、必须遵守的契约引用。
2. THE `design.md` SHALL 在"待解决的开放问题"章节列出未在架构层收口的事项（如 ASR/TTS provider 细节、暂停/恢复交互、录音默认开关等），并标注由哪个子 Spec 决议。
3. WHEN 子 Spec 的设计文档创建时 THEN 该文档 SHALL 在开头显式引用本 Spec 路径作为前置约束（例如 `Prerequisite: foundation-setup/design.md §Components and Interfaces`）。
4. THE 系统 SHALL 在仓库 README 中提供一份"开始一个新子 Spec 的步骤"指引，包括：复制契约引用模板、引用对应正确性属性、在 `tests/properties/` 创建子 Spec 子目录。

### Requirement 9: 范围边界控制（防止越界）

**User Story:** 作为产品负责人，我需要确保架构 Spec 不引入超出范围的功能，以避免后续子 Spec 被既成事实绑架。

#### Acceptance Criteria

1. THE 本 Spec 的设计与代码 SHALL 不引入任何"团队 / 协作 / 共享 / 评论 / 计费 / 订阅 / 计量"相关的实体、字段、Function、UI、依赖。
2. WHERE 数据模型 THE 系统 SHALL 不在任何 Collection 中定义 `teamId / sharedWith / planId / quota` 类字段。
3. IF 子 Spec 在后续提出引入上述被排除的能力 THEN 项目维护者 SHALL 拒绝合入，除非显式更新本架构 Spec 的范围声明。
4. THE 系统 SHALL 不在任何 Function、UI、契约中暗含"按使用量收费"的行为或埋点。
