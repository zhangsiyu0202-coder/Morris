import { listSurveysForOwner } from "@/lib/survey/read";
import { getCurrentUserId } from "@/lib/queries/auth";
import { loadHomeBookmarks, loadHomeReportPreviews } from "@/lib/workspace/home-data";
import { StudiesHome } from "@/components/studies/studies-home";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const ownerUserId = await getCurrentUserId();
  // After auth resolves, the three reads are independent — surface them in
  // parallel so the longest dictates page TTFB instead of the sum.
  const [studies, reportPreviews, bookmarks] = await Promise.all([
    listSurveysForOwner(),
    ownerUserId ? loadHomeReportPreviews(ownerUserId) : Promise.resolve([]),
    ownerUserId ? loadHomeBookmarks(ownerUserId) : Promise.resolve([]),
  ]);
  return (
    <StudiesHome studies={studies} reportPreviews={reportPreviews} bookmarks={bookmarks} />
  );
}
