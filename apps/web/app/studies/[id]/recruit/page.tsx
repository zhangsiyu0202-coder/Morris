import { RecruitView } from "@/components/studies/recruit-view";
import { getOrCreateTestInterviewLink, listInterviewLinks } from "@/lib/actions/links";
import { getRecruitmentCriteria } from "@/lib/actions/recruitment";

export default async function RecruitTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [initialLinks, testLink, initialCriteria] = await Promise.all([
    listInterviewLinks(id),
    getOrCreateTestInterviewLink(id),
    getRecruitmentCriteria(id),
  ]);

  return (
    <RecruitView
      surveyId={id}
      initialLinks={initialLinks}
      testLink={testLink}
      initialCriteria={initialCriteria}
    />
  );
}
