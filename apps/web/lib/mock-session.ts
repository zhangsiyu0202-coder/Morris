import type { InterviewRuntimeQuestion } from "@merism/contracts";

/*
 * Mock runtime questions covering all five responseModes.
 * In production these arrive from the agent via the
 * `merism.interviewState` participant attribute — this fixture lets the
 * renderer be developed and previewed without a live LiveKit connection.
 */
export const MOCK_STUDY_TITLE = "远程办公协作工具使用体验";

export const MOCK_RUNTIME_QUESTIONS: InterviewRuntimeQuestion[] = [
  {
    questionId: "question-1-1",
    sectionId: "section-1",
    sectionTitle: "整体印象",
    orderInSection: 0,
    questionText: "先聊聊你目前在团队里主要用哪些协作工具？当初是怎么开始用的？",
    questionType: "open_ended",
    probeLevel: "deep",
    probeInstruction: "追问触发场景与第一次使用的感受。",
    options: [],
    responseMode: "voice_only",
  },
  {
    questionId: "question-1-2",
    sectionId: "section-1",
    sectionTitle: "整体印象",
    orderInSection: 1,
    questionText: "在下面这些场景里，你觉得现有工具最常掉链子的是哪一个？",
    questionType: "single_choice",
    probeLevel: "follow_up",
    probeInstruction: "追问为什么选这个场景。",
    options: ["跨时区排会", "文件版本同步", "异步消息跟进", "视频会议质量"],
    responseMode: "single_select",
  },
  {
    questionId: "question-2-1",
    sectionId: "section-2",
    sectionTitle: "功能诉求",
    orderInSection: 0,
    questionText: "以下哪些能力如果做得更好，会真正改变你的日常？（可多选）",
    questionType: "multi_choice",
    probeLevel: "none",
    probeInstruction: "",
    options: ["智能会议纪要", "自动任务分派", "跨工具搜索", "权限与安全", "离线可用"],
    responseMode: "multi_select",
  },
  {
    questionId: "question-2-2",
    sectionId: "section-2",
    sectionTitle: "功能诉求",
    orderInSection: 1,
    questionText: "总体而言，你有多大可能把现在这套工具推荐给同行？",
    questionType: "nps",
    probeLevel: "follow_up",
    probeInstruction: "追问打分背后的主要原因。",
    options: [],
    responseMode: "scale",
  },
  {
    questionId: "question-3-1",
    sectionId: "section-3",
    sectionTitle: "优先级",
    orderInSection: 0,
    questionText: "请把这几项改进按对你的重要程度从高到低排序。",
    questionType: "ranking",
    probeLevel: "none",
    probeInstruction: "",
    options: ["更快的同步", "更少的通知打扰", "更强的搜索", "更好的移动端"],
    responseMode: "ranking",
  },
];
