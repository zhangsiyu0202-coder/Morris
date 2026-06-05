"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Check,
  GripVertical,
  X,
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

export function GuideEditor({ study }: { study: StudyDetail }) {
  const [title, setTitle] = useState(study.title);
  const [researchGoal, setResearchGoal] = useState(study.researchGoal);
  const [targetAudience, setTargetAudience] = useState(study.targetAudience);
  const [introScript, setIntroScript] = useState(study.introScript);
  const [status, setStatus] = useState<StudyStatus>(study.status);
  const [guide, setGuide] = useState<Guide>(study.guide);

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const flashSaved = () => {
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 1800);
  };

  const handleSave = useCallback(() => {
    setSaveState("saving");
    startTransition(async () => {
      await updateStudyMeta(study.id, { title, researchGoal, targetAudience, introScript });
      await saveGuide(study.id, guide);
      flashSaved();
    });
  }, [study.id, title, researchGoal, targetAudience, introScript, guide]);

  const handleStatusChange = (next: StudyStatus) => {
    setStatus(next);
    startTransition(async () => {
      await updateStudyStatus(study.id, next);
    });
  };

  // ---- guide 变更帮助函数 ----
  const updateSection = (sid: string, patch: Partial<GuideSection>) =>
    setGuide((g) => ({
      sections: g.sections.map((s) => (s.id === sid ? { ...s, ...patch } : s)),
    }));

  const removeSection = (sid: string) =>
    setGuide((g) => ({ sections: g.sections.filter((s) => s.id !== sid) }));

  const addSection = () =>
    setGuide((g) => ({ sections: [...g.sections, emptySection()] }));

  const updateQuestion = (sid: string, qid: string, patch: Partial<GuideQuestion>) =>
    setGuide((g) => ({
      sections: g.sections.map((s) =>
        s.id === sid
          ? { ...s, questions: s.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)) }
          : s,
      ),
    }));

  const addQuestion = (sid: string) =>
    setGuide((g) => ({
      sections: g.sections.map((s) =>
        s.id === sid ? { ...s, questions: [...s.questions, emptyQuestion()] } : s,
      ),
    }));

  const removeQuestion = (sid: string, qid: string) =>
    setGuide((g) => ({
      sections: g.sections.map((s) =>
        s.id === sid ? { ...s, questions: s.questions.filter((q) => q.id !== qid) } : s,
      ),
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
    });
  };

  const handleExpand = (section: GuideSection) => {
    setAiError(null);
    startTransition(async () => {
      const res = await expandSection({
        studyTitle: title,
        sectionTitle: section.title,
        sectionObjective: section.objective,
        existingQuestions: section.questions.map((q) => q.questionText).filter(Boolean),
      });
      if ("error" in res) {
        setAiError(res.error);
        return;
      }
      updateSection(section.id, { questions: [...section.questions, ...res.questions] });
    });
  };

  const total = countQuestions(guide);

  return (
    <main className="min-h-full bg-mauve-50 pb-24">
      {/* 顶部栏 */}
      <div className="sticky top-0 z-20 border-b border-ink-100 bg-mauve-50/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="grid size-9 shrink-0 place-items-center rounded text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
            aria-label="返回调研列表"
          >
            <ArrowLeft className="size-4" strokeWidth={2} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate font-ui text-caption text-ink-400">编辑访谈提纲</p>
            <p className="truncate font-ui text-body-sm font-semibold text-ink-900">
              {title || "未命名调研"}
            </p>
          </div>
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
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {/* 元信息 */}
        <section className="rounded border border-ink-100 bg-ink-0 p-5 shadow-sm">
          <Field label="调研标题">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如:差旅住宿预订习惯调研"
              className="w-full rounded border border-ink-200 bg-ink-0 px-3 py-2 font-ui text-body-sm text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-ink-400"
            />
          </Field>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="研究目标">
              <textarea
                value={researchGoal}
                onChange={(e) => setResearchGoal(e.target.value)}
                rows={2}
                placeholder="你希望通过这次访谈搞清楚什么?"
                className="w-full resize-none rounded border border-ink-200 bg-ink-0 px-3 py-2 font-ui text-body-sm leading-6 text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-ink-400"
              />
            </Field>
            <Field label="目标受众">
              <textarea
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                rows={2}
                placeholder="你想访谈什么样的人?"
                className="w-full resize-none rounded border border-ink-200 bg-ink-0 px-3 py-2 font-ui text-body-sm leading-6 text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-ink-400"
              />
            </Field>
          </div>
          <Field label="开场白" className="mt-4">
            <textarea
              value={introScript}
              onChange={(e) => setIntroScript(e.target.value)}
              rows={2}
              placeholder="主持人开场时对受访者说的话"
              className="w-full resize-none rounded border border-ink-200 bg-ink-0 px-3 py-2 font-ui text-body-sm leading-6 text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-ink-400"
            />
          </Field>
        </section>

        {/* 提纲标题行 + AI 生成 */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-display-sm text-ink-900">访谈提纲</h2>
            <p className="mt-0.5 font-ui text-caption text-ink-500">
              {guide.sections.length} 个分节 · 共 {total} 题
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
            {guide.sections.length ? "用 AI 重新生成" : "用 AI 生成提纲"}
          </button>
        </div>

        {aiError && (
          <p className="mt-3 rounded border border-negative/30 bg-negative/10 px-3 py-2 font-ui text-body-sm text-negative">
            {aiError}
          </p>
        )}

        {/* 分节 */}
        <div className="mt-4 flex flex-col gap-4">
          {guide.sections.map((section, si) => (
            <SectionCard
              key={section.id}
              index={si}
              section={section}
              onUpdate={(patch) => updateSection(section.id, patch)}
              onRemove={() => removeSection(section.id)}
              onUpdateQuestion={(qid, patch) => updateQuestion(section.id, qid, patch)}
              onAddQuestion={() => addQuestion(section.id)}
              onRemoveQuestion={(qid) => removeQuestion(section.id, qid)}
              onExpand={() => handleExpand(section)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={addSection}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded border border-dashed border-ink-200 bg-ink-0 py-3 font-ui text-body-sm font-medium text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-700"
        >
          <Plus className="size-4" strokeWidth={2} />
          添加分节
        </button>
      </div>
    </main>
  );
}

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

function SectionCard({
  index,
  section,
  onUpdate,
  onRemove,
  onUpdateQuestion,
  onAddQuestion,
  onRemoveQuestion,
  onExpand,
}: {
  index: number;
  section: GuideSection;
  onUpdate: (patch: Partial<GuideSection>) => void;
  onRemove: () => void;
  onUpdateQuestion: (qid: string, patch: Partial<GuideQuestion>) => void;
  onAddQuestion: () => void;
  onRemoveQuestion: (qid: string) => void;
  onExpand: () => void;
}) {
  const [expanding, setExpanding] = useState(false);

  const handleExpand = () => {
    setExpanding(true);
    Promise.resolve(onExpand()).finally(() => setTimeout(() => setExpanding(false), 400));
  };

  return (
    <section className="rounded border border-ink-100 bg-ink-0 shadow-sm">
      <div className="flex items-start gap-2 border-b border-ink-100 p-4">
        <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-mauve-100 font-ui text-caption font-semibold text-mauve-700">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <input
            value={section.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            placeholder="分节标题(例如:整体预订习惯)"
            className="w-full bg-transparent font-ui text-body font-semibold text-ink-900 outline-none placeholder:font-normal placeholder:text-ink-300"
          />
          <input
            value={section.objective}
            onChange={(e) => onUpdate({ objective: e.target.value })}
            placeholder="这一节想了解什么?"
            className="mt-1 w-full bg-transparent font-ui text-body-sm text-ink-500 outline-none placeholder:text-ink-300"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="删除分节"
          className="grid size-8 shrink-0 place-items-center rounded text-ink-300 transition-colors hover:bg-negative/10 hover:text-negative"
        >
          <Trash2 className="size-4" strokeWidth={2} />
        </button>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {section.questions.map((q, qi) => (
          <QuestionRow
            key={q.id}
            index={qi}
            question={q}
            onUpdate={(patch) => onUpdateQuestion(q.id, patch)}
            onRemove={() => onRemoveQuestion(q.id)}
          />
        ))}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddQuestion}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-ink-200 px-3 font-ui text-caption font-medium text-ink-600 transition-colors hover:bg-ink-100"
          >
            <Plus className="size-3.5" strokeWidth={2} />
            添加问题
          </button>
          <button
            type="button"
            onClick={handleExpand}
            disabled={expanding}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-mauve-200 bg-mauve-50 px-3 font-ui text-caption font-medium text-mauve-700 transition-colors hover:bg-mauve-100 disabled:opacity-60"
          >
            {expanding ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" strokeWidth={2} />
            )}
            AI 补充问题
          </button>
        </div>
      </div>
    </section>
  );
}

function QuestionRow({
  index,
  question,
  onUpdate,
  onRemove,
}: {
  index: number;
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
    <div className="rounded border border-ink-100 bg-mauve-50/40 p-3">
      <div className="flex items-start gap-2">
        <GripVertical className="mt-2 size-4 shrink-0 text-ink-200" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <textarea
            value={question.questionText}
            onChange={(e) => onUpdate({ questionText: e.target.value })}
            rows={2}
            placeholder={`问题 ${index + 1}:想问受访者什么?`}
            className="w-full resize-none rounded border border-ink-200 bg-ink-0 px-3 py-2 font-ui text-body-sm leading-6 text-ink-900 outline-none transition-colors placeholder:text-ink-300 focus:border-ink-400"
          />

          {/* 控制行:题型 / 追问深度 */}
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              value={question.questionType}
              onChange={(e) => {
                const next = e.target.value as QuestionType;
                const willNeed = TYPES_NEEDING_OPTIONS.includes(next);
                onUpdate({
                  questionType: next,
                  options: willNeed && question.options.length === 0 ? ["", ""] : question.options,
                });
              }}
              aria-label="题型"
              className="h-8 rounded border border-ink-200 bg-ink-0 px-2 font-ui text-caption text-ink-700 outline-none focus:border-ink-400"
            >
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              value={question.probeLevel}
              onChange={(e) => onUpdate({ probeLevel: e.target.value as ProbeLevel })}
              aria-label="追问深度"
              className="h-8 rounded border border-ink-200 bg-ink-0 px-2 font-ui text-caption text-ink-700 outline-none focus:border-ink-400"
            >
              {(["standard", "deep"] as ProbeLevel[]).map((p) => (
                <option key={p} value={p}>
                  {PROBE_LEVEL_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          {/* 选项编辑 */}
          {needsOptions && (
            <div className="mt-2 flex flex-col gap-1.5">
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
          )}

          {/* 追问指令 */}
          <input
            value={question.probeInstruction}
            onChange={(e) => onUpdate({ probeInstruction: e.target.value })}
            placeholder="追问方向(可选):提示主持人往哪深挖"
            className="mt-2 w-full rounded border border-dashed border-ink-200 bg-transparent px-3 py-1.5 font-ui text-caption text-ink-600 outline-none transition-colors placeholder:text-ink-300 focus:border-ink-400"
          />
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label="删除问题"
          className="grid size-7 shrink-0 place-items-center rounded text-ink-300 transition-colors hover:bg-negative/10 hover:text-negative"
        >
          <Trash2 className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block font-ui text-caption font-medium text-ink-700">{label}</label>
      {children}
    </div>
  );
}
