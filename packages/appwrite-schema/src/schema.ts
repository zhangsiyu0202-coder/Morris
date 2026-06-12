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
  type: "key" | "unique" | "fulltext";
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
// several large strings publish a collection (see survey_sections instructions).
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
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
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
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
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
      // survey-editor moderator-instruction increment: dedicated long-text column
      // (not flowConfig) for the AI moderator delivery directives.
      { key: "moderatorInstruction", type: "string", size: TEXT_SIZE, required: false, default: "" },
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
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "token", type: "string", size: 128, required: true },
      { key: "mode", type: "enum", elements: ["single_use", "reusable"], required: true },
      {
        key: "kind",
        type: "enum",
        elements: ["production", "test"],
        required: false,
        default: "production",
      },
      { key: "maxUses", type: "integer", required: true },
      { key: "usedCount", type: "integer", required: false, default: 0 },
      { key: "expiresAt", type: "datetime", required: true },
      { key: "isRevoked", type: "boolean", required: false, default: false },
      { key: "label", type: "string", size: 256, required: false },
    ],
    indexes: [
      { key: "token_unique", type: "unique", attributes: ["token"] },
      { key: "by_survey", type: "key", attributes: ["surveyId"] },
      { key: "by_workspace", type: "key", attributes: ["workspaceId"] },
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
      { key: "workspaceId", type: "string", size: 64, required: false },
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
      { key: "by_workspace", type: "key", attributes: ["workspaceId"] },
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
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
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
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
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
    id: "notebooks",
    name: "Notebook",
    // Owner-scoped: researchers create notebooks via Morris (createNotebook tool)
    // or server actions; per-document permissions pinned at creation.
    //
    // Wave B of notebooks spec: schema 演进 加 ProseMirror content + plain mirror
    // + shortId + visibility + embedding + embeddingModel; report 改为可空 (旧
    // 数据 fallback, Wave F cleanup commit 删除)。
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "studyId", type: "string", size: 64, required: true },
      { key: "studyTitle", type: "string", size: 512, required: true },
      { key: "question", type: "string", size: 4000, required: true },
      // shortId: 12-char alphanumeric URL-friendly id, unique within owner
      // (by_owner_short index). Wave A 数据用空字符串, 后端 lazy 补 (P-NB-01b)。
      { key: "shortId", type: "string", size: 12, required: false, default: "" },
      // ProseMirror JSON 文档 (Wave B 起 Morris createNotebook 写入此字段)。
      { key: "content", type: "string", size: JSON_SIZE, required: false, default: "" },
      // ProseMirror 抽出的 plain text, 用于 fulltext 检索 + embedding。
      { key: "textContent", type: "string", size: 50_000, required: false, default: "" },
      // Card-view fast fields, redundantly stored alongside `report` so a
      // listing query does not need to expand the full report jsonb.
      { key: "headline", type: "string", size: 512, required: true },
      { key: "summary", type: "string", size: 4000, required: true },
      { key: "confidence", type: "enum", elements: ["high", "medium", "low"], required: true },
      { key: "sampleSize", type: "integer", required: true },
      // R6 分享: internal (默认, 只 owner 可见) | published (可生成分享 token)
      {
        key: "visibility",
        type: "enum",
        elements: ["internal", "published"],
        required: false,
        default: "internal",
      },
      // 1024-dim Qwen DashScope text-embedding-v3 vector, JSON-serialized number[].
      // ~12KB / row.
      { key: "embedding", type: "string", size: 16_384, required: false, default: "" },
      { key: "embeddingModel", type: "string", size: 64, required: false, default: "" },
      // Wave F (T48): legacy `report` attribute removed. Notebook content
      // lives entirely in `content` (ProseMirror JSON) since Wave D.
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
      { key: "createdAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
      { key: "by_study", type: "key", attributes: ["studyId"] },
      { key: "by_owner_study", type: "key", attributes: ["ownerUserId", "studyId"] },
      { key: "by_owner_created", type: "key", attributes: ["ownerUserId", "createdAt"] },
      // Wave B: shortId-based lookup; unique within owner.
      { key: "by_owner_short", type: "unique", attributes: ["ownerUserId", "shortId"] },
      // Wave E: fulltext fallback for searchAcrossNotebooks when embedding is unavailable.
      { key: "by_text_search", type: "fulltext", attributes: ["textContent"] },
    ],
  },
  {
    id: "notebook_publish_tokens",
    name: "NotebookPublishToken",
    // Server-write only via dedicated Function; researchers do not write directly.
    // Anonymous (token-bearer) read path goes through a Function as well.
    permissions: [],
    documentSecurity: true,
    attributes: [
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
      // Notebook.shortId — links the token to the notebook it grants access to.
      { key: "notebookShortId", type: "string", size: 12, required: true },
      // 32-byte random hex (64 chars). Looked up by `by_token` unique index.
      { key: "token", type: "string", size: 64, required: true },
      { key: "expiresAt", type: "datetime", required: true },
      { key: "isRevoked", type: "boolean", required: false, default: false },
      { key: "createdAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "by_token", type: "unique", attributes: ["token"] },
      { key: "by_notebook", type: "key", attributes: ["notebookShortId"] },
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
    ],
  },
  {
    id: "dashboards",
    name: "Dashboard",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
      { key: "surveyId", type: "string", size: 64, required: true },
      { key: "scope", type: "enum", elements: ["study"], required: true },
      { key: "name", type: "string", size: 512, required: true },
      { key: "presetId", type: "string", size: 128, required: false },
      { key: "createdAt", type: "datetime", required: true },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
      { key: "by_owner_survey", type: "key", attributes: ["ownerUserId", "surveyId"] },
      { key: "by_survey", type: "key", attributes: ["surveyId"] },
    ],
  },
  {
    id: "dashboard_widgets",
    name: "DashboardWidget",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
      { key: "dashboardId", type: "string", size: 64, required: true },
      { key: "surveyId", type: "string", size: 64, required: true },
      {
        key: "widgetType",
        type: "enum",
        elements: [
          "study_progress",
          "recent_sessions",
          "top_themes",
          "top_insights",
          "sentiment_breakdown",
          "bookmarked_quotes",
          "visual_moments",
          "question_stats",
        ],
        required: true,
      },
      { key: "name", type: "string", size: 512, required: false },
      { key: "description", type: "string", size: 4000, required: false },
      { key: "config", type: "string", size: JSON_SIZE, required: false, default: "{}" },
      { key: "createdAt", type: "datetime", required: true },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
      { key: "by_dashboard", type: "key", attributes: ["dashboardId"] },
      { key: "by_survey", type: "key", attributes: ["surveyId"] },
    ],
  },
  {
    id: "dashboard_tiles",
    name: "DashboardTile",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
      { key: "dashboardId", type: "string", size: 64, required: true },
      { key: "surveyId", type: "string", size: 64, required: true },
      { key: "widgetId", type: "string", size: 64, required: true },
      { key: "layout", type: "string", size: JSON_SIZE, required: true },
      { key: "order", type: "integer", required: true },
      { key: "createdAt", type: "datetime", required: true },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
      { key: "by_dashboard", type: "key", attributes: ["dashboardId"] },
      { key: "by_dashboard_order", type: "key", attributes: ["dashboardId", "order"] },
      { key: "by_survey", type: "key", attributes: ["surveyId"] },
    ],
  },
  {
    id: "bookmarks",
    name: "Bookmark",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
      { key: "surveyId", type: "string", size: 64, required: true },
      { key: "sessionId", type: "string", size: 64, required: true },
      { key: "quote", type: "string", size: TEXT_SIZE, required: true },
      { key: "source", type: "string", size: 512, required: true },
      { key: "respondent", type: "string", size: 128, required: true },
      { key: "segmentIndex", type: "integer", required: false },
      { key: "startMs", type: "integer", required: false },
      { key: "note", type: "string", size: TEXT_SIZE, required: false, default: "" },
      // array 字段不写 default,由 contracts zod default([]) 兜底 (同 qualityFlags)
      { key: "tags", type: "string", size: 64, required: false, array: true },
      { key: "createdAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "by_owner_created", type: "key", attributes: ["ownerUserId", "createdAt"] },
      { key: "by_owner_session", type: "key", attributes: ["ownerUserId", "sessionId"] },
      { key: "by_workspace_session", type: "key", attributes: ["workspaceId", "sessionId"] },
      { key: "by_session", type: "key", attributes: ["sessionId"] },
    ],
  },
  {
    // ADR 0005: tracks the async post-session Gemini visual-analysis job +
    // its uploaded Gemini file. $id is deterministic (`vis_<sessionId>`) so
    // concurrent analyzeSessionVisual claims collide (409 = dedup). Function
    // writes only (API key bypasses SERVER_ONLY); owner reads per-document.
    id: "visual_analysis_jobs",
    name: "VisualAnalysisJob",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "sessionId", type: "string", size: 64, required: true },
      { key: "surveyId", type: "string", size: 64, required: true },
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "workspaceId", type: "string", size: 64, required: false },
      { key: "authorId", type: "string", size: 64, required: false },
      {
        key: "status",
        type: "enum",
        elements: ["queued", "uploading", "analyzing", "consolidating", "succeeded", "failed"],
        required: false,
        default: "queued",
      },
      // Gemini Files API resource name; null until upload returns one. The sweep's delete target.
      { key: "geminiFileName", type: "string", size: 256, required: false },
      { key: "geminiUploadedAt", type: "datetime", required: false },
      { key: "attemptCount", type: "integer", required: false, default: 0 },
      { key: "errorContext", type: "string", size: JSON_SIZE, required: false },
      { key: "createdAt", type: "datetime", required: true },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [
      // Drives the sweep scan: orphans by status + upload age.
      { key: "by_status_uploaded", type: "key", attributes: ["status", "geminiUploadedAt"] },
      { key: "by_session", type: "key", attributes: ["sessionId"] },
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
    ],
  },
  {
    // ADR 0006 (workspaces-billing). NOTE: a Workspace itself is an Appwrite
    // Team (created at runtime by createWorkspace), NOT a collection. The
    // collections below are the billing/usage storage the Functions manage
    // (SERVER_ONLY; per-document read pinned to the team/owner at creation).
    id: "plans",
    name: "Plan",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "key", type: "enum", elements: ["plus", "pro"], required: true },
      { key: "includedInterviews", type: "integer", required: true },
      { key: "features", type: "enum", elements: ["core", "visual_analysis", "survey_rollup"], required: false, array: true },
      { key: "priceRef", type: "string", size: 128, required: false },
    ],
    indexes: [{ key: "key_unique", type: "unique", attributes: ["key"] }],
  },
  {
    id: "subscriptions",
    name: "Subscription",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "workspaceId", type: "string", size: 64, required: true },
      { key: "planKey", type: "enum", elements: ["plus", "pro"], required: true },
      { key: "status", type: "enum", elements: ["trialing", "active", "past_due", "canceled"], required: true },
      { key: "seats", type: "integer", required: true },
      { key: "stripeCustomerId", type: "string", size: 64, required: false },
      { key: "stripeSubscriptionId", type: "string", size: 64, required: false },
      { key: "currentPeriodStart", type: "datetime", required: true },
      { key: "currentPeriodEnd", type: "datetime", required: true },
    ],
    indexes: [{ key: "by_workspace", type: "unique", attributes: ["workspaceId"] }],
  },
  {
    id: "usage_events",
    name: "UsageEvent",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "workspaceId", type: "string", size: 64, required: true },
      { key: "studyId", type: "string", size: 64, required: true },
      { key: "sessionId", type: "string", size: 64, required: true },
      { key: "unit", type: "enum", elements: ["completed_interview"], required: false, default: "completed_interview" },
      { key: "occurredAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "session_unique", type: "unique", attributes: ["sessionId"] },
      { key: "by_workspace", type: "key", attributes: ["workspaceId"] },
    ],
  },
  {
    id: "usage_counters",
    name: "UsageCounter",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "workspaceId", type: "string", size: 64, required: true },
      { key: "periodStart", type: "datetime", required: true },
      { key: "periodEnd", type: "datetime", required: true },
      { key: "completedInterviews", type: "integer", required: false, default: 0 },
    ],
    indexes: [{ key: "by_workspace_period", type: "unique", attributes: ["workspaceId", "periodStart"] }],
  },
  {
    id: "workspace_quota",
    name: "WorkspaceQuota",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "workspaceId", type: "string", size: 64, required: true },
      { key: "periodEnd", type: "datetime", required: true },
      { key: "usedInterviews", type: "integer", required: false, default: 0 },
      { key: "includedInterviews", type: "integer", required: true },
      { key: "hardCeiling", type: "integer", required: true },
      { key: "state", type: "enum", elements: ["ok", "over"], required: false, default: "ok" },
    ],
    indexes: [{ key: "by_workspace", type: "unique", attributes: ["workspaceId"] }],
  },
  {
    // Denormalized read view of Appwrite Team membership (the Team is canonical).
    id: "workspace_memberships",
    name: "WorkspaceMembership",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [
      { key: "workspaceId", type: "string", size: 64, required: true },
      { key: "userId", type: "string", size: 64, required: true },
      { key: "role", type: "enum", elements: ["owner", "admin", "member"], required: true },
      { key: "status", type: "enum", elements: ["active", "invited"], required: false, default: "invited" },
      { key: "invitedBy", type: "string", size: 64, required: false },
      { key: "createdAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "by_workspace", type: "key", attributes: ["workspaceId"] },
      { key: "by_user", type: "key", attributes: ["userId"] },
      { key: "member_unique", type: "unique", attributes: ["workspaceId", "userId"] },
    ],
  },
  {
    // ADR 0006 M5: Stripe webhook idempotency store. $id == Stripe event id;
    // presence = already processed (replays acked without re-applying).
    id: "stripe_events",
    name: "StripeEvent",
    permissions: SERVER_ONLY,
    documentSecurity: true,
    attributes: [{ key: "processedAt", type: "datetime", required: true }],
    indexes: [],
  },
  {
    // Morris page assistant conversation persistence
    // (per .kiro/specs/morris-conversation-persistence/).
    //
    // Owner-scoped: each researcher's conversations are private to them.
    // documentSecurity=true → per-doc permissions pinned at creation pin
    // read+update+delete to the creator (Role.user(ownerUserId)) so even
    // another researcher co-residing on the same Appwrite instance cannot list
    // or load the rows.
    //
    // messagesJson is a JSON.stringify(UIMessage[]) string. Schema-level
    // upper bound is JSON_SIZE (1MB); contract-level early bound is 256KB
    // (MAX_MESSAGES_JSON_BYTES) — front-end compaction.ts (token budget 12K)
    // keeps real conversations well below either ceiling.
    id: "conversations",
    name: "Conversation",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "title", type: "string", size: 256, required: false, default: "" },
      { key: "messagesJson", type: "string", size: JSON_SIZE, required: false, default: "[]" },
      { key: "messageCount", type: "integer", required: false, default: 0 },
      { key: "lastMessageAt", type: "datetime", required: true },
      { key: "lastMessagePreview", type: "string", size: 256, required: false, default: "" },
      { key: "createdAt", type: "datetime", required: true },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [
      // owner-scoped lookup (used by listConversations + ownership check
      // in load/save/delete).
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
      // History drawer / HistoryPreview ordering: most-recent activity first.
      { key: "by_owner_lastmsg", type: "key", attributes: ["ownerUserId", "lastMessageAt"] },
      // Created/updated orderings as secondary sort (admin / debug surfaces).
      { key: "by_owner_created", type: "key", attributes: ["ownerUserId", "createdAt"] },
      { key: "by_owner_updated", type: "key", attributes: ["ownerUserId", "updatedAt"] },
    ],
  },
  {
    // Morris page assistant long-term memory
    // (per .kiro/specs/morris-memory/).
    //
    // Owner-scoped: each researcher's memories are private to them.
    // documentSecurity=true → per-doc permissions pin read+update+delete to
    // the creator (Role.user(ownerUserId)) so a co-residing researcher cannot
    // list or load the rows.
    //
    // content is the embedded fact text (1-4000 chars). metadata is JSON
    // tag-shape (e.g. {"type":"preference","domain":"fintech"}). metadataKeys
    // is redundant Object.keys(metadata) so Appwrite can index/Query.contains
    // (Appwrite has no jsonb-inner index). embedding is JSON-stringified
    // number[1024] from Qwen text-embedding-v3, same shape as Notebook.
    id: "morris_memories",
    name: "MorrisMemory",
    permissions: OWNER_SCOPED,
    documentSecurity: true,
    attributes: [
      { key: "content", type: "string", size: 4000, required: true },
      { key: "metadata", type: "string", size: JSON_SIZE, required: false, default: "{}" },
      { key: "metadataKeys", type: "string", size: 64, required: false, array: true },
      { key: "embedding", type: "string", size: 16_384, required: false, default: "" },
      { key: "embeddingModel", type: "string", size: 64, required: false, default: "" },
      { key: "ownerUserId", type: "string", size: 64, required: true },
      { key: "createdAt", type: "datetime", required: true },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [
      // owner-scoped lookup (listMemoriesForOwner + ownership check on load/update/delete).
      { key: "by_owner", type: "key", attributes: ["ownerUserId"] },
      // most-recent ordering for system-prompt prepend (newest 20 first).
      { key: "by_owner_updated", type: "key", attributes: ["ownerUserId", "updatedAt"] },
      // metadata-tag filter (manageMemories action=query/list with metadataFilter).
      { key: "by_metadata_keys", type: "key", attributes: ["metadataKeys"] },
      // fulltext fallback when Qwen embedder is unavailable (per design.md §5).
      { key: "by_text_search", type: "fulltext", attributes: ["content"] },
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
