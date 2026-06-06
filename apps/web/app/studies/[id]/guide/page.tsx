import { notFound } from "next/navigation";
import { loadSurveyDraft } from "@/lib/survey-read";
import { GuideEditor } from "@/components/studies/guide-editor";

export default async function GuideTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = await loadSurveyDraft(id);
  if (!loaded) notFound();

  return <GuideEditor surveyId={loaded.surveyId} draft={loaded.draft} />;
}
