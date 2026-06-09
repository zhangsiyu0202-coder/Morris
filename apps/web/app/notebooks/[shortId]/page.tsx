import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NotebookDetail } from "@/components/notebooks/notebook-detail";
import {
  getCurrentUserId,
  getNotebookById,
  getNotebookByShortId,
} from "@/lib/queries";
import type { NotebookReport } from "@/lib/notebooks";

export const metadata = {
  title: "洞察详情 · Insights",
  description: "围绕这一聚焦问题、结合调研会话内容的深度分析报告。",
};

export const dynamic = "force-dynamic";

/**
 * Notebook 详情页。Wave B 起 URL 用 shortId (12 字符 alphanumeric);
 * 旧 $id-based URL 通过 redirect 兼容到 shortId-based URL (P-NB-01b 的
 * lazy-fill 路径: 旧数据 shortId 为空时, 后端首次访问应补一个 — 但实际
 * 访问只读, 这里读不到就 404).
 */
export default async function NotebookDetailPage({
  params,
}: {
  params: Promise<{ shortId: string }>;
}) {
  const { shortId: param } = await params;
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) {
    return (
      <main className="min-h-dvh bg-ink-0">
        <div className="mx-auto max-w-2xl px-6 py-16 text-center">
          <p className="font-display text-h3 text-ink-900">请先登录</p>
        </div>
      </main>
    );
  }

  // First try as shortId (12-char alphanumeric).
  let record = await getNotebookByShortId(ownerUserId, param);

  // Fall back to legacy $id-based access (Wave A 的 URL); if found, redirect
  // to the shortId-based URL when the row has one populated. Else show
  // legacy details inline (handles transitional Wave A 数据 shortId 为空).
  if (!record && /^[a-zA-Z0-9_]+$/.test(param) && param.length > 12) {
    const byId = await getNotebookById(ownerUserId, param);
    if (byId) {
      if (byId.shortId && byId.shortId.length === 12) {
        redirect(`/notebooks/${byId.shortId}`);
      }
      record = byId;
    }
  }

  if (!record) {
    return (
      <main className="min-h-dvh bg-ink-0">
        <div className="mx-auto max-w-2xl px-6 py-16 text-center">
          <p className="font-display text-h3 text-ink-900">未找到这条洞察</p>
          <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
            它可能已被删除,或链接已失效。请回到列表查看。
          </p>
          <Link
            href="/notebooks"
            className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-4 py-2 font-ui text-body-sm font-medium text-mauve-50 transition-opacity hover:opacity-90"
          >
            <ArrowLeft size={14} /> 返回洞察列表
          </Link>
        </div>
      </main>
    );
  }

  // Wave B fallback: 旧 fixed-shape report 字段可能为 null (Wave D 起 Morris
  // createNotebook 不再 populate report, 改为 ProseMirror content)。Wave C 实现
  // 卡片视图从 content 抽段渲染后, 这个分支会被改写。Wave B 临时: report=null
  // 时显示提示。
  if (!record.report) {
    return (
      <main className="min-h-dvh bg-ink-0">
        <div className="mx-auto max-w-2xl px-6 py-16 text-center">
          <p className="font-display text-h3 text-ink-900">{record.headline}</p>
          <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
            该 Notebook 使用新的 ProseMirror content 格式 (Wave C 待实现卡片视图)。
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-ink-0">
      <NotebookDetail
        studyTitle={record.studyTitle}
        question={record.question}
        report={record.report}
      />
    </main>
  );
}
