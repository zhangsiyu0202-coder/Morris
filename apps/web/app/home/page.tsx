import { listStudies } from "@/lib/actions/studies";
import { StudiesHome } from "@/components/studies/studies-home";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const studies = await listStudies();
  return <StudiesHome studies={studies} />;
}
