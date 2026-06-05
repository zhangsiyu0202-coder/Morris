"use client";

import { useState, useTransition, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Check,
  ChevronUp,
  ChevronDown,
  DoorOpen,
  Star,
  AlignLeft,
  X,
  CornerDownRight,
} from "lucide-react";
import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  PROBE_LEVEL_LABELS,
  STATUS_LABELS,
  TYPES_NEEDING_OPTIONS,
  emptySection,
  emptyQuestion,
  countQuestions,
  type Guide,
  type GuideSection,
  type GuideQuestion,
  type QuestionType,
  type ProbeLevel,
  type StudyStatus,
} from "@/lib/guide";
import {
  updateStudyMeta,
  saveGuide,
  updateStudyStatus,
  type StudyDetail,
} from "@/lib/actions/studies";
import { generateGuide, expandSection } from "@/lib/actions/guide-ai";

type SaveState = "idle" | "saving" | "saved";

/** 当前选中的块:开场 / 某分节 / 某问题。 */
type Selection =
  | { kind: "intro" }
  | { kind: "section"; sid: string }
  | { kind: "question"; sid: string; qid: string };

/** 题型对应的短标记(左栏与画布用)。 */
const TYPE_BADGE: Record<QuestionType, string> = {
  open_ended: "开",
  single_choice: "单",
  multi_choice: "多",
  rating: "评",
  nps: "NPS",
  ranking: "排",
};

