import { notFound } from "next/navigation";
import { loadSurveyMeta } from "@/lib/survey/read";
import { WorkspaceHeader } from "@/components/studies/workspace-header";
import { WorkspaceTabs } from "@/components/studies/workspace-tabs";
import { StudyPageContextBridge } from "@/components/studies/page-context-bridge";

/**
 * Study 工作台外壳:顶部标题栏 + Tab 导航,下方渲染各 Tab 子页。
 * 数据通过 App Router 嵌套路由切换,不再用客户端 useState 开关。
 */
export default async function StudyWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meta = await loadSurveyMeta(id);
  if (!meta) notFound();

  return (
    <div className="flex h-full flex-col bg-mauve-50">
      <StudyPageContextBridge surveyId={meta.surveyId} />
      <WorkspaceHeader surveyId={meta.surveyId} title={meta.title} status={meta.status} lastSaved="刚刚" />
      <WorkspaceTabs studyId={id} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
