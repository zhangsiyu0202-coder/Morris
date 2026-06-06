import { listSurveysForOwner } from "@/lib/survey-read";
import { StudiesHome } from "@/components/studies/studies-home";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const studies = await listSurveysForOwner();
  return <StudiesHome studies={studies} />;
}
