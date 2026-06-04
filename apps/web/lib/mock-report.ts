// Survey-level aggregated report view model.
//
// This represents the shape a future aggregation API will return: it rolls up
// every respondent's answers for one survey into distributions, plus the AI
// content-analysis output (themes / sentiment / insights / citations).
// For now it's mock data so the report UI can be built and reviewed; swap the
// data source once the backend `analyzeSurvey` endpoint exists.

export type ChoiceDatum = {
  label: string
  count: number
  pct: number
  // Qualitative blurb shown when this option's accordion row is expanded.
  blurb?: string
  // Keywords inside `blurb` to underline for emphasis.
  keywords?: string[]
}
export type RatingDatum = { score: number; count: number }
export type SentimentDatum = {
  sentiment: "positive" | "neutral" | "negative"
  count: number
}

export type QuestionStat =
  | {
      questionId: string
      questionText: string
      kind: "choice"
      multi: boolean
      total: number
      reportQuestion: string
      summary: string
      data: ChoiceDatum[]
    }
  | {
      questionId: string
      questionText: string
      kind: "rating"
      total: number
      average: number
      scaleMax: number
      reportQuestion: string
      summary: string
      data: RatingDatum[]
    }
  | {
      questionId: string
      questionText: string
      kind: "nps"
      total: number
      score: number // -100..100
      promoters: number
      passives: number
      detractors: number
      reportQuestion: string
      summary: string
    }

export type Theme = {
  id: string
  label: string
  mentions: number
  pct: number
  sentiment: "positive" | "neutral" | "negative"
}

export type Insight = {
  id: string
  title: string
  text: string
  confidence: number // 0..1
}

export type SurveyReport = {
  surveyId: string
  surveyTitle: string
  totalRespondents: number
  completedRespondents: number
  avgDurationLabel: string
  avgProbeRounds: number
  studyCount: number
  lastUpdatedLabel: string
  topics: string[]
  questionStats: QuestionStat[]
  sentimentBreakdown: SentimentDatum[]
  themes: Theme[]
  insights: Insight[]
}

