import { notFound } from "next/navigation";

import { loadSurveyDraft } from "@/lib/survey/read";
import { InstructionView } from "@/components/studies/instruction-view";

export default async function InstructionTabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = await loadSurveyDraft(id);
  if (!loaded) notFound();

  return <InstructionView surveyId={loaded.surveyId} draft={loaded.draft} />;
}
