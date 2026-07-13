"use client";

import { useState, useTransition, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Check,
  GripVertical,
  DoorOpen,
  Star,
  AlignLeft,
  X,
  CornerDownRight,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  PROBE_LEVEL_LABELS,
  TYPES_NEEDING_OPTIONS,
  emptySection,
  emptyQuestion,
  countQuestions,
  guideFromDraftSections,
  draftSectionsFromGuide,
  type Guide,
  type GuideSection,
  type GuideQuestion,
  type GuideBranchRule,
  type QuestionType,
  type ProbeLevel,
} from "@/lib/guide";
import type { SurveyDraft } from "@merism/contracts";
import { saveSurveyDraft } from "@/lib/actions/survey";
import { generateGuide, expandSection } from "@/lib/actions/guide-ai";
import { createLogger } from "@merism/observability";

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

export function GuideEditor({ surveyId, draft }: { surveyId: string; draft: SurveyDraft }) {
  const [title, setTitle] = useState(draft.title);
  const [researchGoal, setResearchGoal] = useState(draft.researchGoal);
  const [targetAudience, setTargetAudience] = useState(draft.targetAudience);
  const [introScript, setIntroScript] = useState(draft.introScript);
  const [moderatorInstruction, setModeratorInstruction] = useState(draft.moderatorInstruction);
  // ADR-0015 primary field. Wave 1: no UI, just pass-through so a save
  // does not overwrite an existing Survey.instruction. Wave 2 will add a
  // markdown editor that binds to this state.
  const [instruction, _setInstruction] = useState(draft.instruction);
  void _setInstruction;
  const [guide, setGuide] = useState<Guide>(() => guideFromDraftSections(draft.sections));

  const [selection, setSelection] = useState<Selection>({ kind: "intro" });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const markDirty = () => setDirty(true);

  // ---- 保存 ----
  const handleSave = useCallback(() => {
    setSaveState("saving");
    setSaveError(null);
    startTransition(async () => {
      const nextDraft: SurveyDraft = {
        title: title.trim() || "未命名调研",
        researchGoal,
        targetAudience,
        introScript,
        moderatorInstruction,
        // ADR-0015 primary field. Wave 1 keeps the UI unchanged so we
        // just pass through the current Survey.instruction value read
        // earlier (an empty string for legacy rows); Wave 2 will add a
        // dedicated markdown editor here.
        instruction,
        sections: draftSectionsFromGuide(guide),
      };
      try {
        await saveSurveyDraft(surveyId, nextDraft);
        setDirty(false);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1800);
      } catch (err) {
        // Recover UI from the stuck "saving" state and surface the message.
        // Errors reaching here include: zod SurveyDraftSchema.parse failures
        // (e.g. new branchRules superRefine rejecting a rule with a jump
        // target that no longer exists), Appwrite server errors, network
        // failures. Without this catch the button spins forever and the
        // researcher has no idea what went wrong.
        createLogger("component.studies.guide-editor").warn(
          "saveSurveyDraft failed",
          { error: err instanceof Error ? err.message : String(err) },
        );
        setSaveState("idle");
        setSaveError(
          err instanceof Error
            ? err.message
            : "保存失败,请稍后重试。",
        );
      }
    });
  }, [surveyId, title, researchGoal, targetAudience, introScript, moderatorInstruction, instruction, guide]);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 拖拽排序:分节之间可重排;问题仅在所属分节内重排(不跨节移动)。
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const aSecIdx = guide.sections.findIndex((s) => s.id === activeId);
    if (aSecIdx >= 0) {
      const oSecIdx = guide.sections.findIndex((s) => s.id === overId);
      if (oSecIdx >= 0) {
        setGuideDirty((g) => ({ sections: arrayMove(g.sections, aSecIdx, oSecIdx) }));
      }
      return;
    }

    const aSec = guide.sections.find((s) => s.questions.some((q) => q.id === activeId));
    const oSec = guide.sections.find((s) => s.questions.some((q) => q.id === overId));
    if (aSec && oSec && aSec.id === oSec.id) {
      const from = aSec.questions.findIndex((q) => q.id === activeId);
      const to = aSec.questions.findIndex((q) => q.id === overId);
      setGuideDirty((g) => ({
        sections: g.sections.map((s) =>
          s.id === aSec.id ? { ...s, questions: arrayMove(s.questions, from, to) } : s,
        ),
      }));
    }
  };

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
    <div className="flex h-full flex-col bg-mauve-50">
      {/* ===== 操作工具条 ===== */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-ink-200 bg-ink-0 px-4">
        <p className="font-ui text-caption text-ink-400">
          {guide.sections.length} 个分节 · 共 {total} 题
          {dirty && <span className="ml-2 text-mauve-400">· 未保存</span>}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex h-9 items-center gap-2 rounded border border-ink-900 bg-ink-0 px-3.5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-50 disabled:opacity-60"
          >
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" strokeWidth={2} />
            )}
            {guide.sections.length ? "AI 重新生成" : "AI 生成提纲"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === "saving"}
            className="inline-flex h-9 items-center gap-2 rounded bg-mauve-200 px-4 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-60"
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

      {aiError && (
        <div className="shrink-0 border-b border-ink-200 bg-mauve-100 px-4 py-2">
          <p className="font-ui text-body-sm italic text-ink-900">{aiError}</p>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-ink-200 bg-mauve-100 px-4 py-2"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-ink-900"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="font-ui text-body-sm text-ink-900">
            <span className="font-medium">保存失败:</span> {saveError}
          </p>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            aria-label="关闭错误提示"
            className="ml-auto grid size-6 place-items-center rounded text-ink-600 transition-colors hover:bg-mauve-200 hover:text-ink-900"
          >
            <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
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

            {/* 分节与问题(可拖拽排序) */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={guide.sections.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {guide.sections.map((section, si) => (
                  <SortableSection
                    key={section.id}
                    section={section}
                    index={si}
                    active={selection.kind === "section" && selection.sid === section.id}
                    onClick={() => setSelection({ kind: "section", sid: section.id })}
                  >
                    <div className="mt-0.5 flex flex-col gap-0.5 pl-3">
                      <SortableContext
                        items={section.questions.map((q) => q.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {section.questions.map((q, qi) => (
                          <SortableQuestion
                            key={q.id}
                            number={qi + 1}
                            question={q}
                            active={selection.kind === "question" && selection.qid === q.id}
                            onClick={() =>
                              setSelection({ kind: "question", sid: section.id, qid: q.id })
                            }
                          />
                        ))}
                      </SortableContext>
                      <button
                        type="button"
                        onClick={() => addQuestion(section.id)}
                        className="mt-0.5 flex h-8 items-center gap-1.5 rounded px-2 font-ui text-caption font-medium text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600"
                      >
                        <Plus className="size-3.5" strokeWidth={2} />
                        添加问题
                      </button>
                    </div>
                  </SortableSection>
                ))}
              </SortableContext>
            </DndContext>

            <button
              type="button"
              onClick={addSection}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded border border-dashed border-ink-200 py-2.5 font-ui text-caption font-medium text-ink-400 transition-colors hover:border-ink-200 hover:text-ink-600"
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
                moderatorInstruction={moderatorInstruction}
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
                onModerator={(v) => {
                  setModeratorInstruction(v);
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
                guide={guide}
                onUpdate={(patch) =>
                  updateQuestion(selectedSection.id, selectedQuestion.id, patch)
                }
                onRemove={() => removeQuestion(selectedSection.id, selectedQuestion.id)}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
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
      <span className={`shrink-0 ${active ? "text-ink-900" : "text-ink-400"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate font-ui text-body-sm ${
            active ? "font-medium text-ink-900" : "text-ink-600"
          }`}
        >
          {label}
        </span>
        {hint && <span className="block truncate font-ui text-caption text-ink-400">{hint}</span>}
      </span>
    </button>
  );
}

function SortableSection({
  index,
  section,
  active,
  onClick,
  children,
}: {
  index: number;
  section: GuideSection;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={`mt-3 ${isDragging ? "opacity-60" : ""}`}>
      <div
        className={`group flex items-center gap-1 rounded px-1.5 py-1.5 transition-colors ${
          active ? "bg-mauve-100" : "hover:bg-ink-100"
        }`}
      >
        <DragHandle attributes={attributes} listeners={listeners} label="拖动排序分节" />
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-mauve-200 font-ui text-[10px] font-semibold text-ink-900">
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
      </div>
      {children}
    </div>
  );
}

function SortableQuestion({
  number,
  question,
  active,
  onClick,
}: {
  number: number;
  question: GuideQuestion;
  active: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-1 rounded px-1.5 py-1.5 transition-colors ${
        isDragging ? "opacity-60" : ""
      } ${active ? "bg-mauve-100" : "hover:bg-ink-100"}`}
    >
      <DragHandle attributes={attributes} listeners={listeners} label="拖动排序问题" />
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className={`grid h-5 min-w-[28px] shrink-0 place-items-center rounded px-1 font-ui text-[10px] font-semibold ${
            active ? "bg-ink-900 text-ink-0" : "bg-ink-100 text-ink-400"
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
    </div>
  );
}

/** 拖拽手柄:hover 时显现,承载 dnd-kit 的 listeners(键盘亦可操作)。 */
function DragHandle({
  attributes,
  listeners,
  label,
}: {
  attributes: React.HTMLAttributes<HTMLButtonElement>;
  listeners: Record<string, unknown> | undefined;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid size-5 shrink-0 cursor-grab touch-none place-items-center rounded text-ink-400 opacity-0 transition-opacity hover:bg-ink-200 hover:text-ink-600 focus-visible:opacity-100 group-hover:opacity-100"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" strokeWidth={2} />
    </button>
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
        <p className="mx-auto mt-2 max-w-md font-ui text-body-sm leading-6 text-ink-400 text-pretty">
          {introScript || "还没有访谈提纲。先在右侧填写研究设定,或让 AI 直接生成一份完整提纲。"}
        </p>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="mx-auto mt-6 inline-flex h-10 items-center gap-2 rounded bg-mauve-200 px-5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-100 disabled:opacity-60"
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
        <span className="inline-flex items-center gap-1.5 rounded-full bg-mauve-100 px-2.5 py-1 font-ui text-caption font-medium text-ink-900">
          <DoorOpen className="size-3.5" strokeWidth={2} />
          开场
        </span>
        <h2 className="mt-4 font-display text-display-lg text-ink-900 text-balance">
          {title || "未命名调研"}
        </h2>
        <p className="mt-3 font-reading text-body leading-7 text-ink-600 text-pretty">
          {introScript || "（开场白为空,在右侧填写主持人对受访者说的第一句话。）"}
        </p>
        {(researchGoal || targetAudience) && (
          <div className="mt-6 flex flex-col gap-2 border-t border-ink-100 pt-5">
            {researchGoal && (
              <p className="font-ui text-body-sm text-ink-400">
                <span className="font-medium text-ink-600">研究目标:</span> {researchGoal}
              </p>
            )}
            {targetAudience && (
              <p className="font-ui text-body-sm text-ink-400">
                <span className="font-medium text-ink-600">目标受众:</span> {targetAudience}
              </p>
            )}
          </div>
        )}
        <div className="mt-8">
          <span className="inline-flex h-10 items-center rounded bg-mauve-200 px-5 font-ui text-body-sm font-medium text-ink-900">
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
          <p className="mx-auto mt-3 max-w-md font-ui text-body-sm leading-6 text-ink-400 text-pretty">
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
            <p className="font-ui text-body-sm leading-6 text-ink-600">
              <span className="font-medium text-ink-900">
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
            className="flex items-center gap-3 rounded border border-ink-200 px-3 py-2.5 font-ui text-body-sm text-ink-600"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded border border-ink-200 font-ui text-caption font-semibold text-ink-400">
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
          <Star key={n} className="size-7 text-mauve-400" strokeWidth={1.5} />
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
      <AlignLeft className="size-4 shrink-0 text-ink-400" strokeWidth={2} />
      <span className="font-ui text-body-sm text-ink-400">受访者用语音或文字自由回答…</span>
    </div>
  );
}

/* ============ 右栏:开场设置 ============ */
function IntroOptions({
  title,
  researchGoal,
  targetAudience,
  introScript,
  moderatorInstruction,
  onTitle,
  onGoal,
  onAudience,
  onIntro,
  onModerator,
}: {
  title: string;
  researchGoal: string;
  targetAudience: string;
  introScript: string;
  moderatorInstruction: string;
  onTitle: (v: string) => void;
  onGoal: (v: string) => void;
  onAudience: (v: string) => void;
  onIntro: (v: string) => void;
  onModerator: (v: string) => void;
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
      <Field label="主持风格指令">
        <TextArea
          value={moderatorInstruction}
          onChange={onModerator}
          placeholder="给 AI 访谈员的主持指令:语调、节奏、风格(例如:语气温暖、不急促、给停顿留白、不照读问题)。访谈目标无需重复,已在研究目标里。"
          rows={4}
        />
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
        className="inline-flex h-9 items-center justify-center gap-2 rounded border border-ink-900 bg-ink-0 px-3.5 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-50 disabled:opacity-60"
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
  guide,
  onUpdate,
  onRemove,
}: {
  question: GuideQuestion;
  guide: Guide;
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
                    ? "border-ink-900 bg-mauve-200 text-ink-900"
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
                <span className="font-ui text-caption text-ink-400">{i + 1}.</span>
                <input
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  placeholder={`选项 ${i + 1}`}
                  className="h-8 flex-1 rounded border border-ink-200 bg-ink-0 px-2.5 font-ui text-caption text-ink-800 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400"
                />
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  aria-label="删除选项"
                  className="grid size-7 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600"
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addOption}
              className="mt-0.5 inline-flex w-fit items-center gap-1 font-ui text-caption font-medium text-ink-900 transition-colors hover:text-ink-900"
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
                    ? "border-ink-900 bg-mauve-200 text-ink-900"
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

      <BranchRulesEditor
        currentQuestionId={question.id}
        rules={question.branchRules}
        guide={guide}
        onChange={(next) => onUpdate({ branchRules: next })}
      />

      <ToggleRow
        label="允许主持人跳过此问题"
        checked={question.allowSkip}
        onChange={(v) => onUpdate({ allowSkip: v })}
      />

      <div className="border-t border-ink-100 pt-4">
        <DangerButton onClick={onRemove} label="删除问题" />
      </div>
    </div>
  );
}

/* ============ 复用小组件 ============ */

/**
 * 段落式分支规则编辑器。挂在每道题的编辑面板下方,让研究员用自然语言
 * 描述"什么条件下跳到哪题"。AI 主持人访谈时会根据用户回答实时判断
 * 条件是否成立;第一条命中即用,都不命中就走默认下一题。
 *
 * 设计借鉴 Retell AI 的 Prompt transition condition
 * (docs.retellai.com/build/conversation-flow/transition-condition)。
 * 数据契约见 `packages/contracts/src/api.ts::SurveyDraftBranchRuleSchema`
 * 以及 flow-engine `ConditionStep` 消费逻辑。
 */
function BranchRulesEditor({
  currentQuestionId,
  rules,
  guide,
  onChange,
}: {
  currentQuestionId: string;
  rules: GuideBranchRule[];
  guide: Guide;
  onChange: (rules: GuideBranchRule[]) => void;
}) {
  const [expanded, setExpanded] = useState<boolean>(rules.length > 0);

  // Auto-focus the newly-added rule's condition textarea. `focusPendingRef`
  // is a one-shot flag flipped in addRule, consumed by the effect when the
  // controlled `rules` prop has actually grown (React re-render committed).
  const focusPendingRef = useRef(false);
  const lastRuleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (focusPendingRef.current && lastRuleTextareaRef.current) {
      lastRuleTextareaRef.current.focus();
      focusPendingRef.current = false;
    }
  }, [rules.length]);

  // 展平所有其它题(排除自己),供跳转目标下拉展示。
  const targets = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [];
    let n = 0;
    for (const s of guide.sections) {
      for (const q of s.questions) {
        n += 1;
        if (q.id === currentQuestionId) continue;
        const text = q.questionText.trim() || "(未填写)";
        list.push({
          id: q.id,
          label: `问题 ${n}: ${text.length > 40 ? text.slice(0, 40) + "…" : text}`,
        });
      }
    }
    return list;
  }, [guide, currentQuestionId]);

  const updateRule = (i: number, patch: Partial<GuideBranchRule>) => {
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const removeRule = (i: number) => {
    onChange(rules.filter((_, idx) => idx !== i));
  };
  const moveRule = (i: number, delta: -1 | 1) => {
    const target = i + delta;
    if (target < 0 || target >= rules.length) return;
    const next = rules.slice();
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  };
  const addRule = () => {
    focusPendingRef.current = true;
    onChange([
      ...rules,
      { condition: "", jumpToQuestionId: targets[0]?.id ?? "" },
    ]);
    setExpanded(true);
  };

  const hasTargets = targets.length > 0;

  return (
    <div className="rounded-md border border-ink-100">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="branch-rules-body"
        className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left font-ui text-caption font-medium text-ink-600 transition-colors hover:bg-mauve-50"
      >
        {/*
         * Per design-system.md § Disclosure / row layout (binding): the
         * trailing icon MUST sit flush against the right edge, never
         * adjacent to the label. Label on the left, chevron flush right.
         */}
        <span>
          分支规则
          {rules.length > 0 ? (
            <span className="ml-1 text-ink-900">({rules.length})</span>
          ) : (
            <span className="ml-1 text-ink-400">(可选)</span>
          )}
        </span>
        <ChevronRight
          className={`size-3.5 shrink-0 text-ink-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div id="branch-rules-body" className="border-t border-ink-100 px-3 py-3">
          <p className="mb-3 font-ui text-caption text-ink-400 leading-5">
            按顺序判断,第一条命中即用。AI 主持人会根据用户回答实时判断条件是否成立。
          </p>

          {rules.length === 0 && (
            <div className="mb-3 rounded border border-dashed border-ink-200 px-3 py-4 text-center">
              <p className="font-ui text-caption text-ink-400">
                还没有分支规则
              </p>
              <p className="mt-0.5 font-ui text-caption text-ink-400">
                访谈将按顺序进入下一题
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {rules.map((rule, i) => (
              <BranchRuleRow
                key={i}
                index={i}
                total={rules.length}
                rule={rule}
                targets={targets}
                textareaRef={i === rules.length - 1 ? lastRuleTextareaRef : undefined}
                onUpdate={(patch) => updateRule(i, patch)}
                onRemove={() => removeRule(i)}
                onMoveUp={() => moveRule(i, -1)}
                onMoveDown={() => moveRule(i, 1)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addRule}
            disabled={!hasTargets}
            className="mt-3 inline-flex w-fit items-center gap-1 rounded font-ui text-caption font-medium text-ink-900 transition-colors hover:text-ink-900 disabled:cursor-not-allowed disabled:text-ink-400"
          >
            <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
            添加规则
          </button>

          {!hasTargets && (
            <p className="mt-2 font-ui text-caption text-ink-400">
              需要至少两道题才能配置跳转。
            </p>
          )}

          <div className="mt-3 flex items-center gap-2 rounded bg-mauve-50 px-3 py-2">
            <CornerDownRight
              className="size-3.5 shrink-0 text-mauve-400"
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="font-ui text-caption text-ink-600">
              都未命中时 → 默认进入下一题
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function BranchRuleRow({
  index,
  total,
  rule,
  targets,
  textareaRef,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  index: number;
  total: number;
  rule: GuideBranchRule;
  targets: Array<{ id: string; label: string }>;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onUpdate: (patch: Partial<GuideBranchRule>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const targetKnown = targets.some((t) => t.id === rule.jumpToQuestionId);
  const charCount = rule.condition.length;
  const showCount = charCount > 400;
  const conditionOverLimit = charCount >= 500;

  const canMoveUp = index > 0;
  const canMoveDown = index < total - 1;

  return (
    <div
      className={`rounded border p-3 ${
        // Per design-system.md § Status semantics: warning is
        // `ink-900 text on mauve-100 surface, with triangle-alert icon`.
        // No amber; no color-only signal. Target-deleted rules use the
        // full warning treatment (bg-mauve-100 + AlertTriangle in the
        // inline copy below); normal rules keep the muted mauve-50 card.
        targetKnown
          ? "border-ink-200 bg-mauve-50"
          : "border-ink-900 bg-mauve-100"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-ui text-caption font-semibold text-ink-800">
          规则 {index + 1}
        </span>
        <div className="inline-flex items-center gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label={`将规则 ${index + 1} 上移`}
            className="grid size-7 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-800 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-200 disabled:text-ink-200"
          >
            <ChevronUp className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label={`将规则 ${index + 1} 下移`}
            className="grid size-7 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-800 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-200 disabled:text-ink-200"
          >
            <ChevronDown className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`删除规则 ${index + 1}`}
            className="ml-1 grid size-7 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-800"
          >
            <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <label
        htmlFor={`branch-condition-${index}`}
        className="mb-1 flex items-baseline justify-between font-ui text-caption text-ink-600"
      >
        <span>如果:</span>
        {showCount && (
          <span
            className={`font-ui text-caption tabular-nums ${
              conditionOverLimit ? "text-ink-900" : "text-ink-400"
            }`}
          >
            {charCount}/500
          </span>
        )}
      </label>
      <textarea
        id={`branch-condition-${index}`}
        ref={textareaRef}
        value={rule.condition}
        onChange={(e) => onUpdate({ condition: e.target.value.slice(0, 500) })}
        placeholder="例:用户明确说自己在使用 Slack 且表达了不满"
        rows={3}
        className="mb-2 w-full resize-y rounded border border-ink-200 bg-ink-0 px-2.5 py-2 font-ui text-body-sm leading-6 text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400"
      />

      <label
        htmlFor={`branch-target-${index}`}
        className="mb-1 block font-ui text-caption text-ink-600"
      >
        跳转到:
      </label>
      <select
        id={`branch-target-${index}`}
        value={rule.jumpToQuestionId}
        onChange={(e) => onUpdate({ jumpToQuestionId: e.target.value })}
        className={`w-full rounded border bg-ink-0 px-2 py-2 font-ui text-body-sm outline-none transition-colors focus:border-ink-400 ${
          targetKnown ? "border-ink-200 text-ink-900" : "border-ink-400 text-ink-900"
        }`}
      >
        {!targetKnown && (
          <option value={rule.jumpToQuestionId} disabled>
            (已删除的题) — 请重新选择
          </option>
        )}
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      {!targetKnown && (
        <p
          role="alert"
          className="mt-1.5 flex items-start gap-1.5 font-ui text-caption text-ink-900"
        >
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0 text-ink-900"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span>此规则原来的跳转目标已被删除,请重新选择目标。</span>
        </p>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-left"
    >
      <span className="font-ui text-caption font-medium text-ink-600">{label}</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-mauve-200" : "bg-ink-200"
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-ink-0 transition-transform ${
            checked ? "translate-x-[18px] border border-ink-900" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

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
      <label className="mb-1.5 block font-ui text-caption font-medium text-ink-600">{label}</label>
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
      className="w-full rounded border border-ink-200 bg-ink-0 px-3 py-2 font-ui text-body-sm text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400"
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
      className="w-full resize-none rounded border border-ink-200 bg-ink-0 px-3 py-2 font-ui text-body-sm leading-6 text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400"
    />
  );
}

function DangerButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded border border-ink-900 px-3 font-ui text-body-sm font-medium text-ink-900 transition-colors hover:bg-mauve-50"
    >
      <Trash2 className="size-4" strokeWidth={2} />
      {label}
    </button>
  );
}
