import { RecruitView } from "@/components/studies/recruit-view";
import { loadStudyRecruit } from "@/lib/workspace-data";

export default async function RecruitTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recruit = await loadStudyRecruit(id);
  return <RecruitView recruit={recruit} />;
}
