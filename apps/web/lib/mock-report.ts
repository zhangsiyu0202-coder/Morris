// Survey-level aggregated report view model.
//
// This represents the shape a future aggregation API will return: it rolls up
// every respondent's answers for one survey into distributions, plus the AI
// content-analysis output (themes / sentiment / insights / citations).
// For now it's mock data so the report UI can be built and reviewed; swap the
// data source once the backend `analyzeSurvey` endpoint exists.

export type ChoiceDatum = { label: string; count: number; pct: number }
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
      data: ChoiceDatum[]
    }
  | {
      questionId: string
      questionText: string
      kind: "rating"
      total: number
      average: number
      scaleMax: number
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
  text: string
  confidence: number // 0..1
}

export type QuestionSummary = {
  questionId: string
  questionText: string
  summary: string
  sentiment: "positive" | "neutral" | "negative"
  citation?: string
}

export type SurveyReport = {
  surveyId: string
  surveyTitle: string
  totalRespondents: number
  completedRespondents: number
  avgDurationMin: number
  avgProbeRounds: number
  questionStats: QuestionStat[]
  sentimentBreakdown: SentimentDatum[]
  themes: Theme[]
  insights: Insight[]
  questionSummaries: QuestionSummary[]
}

export const MOCK_REPORT: SurveyReport = {
  surveyId: "sv_collab_2026q2",
  surveyTitle: "协作工具使用体验调研",
  totalRespondents: 142,
  completedRespondents: 128,
  avgDurationMin: 11.4,
  avgProbeRounds: 2.3,
  questionStats: [
    {
      questionId: "q_pain",
      questionText: "现有工具最常掉链子的场景是哪一个？",
      kind: "choice",
      multi: false,
      total: 128,
      data: [
        { label: "文件版本同步", count: 47, pct: 36.7 },
        { label: "跨时区排会", count: 38, pct: 29.7 },
        { label: "异步消息跟进", count: 28, pct: 21.9 },
        { label: "视频会议质量", count: 15, pct: 11.7 },
      ],
    },
    {
      questionId: "q_features",
      questionText: "你最希望补齐的能力（可多选）",
      kind: "choice",
      multi: true,
      total: 128,
      data: [
        { label: "智能会议纪要", count: 96, pct: 75.0 },
        { label: "跨工具搜索", count: 81, pct: 63.3 },
        { label: "自动任务分派", count: 64, pct: 50.0 },
        { label: "权限与安全", count: 39, pct: 30.5 },
        { label: "离线可用", count: 22, pct: 17.2 },
      ],
    },
    {
      questionId: "q_satisfaction",
      questionText: "对当前主力工具的整体满意度（1-5）",
      kind: "rating",
      total: 128,
      average: 3.4,
      scaleMax: 5,
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
      text: "文件版本混乱是头号痛点，且多与跨工具协作同时出现，说明用户真正需要的是统一工作空间而非单点功能。",
      confidence: 0.86,
    },
    {
      id: "i2",
      text: "对智能会议纪要的需求远高于其他功能，且情感正面，是最值得优先投入的增长点。",
      confidence: 0.78,
    },
    {
      id: "i3",
      text: "贬损者集中抱怨通知过载，但样本量偏小，建议补充定向访谈再下结论。",
      confidence: 0.52,
    },
  ],
  questionSummaries: [
    {
      questionId: "q_pain",
      questionText: "现有工具最常掉链子的场景是哪一个？",
      summary: "多数受访者把矛头指向文件版本同步，常见描述是“同一份文档存在好几个版本，不知道哪个最新”。",
      sentiment: "negative",
      citation: "“我们团队光是确认哪份是最终版，每周就要浪费小半天。”",
    },
    {
      questionId: "q_features",
      questionText: "你最希望补齐的能力",
      summary: "智能会议纪要呼声最高，受访者期待开完会自动产出纪要和待办，省去手动整理。",
      sentiment: "positive",
      citation: "“如果开完会纪要和任务能自动出来，我能省下每天最烦的半小时。”",
    },
    {
      questionId: "q_satisfaction",
      questionText: "对当前主力工具的整体满意度",
      summary: "满意度集中在 3-4 分，属于“能用但不惊艳”，鲜有强烈不满，也少有忠实拥护者。",
      sentiment: "neutral",
      citation: "“凑合用吧，换工具的迁移成本更让我头疼。”",
    },
  ],
}
