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
  /** Max upload size in bytes (Appwrite bucket maximumFileSize). */
  maximumFileSize?: number;
  /** Appwrite bucket allowed extensions (without leading dot). */
  allowedFileExtensions?: string[];
}

const JSON_SIZE = 1_000_000;

// Long free-text fields. Kept above Appwrite's ~16381-char VARCHAR threshold so
// the underlying column is stored off-row as (MEDIUM)TEXT. Inline VARCHARs at
// utf8mb4 (4 bytes/char) otherwise overflow MariaDB's 65535-byte row limit when
// several large strings share a collection (see survey_sections instructions).
const TEXT_SIZE = 100_000;

// Permission model (§6.1 / Req 2.4):
//  - owner-scoped collections: clients may create; per-document read/write is
//    pinned to the owner at creation time (documentSecurity).
//  - server-write collections: no client create perms; only API key (which
//    bypasses) writes; owner reads per-document.
//  - InterviewLink: no client access at all; only Functions via API key.
const OWNER_SCOPED = ['create("users")'];
const SERVER_ONLY: string[] = [];

// Researcher identity is owned by Appwrite's built-in Account/Users service,
// not a business collection. The former `users` collection (email/name/
// createdAt) duplicated Account fields and was removed to avoid a dual-write
// between the auth user and a business row. `ownerUserId` on every owner-scoped
// collection is the Appwrite Account `$id`; researcher locale / timeZone /
// notification settings live in Account `prefs` (ResearcherPrefsSchema).
// See docs/design/auth-and-user-research.md §8.3.
export const COLLECTIONS: CollectionDef[] = [
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
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "projectId", type: "string", size: 64, required: true },
      { key: "title", type: "string", size: 512, required: true },
      {
        key: "status",
        type: "enum",
        elements: ["draft", "published", "paused", "closed", "archived"],
        required: false,
        default: "draft",
      },
      { key: "flowConfig", type: "string", size: JSON_SIZE, required: false, default: "{}" },
      { key: "version", type: "integer", required: false, default: 1 },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "by_project", type: "key", attributes: ["projectId"] },
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
    ],
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
      { key: "supervisorInstruction", type: "string", size: TEXT_SIZE, required: false },
      { key: "sectionInstruction", type: "string", size: TEXT_SIZE, required: false },
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
      { key: "isRevoked", type: "boolean", required: false, default: false },
      { key: "label", type: "string", size: 256, required: false },
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
      // C2 复审决策: array 字段不写 default,由 contracts zod default([]) 兜底
      { key: "qualityFlags", type: "string", size: 32, required: false, array: true },
    ],
    indexes: [
      { key: "by_survey", type: "key", attributes: ["surveyId"] },
      { key: "by_link", type: "key", attributes: ["linkId"] },
      { key: "by_quality", type: "key", attributes: ["qualityFlags"] },
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
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "storageFileId", type: "string", size: 64, required: true },
      { key: "durationMs", type: "integer", required: true },
      { key: "format", type: "enum", elements: ["mp3", "opus", "wav", "mp4", "webm"], required: true },
    ],
    indexes: [
      { key: "by_session", type: "key", attributes: ["sessionId"] },
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
    ],
  },
  {
    id: "analysis_reports",
    name: "AnalysisReport",
    // Server-only writes: only the analyzeSession / analyzeSurvey Functions
    // (using the server API key) write to this collection. Owner researchers
    // read via per-document permissions pinned at write time.
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      // sessionId is optional: present for scope=session reports, absent for
      // scope=survey reports. Application-level invariant enforced by the zod
      // superRefine in @merism/contracts AnalysisReportSchema.
      { key: "sessionId", type: "string", size: 64, required: false },
      // surveyId is also typed optional but is required for scope=survey
      // (enforced by the zod schema). Both fields are queryable.
      { key: "surveyId", type: "string", size: 64, required: false },
      { key: "scope", type: "enum", elements: ["session", "survey"], required: true },
      // ownerUserId is set by the analyze Function from Survey.ownerUserId so
      // that document-level read permissions can be pinned to that user and
      // the read layer in apps/web/lib/queries can filter by it.
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "themes", type: "string", size: JSON_SIZE, required: false, default: "[]" },
      { key: "insights", type: "string", size: JSON_SIZE, required: false, default: "[]" },
      { key: "citations", type: "string", size: JSON_SIZE, required: false, default: "[]" },
      { key: "storageFileId", type: "string", size: 64, required: false },
      { key: "generatedAt", type: "datetime", required: true },
      // analysis-report-v2 R2: generation metadata as JSON. Optional so v1
      // historic reports stay readable without backfill (D12).
      { key: "generationMeta", type: "string", size: JSON_SIZE, required: false },
    ],
    // Idempotency at write time: handlers query (scope, sessionId|surveyId)
    // and update if found, insert otherwise. We use plain key indexes rather
    // than unique because Appwrite unique-index semantics on nullable fields
    // are fragile; the handler enforces "one per (scope, key)" instead.
    indexes: [
      { key: "by_session", type: "key", attributes: ["sessionId"] },
      { key: "by_survey", type: "key", attributes: ["surveyId"] },
      { key: "by_scope_session", type: "key", attributes: ["scope", "sessionId"] },
      { key: "by_scope_survey", type: "key", attributes: ["scope", "surveyId"] },
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
    ],
  },
  {
    id: "insights",
    name: "Insight",
    // Owner-scoped: researchers create their own insights via the
    // /api/insights server actions; per-document permissions are pinned at
    // creation. See docs/adr/0003-analysis-report-architecture.md (D2).
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "studyId", type: "string", size: 64, required: true },
      { key: "studyTitle", type: "string", size: 512, required: true },
      { key: "question", type: "string", size: 4000, required: true },
      // Card-view fast fields, redundantly stored alongside `report` so a
      // listing query does not need to expand the full report jsonb.
      { key: "headline", type: "string", size: 512, required: true },
      { key: "summary", type: "string", size: 4000, required: true },
      { key: "confidence", type: "enum", elements: ["high", "medium", "low"], required: true },
      { key: "sampleSize", type: "integer", required: true },
      // Full structured argumentative report (insightReportSchema in
      // @merism/contracts/insight). Stored as JSON string per the convention
      // used by other JSON fields in this schema.
      { key: "report", type: "string", size: JSON_SIZE, required: true },
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "createdAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
      { key: "by_owner_study", type: "key", attributes: ["ownerUserId", "studyId"] },
      { key: "by_owner_created", type: "key", attributes: ["ownerUserId", "createdAt"] },
    ],
  },
  {
    id: "bookmarks",
    name: "Bookmark",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "surveyId", type: "string", size: 64, required: true },
      { key: "sessionId", type: "string", size: 64, required: true },
      { key: "quote", type: "string", size: TEXT_SIZE, required: true },
      { key: "source", type: "string", size: 512, required: true },
      { key: "respondent", type: "string", size: 128, required: true },
      { key: "segmentIndex", type: "integer", required: false },
      { key: "createdAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "by_owner_created", type: "key", attributes: ["ownerUserId", "createdAt"] },
      { key: "by_owner_session", type: "key", attributes: ["ownerUserId", "sessionId"] },
      { key: "by_session", type: "key", attributes: ["sessionId"] },
    ],
  },
];

export const BUCKETS: BucketDef[] = [
  {
    id: "recordings",
    name: "recordings",
    permissions: [],
    fileSecurity: true,
    maximumFileSize: 524_288_000,
    allowedFileExtensions: ["mp4", "webm", "mp3", "opus", "wav"],
  },
  { id: "reports", name: "reports", permissions: [], fileSecurity: true },
  {
    id: "survey-assets",
    name: "survey-assets",
    permissions: ['read("any")'],
    fileSecurity: false,
  },
];
