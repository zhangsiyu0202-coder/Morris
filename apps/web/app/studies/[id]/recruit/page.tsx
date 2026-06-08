import { RecruitView } from "@/components/studies/recruit-view";
import { getOrCreateTestInterviewLink, listInterviewLinks } from "@/lib/actions/links";
import type { InterviewLink } from "@merism/contracts";

export default async function RecruitTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let initialLinks: InterviewLink[] = [];
  let testLink: InterviewLink | null = null;
  try {
    initialLinks = await listInterviewLinks(id);
    testLink = await getOrCreateTestInterviewLink(id);
  } catch {
    // appwrite_not_configured / survey_not_owned / not reachable → start empty.
  }

  return <RecruitView surveyId={id} initialLinks={initialLinks} testLink={testLink} />;
}
