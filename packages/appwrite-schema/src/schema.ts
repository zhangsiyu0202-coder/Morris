// Declarative source of truth for the Appwrite deployment. Pure data (no SDK
// import) so it stays unit-testable. Field names mirror packages/contracts zod
// schemas. apply-schema/verify-schema consume this.

export const DATABASE_ID = "merism";
export const DATABASE_NAME = "MerismV2";

export type AttrType =
  | "string"
  | "integer"
  | "double"
  | "boolean"
  | "datetime"
  | "enum";

export interface AttrDef {
  key: string;
  type: AttrType;
  required: boolean;
  size?: number; // string
  elements?: string[]; // enum
  default?: string | number | boolean | null;
  array?: boolean;
}

export interface IndexDef {
  key: string;
  type: "key" | "unique";
  attributes: string[];
}

export interface CollectionDef {
  id: string;
  name: string;
  /** Collection-level permission strings (Appwrite syntax). */
  permissions: string[];
  /** Per-document permissions enforced (owner read/write set at doc creation). */
  documentSecurity: boolean;
  attributes: AttrDef[];
  indexes: IndexDef[];
}

export interface BucketDef {
  id: string;
  name: string;
  permissions: string[];
  fileSecurity: boolean;
}

const JSON_SIZE = 1_000_000;

// Permission model (§6.1 / Req 2.4):
//  - owner-scoped collections: clients may create; per-document read/write is
//    pinned to the owner at creation time (documentSecurity).
//  - server-write collections: no client create perms; only API key (which
//    bypasses) writes; owner reads per-document.
//  - InterviewLink: no client access at all; only Functions via API key.
const OWNER_SCOPED = ['create("users")'];
const SERVER_ONLY: string[] = [];

