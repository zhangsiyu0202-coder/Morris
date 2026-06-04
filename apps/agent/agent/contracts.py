"""Pydantic mirror of packages/contracts (zod).

Field names are kept identical to the TS schemas so the two stay in lockstep.
The realtime interview module is modeled around LiveKit Supervisor /
TaskGroup / AgentTask workflows, not a LangGraph controller.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SessionState = Literal["created", "in_progress", "completed", "abandoned", "failed"]
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
ProbeLevel = Literal["light", "medium", "deep"]
StimulusType = Literal["image", "video", "text"]
StudyQuestionType = Literal[
    "open_ended",
    "single_choice",
    "multi_choice",
    "rating",
    "nps",
    "ranking",
]
StudyProbeLevel = Literal["none", "follow_up", "deep"]
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
    instruction: str
    maxRounds: int = 1


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
    probeLevel: StudyProbeLevel = "none"
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


class ProbeResult(BaseModel):  # zod: ProbeResultSchema
    level: ProbeLevel
    probeInstruction: str
    probeQuestion: str
    respondentAnswer: str


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
