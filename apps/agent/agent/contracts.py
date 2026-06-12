"""Pydantic mirror of packages/contracts (zod).

Field names are kept identical to the TS schemas so the two stay in lockstep.
The realtime interview module is modeled around LiveKit Supervisor /
TaskGroup / AgentTask workflows, not a LangGraph controller.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SessionState = Literal["created", "in_progress", "completed", "abandoned", "failed"]
RecordingFormat = Literal["mp3", "opus", "wav", "mp4", "webm"]
QuestionType = Literal[
    "text",
    "open_ended",
    "single_choice",
    "multi_choice",
    "rating",
    "nps",
    "ranking",
    "info",
]
ProbeLevel = Literal["standard", "deep"]
StimulusType = Literal["image", "video", "text"]
StudyQuestionType = Literal[
    "open_ended",
    "single_choice",
    "multi_choice",
    "rating",
    "nps",
    "ranking",
]
StudyProbeLevel = Literal["standard", "deep"]
InterviewResponseMode = Literal[
    "voice_only",
    "single_select",
    "multi_select",
    "scale",
    "ranking",
]
InterviewAgentStatus = Literal["idle", "ready", "collecting", "processing", "completed"]

INTERVIEW_STATE_ATTRIBUTE = "merism.interviewState"
SUBMIT_ANSWER_RPC_METHOD = "merism.submit_answer"


class SurveyMeta(BaseModel):  # zod: SurveyMetaSchema
    surveyId: str
    title: str


class IssueLivekitTokenResponse(BaseModel):  # zod: IssueLivekitTokenResponseSchema
    sessionId: str
    livekitUrl: str
    token: str
    surveyMeta: SurveyMeta


class TranscriptSegment(BaseModel):  # zod: TranscriptSegmentSchema
    speaker: str
    startMs: int
    endMs: int
    text: str


class SurveySection(BaseModel):  # zod: SurveySectionSchema
    id: str = Field(alias="$id")
    surveyId: str
    title: str
    description: str = ""
    order: int
    supervisorInstruction: str | None = None
    sectionInstruction: str | None = None


class ProbeConfig(BaseModel):  # zod: ProbeConfigSchema
    level: ProbeLevel
    instruction: str = ""
    maxRounds: int = 3


class Stimulus(BaseModel):  # zod: StimulusSchema
    id: str
    type: StimulusType
    url: str | None = None
    text: str | None = None
    durationMs: int | None = None


class QuestionTaskConfig(BaseModel):  # zod: QuestionTaskConfigSchema
    questionId: str
    questionType: QuestionType
    questionContent: str
    probeConfig: ProbeConfig | None = None
    stimulus: Stimulus | None = None


class SurveyDraftQuestion(BaseModel):  # zod: SurveyDraftQuestionSchema
    questionText: str
    questionType: StudyQuestionType
    probeLevel: StudyProbeLevel = "standard"
    probeInstruction: str = ""
    options: list[str] = Field(default_factory=list)
    stimulus: Stimulus | None = None


class SurveyDraftSection(BaseModel):  # zod: SurveyDraftSectionSchema
    title: str
    objective: str
    questions: list[SurveyDraftQuestion]


class SurveyDraft(BaseModel):  # zod: SurveyDraftSchema
    title: str
    researchGoal: str
    targetAudience: str
    introScript: str
    sections: list[SurveyDraftSection]


class InterviewRuntimeQuestion(BaseModel):  # zod: InterviewRuntimeQuestionSchema
    questionId: str
    sectionId: str
    sectionTitle: str
    orderInSection: int
    questionText: str
    questionType: StudyQuestionType
    probeLevel: StudyProbeLevel
    probeInstruction: str
    options: list[str] = Field(default_factory=list)
    responseMode: InterviewResponseMode
    stimulus: Stimulus | None = None


class InterviewRuntimeSection(BaseModel):  # zod: InterviewRuntimeSectionSchema
    sectionId: str
    title: str
    objective: str
    questions: list[InterviewRuntimeQuestion]


class InterviewRuntimeStudy(BaseModel):  # zod: InterviewRuntimeStudySchema
    surveyId: str
    studyTitle: str
    researchGoal: str
    targetAudience: str
    introScript: str
    sections: list[InterviewRuntimeSection]


class InterviewAnswerPayload(BaseModel):  # zod: InterviewAnswerPayloadSchema
    questionId: str
    sectionId: str
    questionType: StudyQuestionType
    source: Literal["voice", "ui", "mixed"]
    text: str = ""
    selectedOptions: list[str] = Field(default_factory=list)
    score: float | None = None
    ranking: list[str] = Field(default_factory=list)


class InterviewAgentState(BaseModel):  # zod: InterviewAgentStateSchema
    status: InterviewAgentStatus
    currentSectionId: str | None = None
    currentQuestionId: str | None = None
    currentQuestion: InterviewRuntimeQuestion | None = None
    updatedAt: str


class InterviewRoomMetadata(BaseModel):  # zod: InterviewRoomMetadataSchema
    sessionId: str
    surveyId: str
    runtimeStudy: InterviewRuntimeStudy | None = None
    workflowConfig: "InterviewWorkflowConfig | None" = None


class SubmitInterviewAnswerRpcRequest(BaseModel):  # zod: SubmitInterviewAnswerRpcRequestSchema
    answer: InterviewAnswerPayload


class SubmitInterviewAnswerRpcResponse(BaseModel):  # zod: SubmitInterviewAnswerRpcResponseSchema
    ok: Literal[True] = True
    nextQuestionId: str | None = None
    completed: bool


class SectionTaskGroupConfig(BaseModel):  # zod: SectionTaskGroupConfigSchema
    sectionId: str
    title: str
    description: str = ""
    sectionInstruction: str | None = None
    questions: list[QuestionTaskConfig]


class InterviewWorkflowConfig(BaseModel):  # zod: InterviewWorkflowConfigSchema
    surveyId: str
    sessionId: str
    supervisorInstruction: str
    sections: list[SectionTaskGroupConfig]


class ProbeRound(BaseModel):  # zod: ProbeRoundSchema
    probeQuestion: str
    respondentAnswer: str


class ProbeResult(BaseModel):  # zod: ProbeResultSchema
    level: ProbeLevel
    probeInstruction: str
    rounds: list[ProbeRound] = Field(default_factory=list)


class QuestionTaskResult(BaseModel):  # zod: QuestionTaskResultSchema
    questionType: QuestionType
    questionContent: str
    respondentAnswer: str
    probe: ProbeResult | None = None


class SectionTaskGroupResult(BaseModel):  # zod: SectionTaskGroupResultSchema
    sectionId: str
    questionResults: dict[str, QuestionTaskResult]


class InterviewWorkflowState(BaseModel):  # ts: InterviewWorkflowState
    sessionId: str
    surveyId: str
    workflowConfig: InterviewWorkflowConfig
    currentSectionId: str | None = None
    currentQuestionTaskId: str | None = None
    sectionResults: dict[str, SectionTaskGroupResult] = Field(default_factory=dict)
    transcriptBuffer: list[TranscriptSegment] = Field(default_factory=list)


# --- notebooks sub-spec (renamed from analysis-report's legacy artifact) ---


class NotebookReportTheme(BaseModel):  # zod: notebookReportSchema.themes[]
    title: str
    analysis: str
    quotes: list[str]


class NotebookReportDivergence(BaseModel):  # zod: notebookReportSchema.divergences[]
    group: str
    stance: str


class NotebookReportAction(BaseModel):  # zod: notebookReportSchema.actions[]
    priority: Literal["P0", "P1", "P2"]
    action: str
    rationale: str


class NotebookReport(BaseModel):  # zod: notebookReportSchema
    headline: str
    directAnswer: str
    confidence: Literal["high", "medium", "low"]
    confidenceReason: str
    themes: list[NotebookReportTheme]
    divergences: list[NotebookReportDivergence]
    actions: list[NotebookReportAction]


class Notebook(BaseModel):  # zod: NotebookSchema
    id: str = Field(alias="$id")
    studyId: str
    studyTitle: str
    question: str
    ownerUserId: str
    # Wave B 字段 (旧数据 default ""; 后端 lazy 补 shortId 见 P-NB-01b)
    shortId: str = ""
    content: str = ""
    textContent: str = ""
    headline: str
    summary: str
    confidence: Literal["high", "medium", "low"]
    sampleSize: int
    visibility: Literal["internal", "published"] = "internal"
    embedding: str = ""
    embeddingModel: str = ""
    # Wave F (T48): legacy `report` field removed.
    createdAt: str


# Wave F (T46): legacy alias removed (was Insight ↦ Notebook). All
# consumers must use Notebook / NotebookReport.


# NOTE (ADR 0006, workspaces-billing M1): the TS contract adds UsageEventSchema
# (workspaceId/studyId/sessionId/unit/occurredAt) and adds workspaceId to
# InterviewSession. The agent does not emit usage yet; mirror UsageEvent here
# when the M6 session-completion emit lands. See products/workspaces-billing/spec.