export function GuideEditor({ study }: { study: StudyDetail }) {
  const [title, setTitle] = useState(study.title);
  const [researchGoal, setResearchGoal] = useState(study.researchGoal);
  const [targetAudience, setTargetAudience] = useState(study.targetAudience);
  const [introScript, setIntroScript] = useState(study.introScript);
  const [status, setStatus] = useState<StudyStatus>(study.status);
  const [guide, setGuide] = useState<Guide>(study.guide);

  const [selection, setSelection] = useState<Selection>({ kind: "intro" });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const markDirty = () => setDirty(true);

  // ---- 保存 ----
  const handleSave = useCallback(() => {
    setSaveState("saving");
    startTransition(async () => {
      await updateStudyMeta(study.id, { title, researchGoal, targetAudience, introScript });
      await saveGuide(study.id, guide);
      setDirty(false);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1800);
    });
  }, [study.id, title, researchGoal, targetAudience, introScript, guide]);

  const handleStatusChange = (next: StudyStatus) => {
    setStatus(next);
    startTransition(async () => {
      await updateStudyStatus(study.id, next);
    });
  };

  // ---- guide 变更帮助函数 ----
  const setGuideDirty = (updater: (g: Guide) => Guide) => {
    setGuide(updater);
    markDirty();
  };

  const updateSection = (sid: string, patch: Partial<GuideSection>) =>
    setGuideDirty((g) => ({
      sections: g.sections.map((s) => (s.id === sid ? { ...s, ...patch } : s)),
    }));

  const removeSection = (sid: string) => {
    setGuideDirty((g) => ({ sections: g.sections.filter((s) => s.id !== sid) }));
    setSelection({ kind: "intro" });
  };

  const addSection = () => {
    const sec = emptySection();
    setGuideDirty((g) => ({ sections: [...g.sections, sec] }));
    setSelection({ kind: "question", sid: sec.id, qid: sec.questions[0].id });
  };

  const moveSection = (sid: string, dir: -1 | 1) =>
    setGuideDirty((g) => {
      const i = g.sections.findIndex((s) => s.id === sid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= g.sections.length) return g;
      const next = [...g.sections];
      [next[i], next[j]] = [next[j], next[i]];
      return { sections: next };
    });

  const updateQuestion = (sid: string, qid: string, patch: Partial<GuideQuestion>) =>
    setGuideDirty((g) => ({
      sections: g.sections.map((s) =>
        s.id === sid
          ? { ...s, questions: s.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)) }
          : s,
      ),
    }));

  const addQuestion = (sid: string) => {
    const q = emptyQuestion();
    setGuideDirty((g) => ({
      sections: g.sections.map((s) =>
        s.id === sid ? { ...s, questions: [...s.questions, q] } : s,
      ),
    }));
    setSelection({ kind: "question", sid, qid: q.id });
  };

  const removeQuestion = (sid: string, qid: string) => {
    setGuideDirty((g) => ({
      sections: g.sections.map((s) =>
        s.id === sid ? { ...s, questions: s.questions.filter((q) => q.id !== qid) } : s,
      ),
    }));
    setSelection({ kind: "section", sid });
  };

  const moveQuestion = (sid: string, qid: string, dir: -1 | 1) =>
    setGuideDirty((g) => ({
      sections: g.sections.map((s) => {
        if (s.id !== sid) return s;
        const i = s.questions.findIndex((q) => q.id === qid);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.questions.length) return s;
        const next = [...s.questions];
        [next[i], next[j]] = [next[j], next[i]];
        return { ...s, questions: next };
      }),
    }));

  // ---- AI ----
  const handleGenerate = () => {
    setAiError(null);
    setGenerating(true);
    startTransition(async () => {
      const res = await generateGuide({ title, researchGoal, targetAudience });
      setGenerating(false);
      if ("error" in res) {
        setAiError(res.error);
        return;
      }
      setGuide({ sections: res.sections });
      setDirty(true);
      const first = res.sections[0];
      setSelection(
        first?.questions[0]
          ? { kind: "question", sid: first.id, qid: first.questions[0].id }
          : { kind: "intro" },
      );
    });
  };

  const handleExpand = (section: GuideSection) => {
    setAiError(null);
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        const res = await expandSection({
          studyTitle: title,
          sectionTitle: section.title,
          sectionObjective: section.objective,
          existingQuestions: section.questions.map((q) => q.questionText).filter(Boolean),
        });
        if ("error" in res) {
          setAiError(res.error);
        } else {
          updateSection(section.id, { questions: [...section.questions, ...res.questions] });
        }
        resolve();
      });
    });
  };

  const total = countQuestions(guide);

  // 当前选中的分节 / 问题对象
  const selectedSection = useMemo(() => {
    if (selection.kind === "intro") return null;
    return guide.sections.find((s) => s.id === selection.sid) ?? null;
  }, [selection, guide]);

  const selectedQuestion = useMemo(() => {
    if (selection.kind !== "question" || !selectedSection) return null;
    return selectedSection.questions.find((q) => q.id === selection.qid) ?? null;
  }, [selection, selectedSection]);

  return (
    <main className="flex h-full flex-col bg-mauve-50">
      {/* ===== 顶栏 ===== */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink-100 bg-ink-0 px-4">
        <Link
          href="/home"
          className="grid size-9 shrink-0 place-items-center rounded text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
          aria-label="返回调研列表"
        >
          <ArrowLeft className="size-4" strokeWidth={2} />
        </Link>
        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            placeholder="未命名调研"
            aria-label="调研标题"
            className="w-full max-w-md truncate bg-transparent font-ui text-body-sm font-semibold text-ink-900 outline-none placeholder:text-ink-300"
          />
          <p className="font-ui text-caption text-ink-400">
            {guide.sections.length} 个分节 · 共 {total} 题
            {dirty && <span className="ml-2 text-mauve-400">· 未保存</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex h-9 items-center gap-2 rounded border border-mauve-300 bg-mauve-50 px-3.5 font-ui text-body-sm font-medium text-mauve-700 transition-colors hover:bg-mauve-100 disabled:opacity-60"
        >
          {generating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" strokeWidth={2} />
          )}
          {guide.sections.length ? "AI 重新生成" : "AI 生成提纲"}
        </button>
        <StatusSelect value={status} onChange={handleStatusChange} />
        <button
          type="button"
          onClick={handleSave}
          disabled={saveState === "saving"}
          className="inline-flex h-9 items-center gap-2 rounded bg-ink-900 px-4 font-ui text-body-sm font-medium text-ink-0 transition-colors hover:bg-ink-800 disabled:opacity-60"
        >
          {saveState === "saving" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saveState === "saved" ? (
            <Check className="size-4" strokeWidth={2.5} />
          ) : null}
          {saveState === "saved" ? "已保存" : "保存"}
        </button>
      </header>

      {aiError && (
        <div className="shrink-0 border-b border-negative/30 bg-negative/10 px-4 py-2">
          <p className="font-ui text-body-sm text-negative">{aiError}</p>
        </div>
      )}

      {/* ===== 三栏主体 ===== */}
      <div className="flex min-h-0 flex-1">
        {/* 左栏:结构块列表 */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-ink-100 bg-ink-0">
          <div className="shrink-0 px-3 pb-1 pt-3">
            <p className="font-ui text-caption font-semibold uppercase tracking-wide text-ink-400">
              提纲结构
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {/* 开场块 */}
            <BlockRow
              icon={<DoorOpen className="size-4" strokeWidth={2} />}
              label="开场白"
              hint="访谈开场与研究设定"
              active={selection.kind === "intro"}
              onClick={() => setSelection({ kind: "intro" })}
            />

            {/* 分节与问题 */}
            {guide.sections.map((section, si) => (
              <div key={section.id} className="mt-3">
                <SectionRow
                  index={si}
                  section={section}
                  active={selection.kind === "section" && selection.sid === section.id}
                  canUp={si > 0}
                  canDown={si < guide.sections.length - 1}
                  onClick={() => setSelection({ kind: "section", sid: section.id })}
                  onUp={() => moveSection(section.id, -1)}
                  onDown={() => moveSection(section.id, 1)}
                />
                <div className="mt-0.5 flex flex-col gap-0.5 pl-3">
                  {section.questions.map((q, qi) => (
                    <QuestionRowItem
                      key={q.id}
                      number={qi + 1}
                      question={q}
                      active={selection.kind === "question" && selection.qid === q.id}
                      canUp={qi > 0}
                      canDown={qi < section.questions.length - 1}
                      onClick={() =>
                        setSelection({ kind: "question", sid: section.id, qid: q.id })
                      }
                      onUp={() => moveQuestion(section.id, q.id, -1)}
                      onDown={() => moveQuestion(section.id, q.id, 1)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => addQuestion(section.id)}
                    className="mt-0.5 flex h-8 items-center gap-1.5 rounded px-2 font-ui text-caption font-medium text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                  >
                    <Plus className="size-3.5" strokeWidth={2} />
                    添加问题
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addSection}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded border border-dashed border-ink-200 py-2.5 font-ui text-caption font-medium text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-700"
            >
              <Plus className="size-3.5" strokeWidth={2} />
              添加分节
            </button>
          </div>
        </aside>

        {/* 中栏:画布预览 */}
        <section className="min-w-0 flex-1 overflow-y-auto bg-mauve-100/50">
          <div className="mx-auto flex min-h-full max-w-2xl items-center px-6 py-10">
            <Canvas
              selection={selection}
              guide={guide}
              title={title}
              researchGoal={researchGoal}
              targetAudience={targetAudience}
              introScript={introScript}
              section={selectedSection}
              question={selectedQuestion}
              onGenerate={handleGenerate}
              generating={generating}
            />
          </div>
        </section>

        {/* 右栏:选项面板 */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-ink-100 bg-ink-0">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selection.kind === "intro" && (
              <IntroOptions
                title={title}
                researchGoal={researchGoal}
                targetAudience={targetAudience}
                introScript={introScript}
                onTitle={(v) => {
                  setTitle(v);
                  markDirty();
                }}
                onGoal={(v) => {
                  setResearchGoal(v);
                  markDirty();
                }}
                onAudience={(v) => {
                  setTargetAudience(v);
                  markDirty();
                }}
                onIntro={(v) => {
                  setIntroScript(v);
                  markDirty();
                }}
              />
            )}

            {selection.kind === "section" && selectedSection && (
              <SectionOptions
                section={selectedSection}
                onUpdate={(patch) => updateSection(selectedSection.id, patch)}
                onRemove={() => removeSection(selectedSection.id)}
                onExpand={() => handleExpand(selectedSection)}
              />
            )}

            {selection.kind === "question" && selectedQuestion && selectedSection && (
              <QuestionOptions
                question={selectedQuestion}
                onUpdate={(patch) =>
                  updateQuestion(selectedSection.id, selectedQuestion.id, patch)
                }
                onRemove={() => removeQuestion(selectedSection.id, selectedQuestion.id)}
              />
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

/* ============ 顶栏:状态切换 ============ */
function StatusSelect({
  value,
  onChange,
}: {
  value: StudyStatus;
  onChange: (s: StudyStatus) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as StudyStatus)}
      aria-label="调研状态"
      className="h-9 rounded border border-ink-200 bg-ink-0 px-2.5 font-ui text-body-sm text-ink-700 outline-none transition-colors focus:border-ink-400"
    >
      {(["draft", "live", "closed"] as StudyStatus[]).map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

/* ============ 左栏:块行 ============ */
function BlockRow({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left transition-colors ${
        active ? "bg-mauve-100" : "hover:bg-ink-100"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-mauve-700" : "text-ink-400"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate font-ui text-body-sm ${
            active ? "font-medium text-ink-900" : "text-ink-700"
          }`}
        >
          {label}
        </span>
        {hint && <span className="block truncate font-ui text-caption text-ink-400">{hint}</span>}
      </span>
    </button>
  );
}

function SectionRow({
  index,
  section,
  active,
  canUp,
  canDown,
  onClick,
  onUp,
  onDown,
}: {
  index: number;
  section: GuideSection;
  active: boolean;
  canUp: boolean;
  canDown: boolean;
  onClick: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded px-2.5 py-1.5 transition-colors ${
        active ? "bg-mauve-100" : "hover:bg-ink-100"
      }`}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-mauve-200 font-ui text-[10px] font-semibold text-mauve-700">
          {index + 1}
        </span>
        <span
          className={`min-w-0 flex-1 truncate font-ui text-caption font-semibold uppercase tracking-wide ${
            active ? "text-ink-900" : "text-ink-600"
          }`}
        >
          {section.title || "未命名分节"}
        </span>
      </button>
      <ReorderControls canUp={canUp} canDown={canDown} onUp={onUp} onDown={onDown} />
    </div>
  );
}

function QuestionRowItem({
  number,
  question,
  active,
  canUp,
  canDown,
  onClick,
  onUp,
  onDown,
}: {
  number: number;
  question: GuideQuestion;
  active: boolean;
  canUp: boolean;
  canDown: boolean;
  onClick: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded px-2 py-1.5 transition-colors ${
        active ? "bg-mauve-100" : "hover:bg-ink-100"
      }`}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span
          className={`grid h-5 min-w-[28px] shrink-0 place-items-center rounded px-1 font-ui text-[10px] font-semibold ${
            active ? "bg-ink-900 text-ink-0" : "bg-ink-100 text-ink-500"
          }`}
        >
          {TYPE_BADGE[question.questionType]}
        </span>
        <span
          className={`min-w-0 flex-1 truncate font-ui text-body-sm ${
            active ? "font-medium text-ink-900" : "text-ink-600"
          }`}
        >
          {question.questionText || `问题 ${number}`}
        </span>
      </button>
      <ReorderControls canUp={canUp} canDown={canDown} onUp={onUp} onDown={onDown} />
    </div>
  );
}

function ReorderControls({
  canUp,
  canDown,
  onUp,
  onDown,
}: {
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        onClick={onUp}
        disabled={!canUp}
        aria-label="上移"
        className="grid size-5 place-items-center rounded text-ink-300 transition-colors hover:bg-ink-200 hover:text-ink-700 disabled:opacity-30"
      >
        <ChevronUp className="size-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={!canDown}
        aria-label="下移"
        className="grid size-5 place-items-center rounded text-ink-300 transition-colors hover:bg-ink-200 hover:text-ink-700 disabled:opacity-30"
      >
        <ChevronDown className="size-3.5" strokeWidth={2} />
      </button>
    </span>
  );
}

/* ============ 中栏:画布预览 ============ */
function Canvas({
  selection,
  guide,
  title,
  researchGoal,
  targetAudience,
  introScript,
  section,
  question,
  onGenerate,
  generating,
}: {
  selection: Selection;
  guide: Guide;
  title: string;
  researchGoal: string;
  targetAudience: string;
  introScript: string;
  section: GuideSection | null;
  question: GuideQuestion | null;
  onGenerate: () => void;
  generating: boolean;
}) {
  // 空提纲引导
  if (guide.sections.length === 0 && selection.kind === "intro") {
    return (
      <div className="w-full rounded-md border border-ink-100 bg-ink-0 p-10 text-center shadow-sm">
        <DoorOpen className="mx-auto size-7 text-mauve-400" strokeWidth={1.5} />
        <h2 className="mt-4 font-display text-display-md text-ink-900 text-balance">
          {title || "未命名调研"}
        </h2>
        <p className="mx-auto mt-2 max-w-md font-ui text-body-sm leading-6 text-ink-500 text-pretty">
          {introScript || "还没有访谈提纲。先在右侧填写研究设定,或让 AI 直接生成一份完整提纲。"}
        </p>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="mx-auto mt-6 inline-flex h-10 items-center gap-2 rounded bg-ink-900 px-5 font-ui text-body-sm font-medium text-ink-0 transition-colors hover:bg-ink-800 disabled:opacity-60"
        >
          {generating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" strokeWidth={2} />
          )}
          用 AI 生成提纲
        </button>
      </div>
    );
  }

  // 开场预览
  if (selection.kind === "intro") {
    return (
      <div className="w-full rounded-md border border-ink-100 bg-ink-0 p-10 shadow-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-mauve-100 px-2.5 py-1 font-ui text-caption font-medium text-mauve-700">
          <DoorOpen className="size-3.5" strokeWidth={2} />
          开场
        </span>
        <h2 className="mt-4 font-display text-display-lg text-ink-900 text-balance">
          {title || "未命名调研"}
        </h2>
        <p className="mt-3 font-reading text-body leading-7 text-ink-700 text-pretty">
          {introScript || "（开场白为空,在右侧填写主持人对受访者说的第一句话。）"}
        </p>
        {(researchGoal || targetAudience) && (
          <div className="mt-6 flex flex-col gap-2 border-t border-ink-100 pt-5">
            {researchGoal && (
              <p className="font-ui text-caption text-ink-500">
                <span className="font-medium text-ink-700">研究目标:</span> {researchGoal}
              </p>
            )}
            {targetAudience && (
              <p className="font-ui text-caption text-ink-500">
                <span className="font-medium text-ink-700">目标受众:</span> {targetAudience}
              </p>
            )}
          </div>
        )}
        <div className="mt-8">
          <span className="inline-flex h-10 items-center rounded bg-ink-900 px-5 font-ui text-body-sm font-medium text-ink-0">
            开始访谈
          </span>
        </div>
      </div>
    );
  }

  // 分节预览
  if (selection.kind === "section" && section) {
    return (
      <div className="w-full rounded-md border border-ink-100 bg-ink-0 p-10 text-center shadow-sm">
        <p className="font-ui text-caption font-semibold uppercase tracking-wide text-mauve-400">
          分节
        </p>
        <h2 className="mt-3 font-display text-display-lg text-ink-900 text-balance">
          {section.title || "未命名分节"}
        </h2>
        {section.objective && (
          <p className="mx-auto mt-3 max-w-md font-ui text-body-sm leading-6 text-ink-500 text-pretty">
            {section.objective}
          </p>
        )}
        <p className="mt-6 font-ui text-caption text-ink-400">
          本节包含 {section.questions.length} 个问题
        </p>
      </div>
    );
  }

  // 问题预览
  if (selection.kind === "question" && question && section) {
    const qIndex = section.questions.findIndex((q) => q.id === question.id) + 1;
    return (
      <div className="w-full rounded-md border border-ink-100 bg-ink-0 p-10 shadow-sm">
        <p className="font-ui text-caption font-medium text-mauve-400">
          {section.title || "分节"} · 问题 {qIndex}
        </p>
        <h2 className="mt-3 font-display text-display-md text-ink-900 text-balance">
          {question.questionText || "（问题内容为空,在右侧输入要问受访者的问题）"}
        </h2>

        <div className="mt-7">
          <AnswerPreview question={question} />
        </div>

        {question.probeInstruction && (
          <div className="mt-7 flex items-start gap-2 rounded border border-dashed border-mauve-200 bg-mauve-50 px-3 py-2">
            <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-mauve-400" strokeWidth={2} />
            <p className="font-ui text-caption leading-5 text-ink-600">
              <span className="font-medium text-mauve-700">
                {PROBE_LEVEL_LABELS[question.probeLevel]}
              </span>
              :{question.probeInstruction}
            </p>
          </div>
        )}
      </div>
    );
  }

  return null;
}

/** 不同题型的作答区预览(模拟受访者所见)。 */
function AnswerPreview({ question }: { question: GuideQuestion }) {
  const letters = "ABCDEFGHIJ";

  if (TYPES_NEEDING_OPTIONS.includes(question.questionType)) {
    const opts = question.options.length ? question.options : ["选项 1", "选项 2"];
    return (
      <div className="flex flex-col gap-2">
        {opts.map((opt, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded border border-ink-200 px-3 py-2.5 font-ui text-body-sm text-ink-700"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded border border-ink-200 font-ui text-caption font-semibold text-ink-500">
              {letters[i] ?? i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate">{opt || `选项 ${i + 1}`}</span>
          </div>
        ))}
        {question.questionType === "multi_choice" && (
          <p className="mt-0.5 font-ui text-caption text-ink-400">可多选</p>
        )}
        {question.questionType === "ranking" && (
          <p className="mt-0.5 font-ui text-caption text-ink-400">拖动排序</p>
        )}
      </div>
    );
  }

  if (question.questionType === "rating") {
    return (
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} className="size-7 text-mauve-300" strokeWidth={1.5} />
        ))}
      </div>
    );
  }

  if (question.questionType === "nps") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, n) => (
          <span
            key={n}
            className="grid size-9 place-items-center rounded border border-ink-200 font-data text-body-sm text-ink-600"
          >
            {n}
          </span>
        ))}
      </div>
    );
  }

  // open_ended
  return (
    <div className="flex items-center gap-2 rounded border border-ink-200 bg-mauve-50/50 px-3 py-3">
      <AlignLeft className="size-4 shrink-0 text-ink-300" strokeWidth={2} />
      <span className="font-ui text-body-sm text-ink-300">受访者用语音或文字自由回答…</span>
    </div>
  );
}

/* ============ 右栏:开场设置 ============ */
function IntroOptions({
  title,
  researchGoal,
  targetAudience,
  introScript,
  onTitle,
  onGoal,
  onAudience,
  onIntro,
}: {
  title: string;
  researchGoal: string;
  targetAudience: string;
  introScript: string;
  onTitle: (v: string) => void;
  onGoal: (v: string) => void;
  onAudience: (v: string) => void;
  onIntro: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PanelTitle>研究设定</PanelTitle>
      <Field label="调研标题">
        <TextInput value={title} onChange={onTitle} placeholder="例如:差旅住宿预订习惯调研" />
      </Field>
      <Field label="研究目标">
        <TextArea value={researchGoal} onChange={onGoal} placeholder="你希望通过这次访谈搞清楚什么?" />
      </Field>
      <Field label="目标受众">
        <TextArea value={targetAudience} onChange={onAudience} placeholder="你想访谈什么样的人?" />
      </Field>
      <Field label="开场白">
        <TextArea value={introScript} onChange={onIntro} placeholder="主持人开场时对受访者说的话" rows={4} />
      </Field>
    </div>
  );
}

/* ============ 右栏:分节设置 ============ */
function SectionOptions({
  section,
  onUpdate,
  onRemove,
  onExpand,
}: {
  section: GuideSection;
  onUpdate: (patch: Partial<GuideSection>) => void;
  onRemove: () => void;
  onExpand: () => Promise<void>;
}) {
  const [expanding, setExpanding] = useState(false);
  const handleExpand = () => {
    setExpanding(true);
    onExpand().finally(() => setExpanding(false));
  };

  return (
    <div className="flex flex-col gap-4">
      <PanelTitle>分节设置</PanelTitle>
      <Field label="分节标题">
        <TextInput
          value={section.title}
          onChange={(v) => onUpdate({ title: v })}
          placeholder="例如:整体预订习惯"
        />
      </Field>
      <Field label="分节目标">
        <TextArea
          value={section.objective}
          onChange={(v) => onUpdate({ objective: v })}
          placeholder="这一节想了解什么?"
        />
      </Field>

      <button
        type="button"
        onClick={handleExpand}
        disabled={expanding}
        className="inline-flex h-9 items-center justify-center gap-2 rounded border border-mauve-300 bg-mauve-50 px-3.5 font-ui text-body-sm font-medium text-mauve-700 transition-colors hover:bg-mauve-100 disabled:opacity-60"
      >
        {expanding ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" strokeWidth={2} />
        )}
        AI 补充问题
      </button>

      <div className="border-t border-ink-100 pt-4">
        <DangerButton onClick={onRemove} label="删除分节" />
      </div>
    </div>
  );
}

/* ============ 右栏:问题设置 ============ */
function QuestionOptions({
  question,
  onUpdate,
  onRemove,
}: {
  question: GuideQuestion;
  onUpdate: (patch: Partial<GuideQuestion>) => void;
  onRemove: () => void;
}) {
  const needsOptions = TYPES_NEEDING_OPTIONS.includes(question.questionType);

  const updateOption = (i: number, val: string) =>
    onUpdate({ options: question.options.map((o, idx) => (idx === i ? val : o)) });
  const addOption = () => onUpdate({ options: [...question.options, ""] });
  const removeOption = (i: number) =>
    onUpdate({ options: question.options.filter((_, idx) => idx !== i) });

  return (
    <div className="flex flex-col gap-4">
      <PanelTitle>问题设置</PanelTitle>

      <Field label="问题内容">
        <TextArea
          value={question.questionText}
          onChange={(v) => onUpdate({ questionText: v })}
          placeholder="想问受访者什么?"
          rows={3}
        />
      </Field>

      {/* 题型:网格按钮 */}
      <Field label="题型">
        <div className="grid grid-cols-2 gap-1.5">
          {QUESTION_TYPES.map((t) => {
            const active = question.questionType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  const willNeed = TYPES_NEEDING_OPTIONS.includes(t);
                  onUpdate({
                    questionType: t,
                    options:
                      willNeed && question.options.length === 0 ? ["", ""] : question.options,
                  });
                }}
                aria-pressed={active}
                className={`h-9 rounded border px-2 font-ui text-caption font-medium transition-colors ${
                  active
                    ? "border-ink-900 bg-ink-900 text-ink-0"
                    : "border-ink-200 bg-ink-0 text-ink-600 hover:bg-ink-100"
                }`}
              >
                {QUESTION_TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </Field>

      {/* 选项 */}
      {needsOptions && (
        <Field label="候选项">
          <div className="flex flex-col gap-1.5">
            {question.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="font-ui text-caption text-ink-300">{i + 1}.</span>
                <input
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  placeholder={`选项 ${i + 1}`}
                  className="h-8 flex-1 rounded border border-ink-200 bg-ink-0 px-2.5 font-ui text-caption text-ink-800 outline-none transition-colors placeholder:text-ink-300 focus:border-ink-400"
                />
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  aria-label="删除选项"
                  className="grid size-7 place-items-center rounded text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-600"
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addOption}
              className="mt-0.5 inline-flex w-fit items-center gap-1 font-ui text-caption font-medium text-mauve-600 transition-colors hover:text-mauve-700"
            >
              <Plus className="size-3.5" strokeWidth={2} />
              添加选项
            </button>
          </div>
        </Field>
      )}

      {/* 追问深度 */}
      <Field label="追问深度">
        <div className="grid grid-cols-2 gap-1.5">
          {(["standard", "deep"] as ProbeLevel[]).map((p) => {
            const active = question.probeLevel === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onUpdate({ probeLevel: p })}
                aria-pressed={active}
                className={`h-9 rounded border px-2 font-ui text-caption font-medium transition-colors ${
                  active
                    ? "border-ink-900 bg-ink-900 text-ink-0"
                    : "border-ink-200 bg-ink-0 text-ink-600 hover:bg-ink-100"
                }`}
              >
                {PROBE_LEVEL_LABELS[p]}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="追问指令(可选)">
        <TextArea
          value={question.probeInstruction}
          onChange={(v) => onUpdate({ probeInstruction: v })}
          placeholder="提示主持人往哪个方向深挖"
        />
      </Field>

      <div className="border-t border-ink-100 pt-4">
        <DangerButton onClick={onRemove} label="删除问题" />
      </div>
    </div>
  );
}

/* ============ 复用小组件 ============ */
function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-ui text-caption font-semibold uppercase tracking-wide text-ink-400">
      {children}
    </p>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block font-ui text-caption font-medium text-ink-700">{label}</label>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border border-ink-200 bg-ink-0 px-3 py-2 font-ui text-body-sm text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-ink-400"
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-none rounded border border-ink-200 bg-ink-0 px-3 py-2 font-ui text-body-sm leading-6 text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-ink-400"
    />
  );
}

function DangerButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded border border-negative/30 px-3 font-ui text-body-sm font-medium text-negative transition-colors hover:bg-negative/10"
    >
      <Trash2 className="size-4" strokeWidth={2} />
      {label}
    </button>
  );
}