export const MOCK_REPORT: SurveyReport = {
  surveyId: "sv_collab_2026q2",
  surveyTitle: "协作工具使用体验调研",
  totalRespondents: 142,
  completedRespondents: 128,
  avgDurationLabel: "11:24",
  avgProbeRounds: 2.3,
  studyCount: 3,
  lastUpdatedLabel: "2 天前",
  topics: [
    "探索团队在日常协作中最常使用的工具与平台。",
    "识别用户在文件协作与版本管理中遇到的核心障碍。",
    "理解用户对跨工具搜索与信息聚合的真实诉求。",
    "评估用户对当前主力工具的整体满意度与迁移意愿。",
    "衡量用户对自动化会议纪要与任务分派的期待程度。",
    "对比异步沟通与实时沟通在不同场景下的体验差异。",
    "收集用户对协作工具安全与权限管理的顾虑。",
  ],
  questionStats: [
    {
      questionId: "q_pain",
      questionText: "现有工具最常掉链子的场景是哪一个？",
      kind: "choice",
      multi: false,
      total: 128,
      reportQuestion: "受访者最常提到的协作失败场景集中在哪些环节？",
      summary: "多数受访者把矛头指向文件版本同步，常见描述是同一份文档存在多个版本、无法确认最新版。",
      data: [
        {
          label: "文件版本同步",
          count: 47,
          pct: 36.7,
          blurb:
            "文件版本同步被频繁提及为最大痛点，受访者普遍抱怨同一份文档存在多个版本、难以确认哪份最新，导致返工和沟通成本上升。情感整体偏负面。",
          keywords: ["文件版本同步", "多个版本", "返工"],
        },
        {
          label: "跨时区排会",
          count: 38,
          pct: 29.7,
          blurb:
            "分布式团队反复提到跨时区排会的协调成本，需要在多个日历间手动比对空档，常因时差导致会议被安排在非工作时间。",
          keywords: ["跨时区排会", "协调成本", "时差"],
        },
        {
          label: "异步消息跟进",
          count: 28,
          pct: 21.9,
          blurb:
            "异步消息跟进的体验尚可，但信息容易被淹没在消息流里，重要事项缺乏明确的跟进与闭环机制。",
          keywords: ["异步消息跟进", "淹没", "闭环"],
        },
        {
          label: "视频会议质量",
          count: 15,
          pct: 11.7,
          blurb:
            "视频会议质量问题相对少见，主要集中在弱网环境下的卡顿与音画不同步，多数受访者认为可以接受。",
          keywords: ["视频会议质量", "卡顿"],
        },
      ],
    },
    {
      questionId: "q_features",
      questionText: "你最希望补齐的能力（可多选）",
      kind: "choice",
      multi: true,
      total: 128,
      reportQuestion: "受访者最期待补齐的协作能力有哪些？",
      summary: "智能会议纪要呼声最高，受访者期待开完会自动产出纪要与待办，省去手动整理的负担。",
      data: [
        {
          label: "智能会议纪要",
          count: 96,
          pct: 75.0,
          blurb:
            "智能会议纪要的需求远高于其他功能且情感正面，受访者期待会议结束后自动产出纪要与待办，被视为最值得优先投入的能力。",
          keywords: ["智能会议纪要", "自动产出", "待办"],
        },
        {
          label: "跨工具搜索",
          count: 81,
          pct: 63.3,
          blurb:
            "跨工具搜索是高频诉求，受访者的信息散落在文档、消息与任务系统中，难以在一处统一检索。",
          keywords: ["跨工具搜索", "统一检索"],
        },
        {
          label: "自动任务分派",
          count: 64,
          pct: 50.0,
          blurb:
            "自动任务分派被视为减轻管理负担的有效手段，期待系统能根据会议与讨论自动生成并指派任务。",
          keywords: ["自动任务分派", "指派任务"],
        },
        {
          label: "权限与安全",
          count: 39,
          pct: 30.5,
          blurb:
            "部分受访者对权限与数据安全较为敏感，尤其在涉及外部协作方时，希望有更细粒度的访问控制。",
          keywords: ["权限与安全", "访问控制"],
        },
        {
          label: "离线可用",
          count: 22,
          pct: 17.2,
          blurb:
            "离线可用属于小众但坚定的需求，主要来自经常出差或网络不稳定环境下工作的受访者。",
          keywords: ["离线可用"],
        },
      ],
    },
    {
      questionId: "q_satisfaction",
      questionText: "对当前主力工具的整体满意度（1-5）",
      kind: "rating",
      total: 128,
      average: 3.4,
      scaleMax: 5,
      reportQuestion: "受访者对当前主力工具的整体满意度如何分布？",
      summary: "满意度集中在 3-4 分，属于能用但不惊艳，鲜有强烈不满，也少有忠实拥护者。",
      data: [
        { score: 1, count: 9 },
        { score: 2, count: 21 },
        { score: 3, count: 38 },
        { score: 4, count: 42 },
        { score: 5, count: 18 },
      ],
    },
    {
      questionId: "q_nps",
      questionText: "你有多大可能把它推荐给同事？",
      kind: "nps",
      total: 128,
      score: 18,
      promoters: 58,
      passives: 47,
      detractors: 23,
      reportQuestion: "受访者向同事推荐当前工具的净推荐值是多少？",
      summary: "净推荐值为正但不高，推荐者略多于贬损者，多数人处于中立观望状态。",
    },
  ],
  sentimentBreakdown: [
    { sentiment: "positive", count: 71 },
    { sentiment: "neutral", count: 39 },
    { sentiment: "negative", count: 18 },
  ],
  themes: [
    { id: "t1", label: "上下文切换成本高", mentions: 64, pct: 50.0, sentiment: "negative" },
    { id: "t2", label: "渴望自动化纪要", mentions: 52, pct: 40.6, sentiment: "positive" },
    { id: "t3", label: "搜索分散在多工具", mentions: 41, pct: 32.0, sentiment: "negative" },
    { id: "t4", label: "异步沟通体验尚可", mentions: 33, pct: 25.8, sentiment: "neutral" },
    { id: "t5", label: "对数据安全敏感", mentions: 19, pct: 14.8, sentiment: "neutral" },
  ],
  insights: [
    {
      id: "i1",
      title: "统一工作空间是真实诉求",
      text: "文件版本混乱是头号痛点，且多与跨工具协作同时出现，说明用户真正需要的是统一工作空间，而非孤立的单点功能。",
      confidence: 0.86,
    },
    {
      id: "i2",
      title: "智能纪要是最佳增长点",
      text: "对智能会议纪要的需求远高于其他功能，且情感正面，是最值得优先投入资源的增长机会。",
      confidence: 0.78,
    },
    {
      id: "i3",
      title: "通知过载需进一步验证",
      text: "贬损者集中抱怨通知过载，但样本量偏小，建议补充定向访谈后再下结论，避免过度解读。",
      confidence: 0.52,
    },
    {
      id: "i4",
      title: "迁移成本锁住中立用户",
      text: "大量中立用户表示工具凑合能用，真正阻碍他们更换的是迁移成本，而非现有工具足够好。",
      confidence: 0.71,
    },
  ],
}
