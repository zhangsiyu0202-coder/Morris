import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NotebookViewer } from "@/components/notebooks/notebook-viewer";
import {
  getCurrentUserId,
  getNotebookById,
  getNotebookByShortId,
} from "@/lib/queries";

export const metadata = {
  title: "Notebook 详情",
  description: "围绕这一聚焦问题、结合调研会话内容的深度分析报告。",
};

export const dynamic = "force-dynamic";

/**
 * Notebook 详情页 (Wave C: 用 NotebookViewer 渲染卡片视图 / 文档视图,
 * 都只读 D10). 读取按 shortId; 旧 $id-based URL 通过 redirect 兼容。
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

  // Fall back to legacy $id-based access (Wave A 的 URL); redirect to shortId
  // when the row has one populated.
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
          <p className="font-display text-h3 text-ink-900">未找到这条 Notebook</p>
          <p className="mt-2 font-ui text-body-sm leading-6 text-ink-500">
            它可能已被删除,或链接已失效。请回到列表查看。
          </p>
          <Link
            href="/notebooks"
            className="mt-5 inline-flex items-center gap-1.5 rounded bg-mauve-200 px-4 py-2 font-ui text-body-sm font-medium text-ink-900 transition-opacity hover:bg-mauve-100"
          >
            <ArrowLeft size={14} /> 返回列表
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-ink-0">
      <NotebookViewer notebook={record} />
    </main>
  );
}
