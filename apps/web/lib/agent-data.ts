// Mock data source backing the assistant's tools. This stands in for the
// future backend (study store + interview analytics). Tools return real
// structured results so the UI/interaction is production-shaped; only the
// data origin is mocked, matching the project's progressive strategy.

export type StudySummary = {
  id: string;
  title: string;
  status: "draft" | "live" | "closed";
  responses: number;
  completionRate: number;
};

export type InterviewSnippet = {
  studyId: string;
  studyTitle: string;
  respondent: string;
  questionTitle: string;
  quote: string;
  sentiment: "positive" | "neutral" | "negative";
};

export const STUDIES: StudySummary[] = [
  { id: "st_travel", title: "差旅住宿预订习惯调研", status: "live", responses: 128, completionRate: 0.9 },
  { id: "st_onboard", title: "新用户引导体验访谈", status: "live", responses: 64, completionRate: 0.82 },
  { id: "st_pricing", title: "订阅定价敏感度研究", status: "closed", responses: 211, completionRate: 0.95 },
  { id: "st_mobile", title: "移动端导航可用性测试", status: "draft", responses: 0, completionRate: 0 },
];

const SNIPPETS: InterviewSnippet[] = [
  {
    studyId: "st_travel",
    studyTitle: "差旅住宿预订习惯调研",
    respondent: "P-014",
    questionTitle: "你预订住宿时最常用哪些网站或 App?",
    quote: "我基本只用 Airbnb,因为它的房源照片真实,房东沟通也直接。",
    sentiment: "positive",
  },
  {
    studyId: "st_travel",
    studyTitle: "差旅住宿预订习惯调研",
    respondent: "P-027",
    questionTitle: "你在搜索住宿时遇到过哪些困扰?",
    quote: "筛选条件太弱了,我想按步行距离排序根本做不到,得一个个点开看地图。",
    sentiment: "negative",
  },
  {
    studyId: "st_travel",
    studyTitle: "差旅住宿预订习惯调研",
    respondent: "P-041",
    questionTitle: "你预订住宿时最常用哪些网站或 App?",
    quote: "比价的时候会同时开 Google 和携程,但最后大多还是回到酒店官网下单。",
    sentiment: "neutral",
  },
  {
    studyId: "st_pricing",
    studyTitle: "订阅定价敏感度研究",
    respondent: "P-103",
    questionTitle: "什么价格会让你犹豫是否续订?",
    quote: "超过每月 40 块我就会认真想想到底用不用得上,免费试用结束前一定会提醒自己。",
    sentiment: "neutral",
  },
  {
    studyId: "st_onboard",
    studyTitle: "新用户引导体验访谈",
    respondent: "P-058",
    questionTitle: "第一次使用时哪一步最让你卡住?",
    quote: "注册完之后我完全不知道下一步该干嘛,引导提示一闪而过没看清。",
    sentiment: "negative",
  },
];

export function searchSnippets(query: string, studyId?: string): InterviewSnippet[] {
  const q = query.trim().toLowerCase();
  return SNIPPETS.filter((s) => {
    if (studyId && s.studyId !== studyId) return false;
    if (!q) return true;
    return (
      s.quote.toLowerCase().includes(q) ||
      s.questionTitle.toLowerCase().includes(q) ||
      s.studyTitle.toLowerCase().includes(q)
    );
  });
}

export type AnalysisSlice = {
  metric: string;
  value: string;
  detail: string;
};

export function analyzeStudy(studyId?: string): {
  studyTitle: string;
  headline: string;
  slices: AnalysisSlice[];
  themes: { label: string; share: number }[];
} {
  const study = STUDIES.find((s) => s.id === studyId) ?? STUDIES[0];
  return {
    studyTitle: study.title,
    headline: `共 ${study.responses} 位受访者,完成率 ${Math.round(study.completionRate * 100)}%。Airbnb 是最高频提及的平台,但搜索筛选能力是主要痛点。`,
    slices: [
      { metric: "样本量", value: `${study.responses}`, detail: "已完成访谈数" },
      { metric: "正面情感", value: "58%", detail: "对房源真实性与房东沟通满意" },
      { metric: "主要痛点", value: "搜索筛选", detail: "37% 的受访者主动提及" },
    ],
    themes: [
      { label: "房源真实性", share: 0.42 },
      { label: "搜索与筛选体验", share: 0.37 },
      { label: "比价行为", share: 0.31 },
      { label: "直订偏好", share: 0.22 },
    ],
  };
}
