"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  AlertTriangle,
  RotateCcw,
  Quote,
  GitCompareArrows,
  ListChecks,
} from "lucide-react";
import { getInsight, type StoredInsight } from "@/lib/insights-store";
import type { InsightReport } from "@/lib/insights";

const CONFIDENCE_LABEL: Record<InsightReport["confidence"], string> = {
  high: "高置信度",
  medium: "中等置信度",
  low: "低置信度",
};

const PRIORITY_STYLE: Record<string, string> = {
  P0: "bg-mauve-300 text-ink-900",
  P1: "bg-mauve-200 text-ink-800",
  P2: "bg-mauve-100 text-ink-600",
};

export function InsightDetail({ id }: { id: string }) {
  const [record, setRecord] = useState<StoredInsight | null | undefined>(undefined);
  const [report, setReport] = useState<InsightReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 从 sessionStorage 读取该洞察记录(客户端)。
  useEffect(() => {
    setRecord(getInsight(id) ?? null);
  }, [id]);

  const runReport = useCallback(async () => {
    if (!record) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyId: record.studyId, question: record.question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "深度分析生成失败,请重试。");
      setReport(data.report as InsightReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "深度分析生成失败,请重试。");
    } finally {
      setLoading(false);
    }
  }, [record]);

  // 记录就绪后自动生成一次深度分析。
  useEffect(() => {
    if (record) void runReport();
  }, [record, runReport]);

  // 记录不存在(如刷新丢失或直接访问)
  if (record === null) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="font-display text-h3 text-ink-900">未找到这条洞察</p>
        <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
          它可能已被清除,或链接已失效。请回到列表重新生成。
        </p>
        <Link
          href="/insights"
          className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-4 py-2 font-ui text-body-sm font-medium text-mauve-50 transition-opacity hover:opacity-90"
        >
          <ArrowLeft size={14} /> 返回洞察列表
        </Link>
      </div>
    );
  }

  if (record === undefined) {
    return (
      <div className="flex items-center justify-center py-24 text-ink-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* 返回 + 来源 */}
      <Link
        href="/insights"
        className="inline-flex items-center gap-1.5 font-ui text-body-sm text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft size={14} /> 全部洞察
      </Link>

      {/* 标题区:用户的问题作为主标题 */}
      <header className="mt-4 border-b border-mauve-200 pb-6">
        <p className="font-ui text-caption uppercase tracking-[0.14em] text-ink-400">
          {record.studyTitle}
        </p>
        <h1 className="mt-2 text-balance font-display text-h1 leading-tight text-ink-900">
          {record.question}
        </h1>
        <p className="mt-3 font-ui text-body-sm leading-6 text-ink-500">
          基于该调研的真实会话内容,围绕这一问题的深入分析报告。
        </p>
      </header>

      {/* 加载态 */}
      {loading && (
        <div className="mt-10 flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 size={22} className="animate-spin text-ink-400" />
          <p className="font-ui text-body-sm text-ink-500">正在结合会话内容深入分析…</p>
        </div>
      )}

      {/* 错误态 */}
      {error && !loading && (
        <div className="mt-8 flex items-start gap-2 rounded-md border border-mauve-200 bg-mauve-50 px-4 py-3">
          <span className="mt-0.5 shrink-0" style={{ color: "var(--color-negative)" }}>
            <AlertTriangle size={15} />
          </span>
          <div className="flex-1">
            <p className="font-ui text-body-sm leading-6 text-ink-800">{error}</p>
            <button
              onClick={runReport}
              className="mt-1.5 inline-flex items-center gap-1.5 font-ui text-body-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
            >
              <RotateCcw size={13} /> 重试
            </button>
          </div>
        </div>
      )}

      {/* 报告主体 */}
      {report && !loading && (
        <div className="mt-8 flex flex-col gap-8">
          {/* 直接回答 + 置信度 */}
          <section className="rounded-lg bg-mauve-100 px-6 py-5">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-ink-500" />
              <span className="font-ui text-caption font-medium uppercase tracking-wide text-ink-500">
                直接回答
              </span>
              <span className="ml-auto rounded-full bg-mauve-200 px-2.5 py-0.5 font-ui text-caption font-medium text-ink-700">
                {CONFIDENCE_LABEL[report.confidence]}
              </span>
            </div>
            <p className="mt-3 text-pretty font-display text-h3 leading-snug text-ink-900">
              {report.directAnswer}
            </p>
            <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
              {report.confidenceReason}
            </p>
          </section>

          {/* 维度深入分析 */}
          <section>
            <h2 className="font-display text-h3 text-ink-900">逐维度分析</h2>
            <div className="mt-4 flex flex-col gap-5">
              {report.themes.map((t, i) => (
                <article key={i} className="rounded-lg border border-mauve-200 px-5 py-4">
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-data text-body-sm text-ink-300">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-display text-body-lg font-medium text-ink-900">
                      {t.title}
                    </h3>
                  </div>
                  <p className="mt-2 font-ui text-body-sm leading-7 text-ink-700">{t.analysis}</p>
                  {t.quotes.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-2">
                      {t.quotes.map((q, qi) => (
                        <li
                          key={qi}
                          className="flex gap-2 rounded-md bg-mauve-50 px-3 py-2 font-ui text-body-sm italic leading-6 text-ink-600"
                        >
                          <Quote size={13} className="mt-1 shrink-0 text-ink-300" />
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </section>

          {/* 观点分歧 */}
          {report.divergences.length > 0 && (
            <section>
              <div className="flex items-center gap-2">
                <GitCompareArrows size={16} className="text-ink-500" />
                <h2 className="font-display text-h3 text-ink-900">观点分歧</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {report.divergences.map((d, i) => (
                  <div key={i} className="rounded-lg border border-mauve-200 bg-mauve-50 px-4 py-3">
                    <p className="font-ui text-caption font-medium uppercase tracking-wide text-ink-400">
                      {d.group}
                    </p>
                    <p className="mt-1.5 font-ui text-body-sm leading-6 text-ink-800">{d.stance}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 行动建议 */}
          <section>
            <div className="flex items-center gap-2">
              <ListChecks size={16} className="text-ink-500" />
              <h2 className="font-display text-h3 text-ink-900">行动建议</h2>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {report.actions.map((a, i) => (
                <div key={i} className="flex gap-3 rounded-lg border border-mauve-200 px-4 py-3">
                  <span
                    className={`mt-0.5 h-fit shrink-0 rounded px-2 py-0.5 font-data text-caption font-semibold ${
                      PRIORITY_STYLE[a.priority] ?? "bg-mauve-100 text-ink-600"
                    }`}
                  >
                    {a.priority}
                  </span>
                  <div>
                    <p className="font-ui text-body-sm font-medium leading-6 text-ink-900">
                      {a.action}
                    </p>
                    <p className="mt-1 font-ui text-body-sm leading-6 text-ink-500">{a.rationale}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
