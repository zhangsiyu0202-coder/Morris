export * from "./entities.js";
export * from "./api.js";
export * from "./state.js";
export * from "./notebook.js";

// Backward-compat aliases for the Insight → Notebook rename (Wave A).
// Removed in Wave F (T46) once all consumers migrate. See .kiro/specs/notebooks/.
import {
  NotebookSchema as _NotebookSchema,
  notebookReportSchema as _notebookReportSchema,
  type Notebook as _Notebook,
  type NotebookReport as _NotebookReport,
} from "./notebook.js";
export const InsightSchema = _NotebookSchema;
export const insightReportSchema = _notebookReportSchema;
export type Insight = _Notebook;
export type InsightReport = _NotebookReport;
export type {
  AnalyzeSessionRequest,
  AnalyzeSessionResponse,
  AnalysisReportInput,
  AnalysisReportOutput,
  BuildInterviewRoomMetadataInput,
  BuildInterviewRuntimeStudyInput,
  BuildInterviewWorkflowConfigInput,
  InterviewAgentState,
  InterviewAgentStatus,
  InterviewAnswerPayload,
  InterviewResponseMode,
  InterviewRoomMetadata,
  InterviewRuntimeQuestion,
  InterviewRuntimeSection,
  InterviewRuntimeStudy,
  InterviewWorkflowConfig,
  IssueLivekitTokenRequest,
  IssueLivekitTokenResponse,
  ProbeResult,
  ProbeRound,
  QuestionTaskConfig,
  QuestionTaskResult,
  SectionTaskGroupConfig,
  SectionTaskGroupResult,
  StudyProbeLevel,
  StudyQuestionType,
  SubmitInterviewAnswerRpcRequest,
  SubmitInterviewAnswerRpcResponse,
  SurveyDraft,
  SurveyDraftQuestion,
  SurveyDraftSection,
  AnalyzeSurveyRequest,
  AnalyzeSurveyResponse,
  DashboardWidgetCatalogEntry,
  DashboardWidgetRunInput,
  DashboardWidgetResult,
  RunDashboardWidgetsOutput,
  SurveyAnalysisReportOutput,
  SurveyQuestionStat,
  VisualAnalysisOutput,
} from "./api.js";

