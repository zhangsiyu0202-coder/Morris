import type {
  InterviewWorkflowConfig,
  SectionTaskGroupResult,
} from "./api.js";
import type { TranscriptSegment } from "./entities.js";

/**
 * Runtime snapshot for the LiveKit Supervisor / TaskGroup / AgentTask
 * interview workflow. The authoritative realtime controller lives in the
 * Python LiveKit Agent Worker; this shape is used for persistence,
 * recovery, and cross-module contracts.
 */
export interface InterviewWorkflowState {
  sessionId: string;
  surveyId: string;
  workflowConfig: InterviewWorkflowConfig;
  currentSectionId?: string;
  currentQuestionTaskId?: string;
  sectionResults: Record<string, SectionTaskGroupResult>;
  transcriptBuffer: TranscriptSegment[];
}
