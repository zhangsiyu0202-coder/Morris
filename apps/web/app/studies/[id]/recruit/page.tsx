import { RecruitView } from "@/components/studies/recruit-view";
import { getMockRecruit } from "@/lib/mock/workspace";

export default async function RecruitTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recruit = getMockRecruit(id);
  return <RecruitView recruit={recruit} />;
}
