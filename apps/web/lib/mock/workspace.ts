/**
 * Study 工作台各视图的 **mock 数据**(Overview / Results / Transcript / Recruit)。
 *
 * 这些数据当前用于 UI 重绘阶段,形状刻意贴合 `@merism/contracts`
 * 的 InterviewSession / Transcript 等实体,以便后续无损替换为
 * `lib/queries/*`(Appwrite)的真实查询,而无需改动展示组件。
 *
 * 范围安全说明:不包含任何计费 / 配额 / 第三方招募面板概念
 * (见 AGENTS.md 永久排除项)。Recruit 仅提供匿名分享链接与完成跳转。
 */

/** 受访会话的展示态状态(由契约 SessionState 收敛而来)。 */
export type SessionDisplayStatus = "completed" | "incomplete" | "in_progress";

export const SESSION_STATUS_LABELS: Record<SessionDisplayStatus, string> = {
  completed: "已完成",
  incomplete: "未完成",
  in_progress: "进行中",
};

/** Overview:最近一次访谈的精简条目。 */
export type LatestInterview = {
  sessionId: string;
  /** 已格式化的本地时间字符串(mock 固定,避免水合时区漂移)。 */
  datetime: string;
  status: SessionDisplayStatus;
};

export type WorkspaceOverview = {
  responsesTotal: number;
  completedInterviews: number;
  /** 是否处于已暂停/关闭态(决定是否展示横幅)。 */
  paused: boolean;
  latest: LatestInterview[];
};

/** Results:结果大表的一行,answers 对齐到 guide 的问题。 */
export type ResultRow = {
  sessionId: string;
  date: string;
  status: SessionDisplayStatus;
  task: string;
  summary: string;
  /** 与表头问题列对应的回答(顺序即列顺序)。 */
  answers: string[];
};

export type ResultsTable = {
  /** 问题列表头(截断后的短标签)。 */
  questionColumns: string[];
  rows: ResultRow[];
  totalCount: number;
};

/** Transcript:逐条对话段。 */
export type TranscriptTurn = {
  speaker: "interviewer" | "respondent";
  text: string;
  /** 当该轮对应某个提纲问题时,标注问题序号,如 "Q1"。 */
  questionTag?: string;
  /** 原始 segments 数组下标,用于书签 segmentIndex。 */
  segmentIndex: number;
  /** 段起始毫秒,用于受访者时间标签。 */
  startMs: number;
};

import type { Recording, VisualAnalysisOutput } from "@merism/contracts";

export type TranscriptDetail = {
  sessionId: string;
  datetime: string;
  language: string;
  turns: TranscriptTurn[];
  aiSummary: string;
  visualAnalysis: VisualAnalysisOutput | null;
  metadata: { key: string; value: string }[];
  recording: Recording | null;
};

/** Recruit:范围安全的分享配置(匿名链接 + 完成跳转)。 */
export type RecruitMock = {
  shareableUrl: string;
  testUrl: string;
  completionUrl: string;
};

// ---------------------------------------------------------------------------
// Builders —— 以 studyId / sessionId 为种子返回确定性的 mock。
// ---------------------------------------------------------------------------

export function getMockOverview(_studyId: string): WorkspaceOverview {
  return {
    responsesTotal: 13,
    completedInterviews: 9,
    paused: true,
    latest: [
      { sessionId: "ses_8f21", datetime: "2024-11-11 19:46", status: "incomplete" },
      { sessionId: "ses_8e90", datetime: "2024-11-11 18:23", status: "completed" },
      { sessionId: "ses_8e7c", datetime: "2024-11-11 18:19", status: "completed" },
      { sessionId: "ses_8e55", datetime: "2024-11-11 18:13", status: "completed" },
      { sessionId: "ses_8e30", datetime: "2024-11-11 18:09", status: "completed" },
      { sessionId: "ses_8e0a", datetime: "2024-11-11 17:58", status: "incomplete" },
    ],
  };
}

