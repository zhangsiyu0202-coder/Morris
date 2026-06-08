import { listSurveysForOwner } from "@/lib/survey-read";
import { getCurrentUserId } from "@/lib/queries/auth";
import { loadHomeBookmarks, loadHomeReportPreviews } from "@/lib/home-data";
import { StudiesHome } from "@/components/studies/studies-home";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const ownerUserId = await getCurrentUserId();
  const studies = await listSurveysForOwner();
  const reportPreviews = ownerUserId ? await loadHomeReportPreviews(ownerUserId) : [];
  const bookmarks = ownerUserId ? await loadHomeBookmarks(ownerUserId) : [];
  return (
    <StudiesHome studies={studies} reportPreviews={reportPreviews} bookmarks={bookmarks} />
  );
}