export const COLLECTIONS: CollectionDef[] = [
  {
    id: "users",
    name: "User",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "email", type: "string", size: 320, required: true },
      { key: "name", type: "string", size: 256, required: true },
      { key: "createdAt", type: "datetime", required: true },
    ],
    indexes: [{ key: "email_unique", type: "unique", attributes: ["email"] }],
  },
  {
    id: "projects",
    name: "Project",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "name", type: "string", size: 256, required: true },
      { key: "description", type: "string", size: 2000, required: false, default: "" },
      { key: "createdAt", type: "datetime", required: true },
    ],
    indexes: [{ key: "by_owner", type: "key", attributes: ["ownerUserId"] }],
  },
  {
    id: "surveys",
    name: "Survey",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "projectId", type: "string", size: 64, required: true },
      { key: "title", type: "string", size: 512, required: true },
      {
        key: "status",
        type: "enum",
        elements: ["draft", "published", "archived"],
        required: false,
        default: "draft",
      },
      { key: "flowConfig", type: "string", size: JSON_SIZE, required: false, default: "{}" },
      { key: "version", type: "integer", required: false, default: 1 },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [{ key: "by_project", type: "key", attributes: ["projectId"] }],
  },
  {
    id: "survey_sections",
    name: "SurveySection",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "surveyId", type: "string", size: 64, required: true },
      { key: "title", type: "string", size: 512, required: true },
      { key: "description", type: "string", size: 2000, required: false, default: "" },
      { key: "order", type: "integer", required: true },
      { key: "supervisorInstruction", type: "string", size: 8000, required: false },
      { key: "sectionInstruction", type: "string", size: 8000, required: false },
    ],
    indexes: [
      { key: "by_survey", type: "key", attributes: ["surveyId"] },
      { key: "survey_section_order_unique", type: "unique", attributes: ["surveyId", "order"] },
    ],
  },
  {
    id: "question_blocks",
    name: "QuestionBlock",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "surveyId", type: "string", size: 64, required: true },
      { key: "sectionId", type: "string", size: 64, required: true },
      { key: "order", type: "integer", required: true },
      { key: "orderInSection", type: "integer", required: true },
      {
        key: "type",
        type: "enum",
        elements: ["text", "open_ended", "single_choice", "multi_choice", "rating", "nps", "ranking", "info"],
        required: true,
      },
      { key: "prompt", type: "string", size: 4000, required: true },
      { key: "config", type: "string", size: JSON_SIZE, required: false, default: "{}" },
      { key: "probeConfig", type: "string", size: JSON_SIZE, required: false },
      { key: "stimulus", type: "string", size: JSON_SIZE, required: false },
      { key: "probingPolicy", type: "string", size: JSON_SIZE, required: false, default: "{}" },
      { key: "skipLogic", type: "string", size: JSON_SIZE, required: false, default: "{}" },
    ],
    indexes: [
      { key: "by_survey", type: "key", attributes: ["surveyId"] },
      { key: "by_section", type: "key", attributes: ["sectionId"] },
      { key: "survey_order_unique", type: "unique", attributes: ["surveyId", "order"] },
      { key: "section_order_unique", type: "unique", attributes: ["sectionId", "orderInSection"] },
    ],
  },
  {
    id: "interview_links",
    name: "InterviewLink",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "surveyId", type: "string", size: 64, required: true },
      { key: "token", type: "string", size: 128, required: true },
      { key: "mode", type: "enum", elements: ["single_use", "reusable"], required: true },
      { key: "maxUses", type: "integer", required: true },
      { key: "usedCount", type: "integer", required: false, default: 0 },
      { key: "expiresAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "token_unique", type: "unique", attributes: ["token"] },
      { key: "by_survey", type: "key", attributes: ["surveyId"] },
    ],
  },
  {
    id: "interview_sessions",
    name: "InterviewSession",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "surveyId", type: "string", size: 64, required: true },
      { key: "linkId", type: "string", size: 64, required: true },
      { key: "intervieweeAlias", type: "string", size: 256, required: false },
      {
        key: "state",
        type: "enum",
        elements: ["created", "in_progress", "completed", "abandoned", "failed"],
        required: false,
        default: "created",
      },
      { key: "livekitRoom", type: "string", size: 128, required: true },
      { key: "collectedAnswers", type: "string", size: JSON_SIZE, required: false, default: "{}" },
      { key: "errorContext", type: "string", size: JSON_SIZE, required: false },
      { key: "startedAt", type: "datetime", required: false },
      { key: "endedAt", type: "datetime", required: false },
    ],
    indexes: [
      { key: "by_survey", type: "key", attributes: ["surveyId"] },
      { key: "by_link", type: "key", attributes: ["linkId"] },
    ],
  },
  {
    id: "transcripts",
    name: "Transcript",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "sessionId", type: "string", size: 64, required: true },
      { key: "segments", type: "string", size: JSON_SIZE, required: true },
      { key: "language", type: "string", size: 16, required: true },
      { key: "finalizedAt", type: "datetime", required: true },
    ],
    indexes: [{ key: "by_session", type: "key", attributes: ["sessionId"] }],
  },
  {
    id: "recordings",
    name: "Recording",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "sessionId", type: "string", size: 64, required: true },
      { key: "storageFileId", type: "string", size: 64, required: true },
      { key: "durationMs", type: "integer", required: true },
      { key: "format", type: "enum", elements: ["mp3", "opus", "wav"], required: true },
    ],
    indexes: [{ key: "by_session", type: "key", attributes: ["sessionId"] }],
  },
  {
    id: "analysis_reports",
    name: "AnalysisReport",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "sessionId", type: "string", size: 64, required: true },
      { key: "surveyId", type: "string", size: 64, required: false },
      { key: "scope", type: "enum", elements: ["session", "survey"], required: true },
      { key: "themes", type: "string", size: JSON_SIZE, required: false, default: "[]" },
      { key: "insights", type: "string", size: JSON_SIZE, required: false, default: "[]" },
      { key: "citations", type: "string", size: JSON_SIZE, required: false, default: "[]" },
      { key: "storageFileId", type: "string", size: 64, required: false },
      { key: "generatedAt", type: "datetime", required: true },
    ],
    indexes: [{ key: "by_session", type: "key", attributes: ["sessionId"] }],
  },
];

export const BUCKETS: BucketDef[] = [
  { id: "recordings", name: "recordings", permissions: [], fileSecurity: true },
  { id: "reports", name: "reports", permissions: [], fileSecurity: true },
  {
    id: "survey-assets",
    name: "survey-assets",
    permissions: ['read("any")'],
    fileSecurity: false,
  },
];
