"use client";

import { useState } from "react";
import { Lightbulb, Sparkles, Loader2, AlertTriangle, ArrowRight, Quote } from "lucide-react";
import type { GeneratedInsight } from "@/lib/insights";

type StudyOption = {
  id: string;
  title: string;
  status: "draft" | "live" | "closed";
  responses: number;
};

const SUGGESTED_QUESTIONS = [
  "受访者最主要的痛点是什么?",
  "哪些因素最影响用户的满意度?",
  "不同受访者的观点有哪些明显分歧?",
  "我们下一步应该优先改进什么?",
];

const STATUS_LABEL: Record<StudyOption["status"], string> = {
  live: "进行中",
  draft: "草稿",
  closed: "已结束",
};

export function InsightsWorkbench({ studies }: { studies: StudyOption[] }) {
  const [studyId, setStudyId] = useState(studies[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [insight, setInsight] = useState<GeneratedInsight | null>(null);

  const selectedStudy = studies.find((s) => s.id === studyId);
  const canGenerate = studyId && question.trim().length >= 2 && status !== "loading";

  async function generate() {
    if (!canGenerate) return;
    setStatus("loading");
    setErrorMsg("");
    setInsight(null);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyId, question: question.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error ?? "洞察生成失败,请稍后重试。");
        setStatus("error");
        return;
      }
      setInsight(data.insight as GeneratedInsight);
      setStatus("idle");
    } catch {
      setErrorMsg("网络异常,请检查连接后重试。");
      setStatus("error");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      {/* 标题区 */}
      <header className="flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded bg-mauve-100 px-2.5 py-1 font-ui text-caption font-medium uppercase tracking-wide text-ink-600">
          <Lightbulb size={13} /> Insights
        </span>
        <h1 className="font-display text-display-lg text-ink-900 text-balance">研究洞察</h1>
        <p className="font-ui text-body-sm leading-6 text-ink-400">
          选择一项已完成的调研,提出聚焦问题,基于真实访谈数据一键生成结构化洞察。
        </p>
      </header>

      {/* 输入卡 */}
      <section className="flex flex-col gap-4 rounded bg-mauve-50 px-5 py-5 shadow-[0_2px_4px_rgba(167,133,133,0.08)]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="study" className="font-ui text-body-sm font-medium text-ink-800">
            选择调研
          </label>
          <select
            id="study"
            value={studyId}
            onChange={(e) => setStudyId(e.target.value)}
            className="h-10 w-full rounded border border-mauve-200 bg-ink-0 px-3 font-ui text-body-sm text-ink-900 outline-none transition-colors focus:border-mauve-400"
          >
            {studies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · {STATUS_LABEL[s.status]}({s.responses} 份)
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="question" className="font-ui text-body-sm font-medium text-ink-800">
            你的问题
          </label>
          <textarea
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder="例如:受访者对搜索筛选体验的主要不满是什么?"
            className="w-full resize-none rounded border border-mauve-200 bg-ink-0 px-3 py-2.5 font-ui text-body-sm leading-6 text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-mauve-400"
          />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuestion(q)}
                className="rounded-full bg-mauve-100 px-3 py-1 font-ui text-caption text-ink-600 transition-colors hover:bg-mauve-200"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className="inline-flex h-10 items-center justify-center gap-2 rounded bg-ink-900 px-4 font-ui text-body-sm font-medium text-ink-0 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === "loading" ? (
            <>
              <Loader2 size={15} className="animate-spin" /> 生成中…
            </>
          ) : (
            <>
              <Sparkles size={15} /> 生成洞察
            </>
          )}
        </button>
      </section>

      {/* 错误态 */}
      {status === "error" && (
        <div className="flex items-start gap-2 rounded border border-mauve-200 bg-mauve-50 px-4 py-3">
          <span className="mt-0.5 shrink-0" style={{ color: "var(--color-negative)" }}>
            <AlertTriangle size={15} />
          </span>
          <div className="flex-1">
            <p className="font-ui text-body-sm leading-6 text-ink-800">{errorMsg}</p>
            <button
              onClick={generate}
              className="mt-1.5 inline-flex items-center gap-1.5 font-ui text-body-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
            >
              重试 <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* 结果卡 */}
      {insight && (
        <article className="flex flex-col gap-5 rounded bg-mauve-50 px-5 py-5 shadow-[0_2px_4px_rgba(167,133,133,0.08)]">
          {selectedStudy && (
            <p className="font-ui text-caption uppercase tracking-wide text-ink-400">
              基于「{selectedStudy.title}」生成
            </p>
          )}
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-display-md leading-tight text-ink-900 text-pretty">
              {insight.headline}
            </h2>
            <p className="font-ui text-body-sm leading-6 text-ink-600">{insight.summary}</p>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="font-ui text-body-sm font-semibold text-ink-800">关键发现</h3>
            {insight.keyPoints.map((kp, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded bg-mauve-100 px-4 py-3">
                <p className="font-ui text-body-sm font-medium leading-6 text-ink-900">
                  {kp.point}
                </p>
                <p className="flex items-start gap-1.5 font-ui text-caption leading-5 text-ink-600">
                  <span className="mt-0.5 shrink-0 text-ink-400">
                    <Quote size={12} />
                  </span>
                  {kp.evidence}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-mauve-200 pt-4">
            <h3 className="font-ui text-body-sm font-semibold text-ink-800">建议</h3>
            <p className="font-ui text-body-sm leading-6 text-ink-600">
              {insight.recommendation}
            </p>
          </div>
        </article>
      )}
    </div>
  );
}
