import { notFound } from "next/navigation";
import { getStudy } from "@/lib/actions/studies";
import { GuideEditor } from "@/components/studies/guide-editor";

export default async function StudyGuidePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const study = await getStudy(id);
  if (!study) notFound();

  return <GuideEditor study={study} />;
}