export function getMockResults(_studyId: string): ResultsTable {
  return {
    questionColumns: [
      "Q1:寻找住处时常用的网站或 App?",
      "Q2:订住宿时最让你抓狂的事?",
    ],
    rows: [
      {
        sessionId: "ses_8e90",
        date: "2025-01-22",
        status: "in_progress",
        task: "Airbnb 任务",
        summary:
          "通常先看 Airbnb 和 Booking 比价,独特房源更信任 Airbnb。",
        answers: [
          "一般先看 Airbnb,再看 Booking,有时也看 Hotels.com。",
          "看到心仪的房源已被订走、或结账时价格跳涨最让人崩溃。",
        ],
      },
      {
        sessionId: "ses_8e7c",
        date: "2025-01-23",
        status: "in_progress",
        task: "Airbnb 任务",
        summary: "主要用 Airbnb、Booking 和 Vrbo,视行程而定。",
        answers: [
          "知道要找什么后其实挺简单,按价格和评分筛一下就行。",
          "为看全价被迫注册账号很烦,隐藏费用也很讨厌。",
        ],
      },
      {
        sessionId: "ses_8e55",
        date: "2025-02-01",
        status: "completed",
        task: "Airbnb 任务",
        summary: "先用 Google Hotels 看全局,再去 Airbnb 找更个性的。",
        answers: [
          "先 Google Hotels,再 Airbnb,结果不好时也看 Booking。",
          "照片和实物不符最糟,之前被误导性图片坑过。",
        ],
      },
      {
        sessionId: "ses_8e30",
        date: "2025-02-01",
        status: "incomplete",
        task: "Airbnb 任务",
        summary: "主要用 Booking,觉得更可靠,适合临时订酒店。",
        answers: [
          "基本只用 Booking,体验上最可靠,尤其订酒店。",
          "想找真正适合家庭的很难,筛选项有但结果不准。",
        ],
      },
    ],
    totalCount: 29,
  };
}

export function getMockTranscript(sessionId: string): TranscriptDetail {
  return {
    sessionId,
    datetime: "2024-09-27 13:42",
    language: "中文",
    turns: [
      {
        speaker: "respondent",
        text: "我刚在等零食送到门口。我很想试试,我喜欢尝新东西。从外观看就很好吃,尤其那个像罐子的,我想先试它。",
        segmentIndex: 0,
        startMs: 0,
      },
      {
        speaker: "interviewer",
        questionTag: "Q1",
        text: "很高兴听到!Fruitabar Clusters 具体哪里吸引你?是口味、配料还是别的?",
        segmentIndex: 1,
        startMs: 12000,
      },
      {
        speaker: "respondent",
        text: "包装挺酷的,质感和口味的呈现都不错。说实话包装这点就挺打动我。",
        segmentIndex: 2,
        startMs: 28000,
      },
      {
        speaker: "interviewer",
        questionTag: "Q2",
        text: "如果在超市看到这款零食、价格合理,你会买吗?说说你的想法。",
        segmentIndex: 3,
        startMs: 45000,
      },
      {
        speaker: "respondent",
        text: "会,看到这样的我会买,因为我相信看到的品质,也会推荐给亲友——光凭包装就够了。",
        segmentIndex: 4,
        startMs: 62000,
      },
      {
        speaker: "interviewer",
        questionTag: "Q3",
        text: "你觉得这种产品什么价位算合理?如果配料优质,你愿意付溢价吗?",
        segmentIndex: 5,
        startMs: 80000,
      },
      {
        speaker: "respondent",
        text: "三块左右算公道,品质真的好的话四块也行。东西好吃、配料好,我不介意多付一点,也要看分量。",
        segmentIndex: 6,
        startMs: 98000,
      },
    ],
    aiSummary:
      "受访者最初给出 3 美元的心理价位,随后表示 4 美元也可接受;若产品达到预期,愿意支付更高价格。整体上,基于包装与感知价值,受访者表现出较强的尝试意愿。",
    visualAnalysis: null,
    metadata: [
      { key: "profile_uid", value: "usr_9f3a12bc84d" },
      { key: "session_id", value: sessionId },
      { key: "date", value: "2024-09-27 13:42" },
      { key: "duration", value: "14 分 23 秒" },
      { key: "status", value: "已完成" },
    ],
    recording: null,
  };
}

export function getMockRecruit(studyId: string): RecruitMock {
  const base = `https://app.merism.example/i/${studyId}`;
  return {
    shareableUrl: base,
    testUrl: `${base}?test=1`,
    completionUrl: "",
  };
}

/** 首页书签墙的一条书签(受访片段)。 */
export type HomeBookmark = {
  id: string;
  respondent: string;
  date: string;
  quote: string;
  source: string;
};

// ---------------------------------------------------------------------------
// Removed: getMockBookmarks — real bookmarks load via lib/home-data.ts.
// ---------------------------------------------------------------------------
