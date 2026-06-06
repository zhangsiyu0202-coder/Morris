import { redirect } from "next/navigation";

export default async function StudyIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/studies/${id}/overview`);
}
