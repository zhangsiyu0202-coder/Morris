import type { Metadata } from "next";
import { MarketingHome } from "@/components/marketing/marketing-home";

export const metadata: Metadata = {
  title: "Merism · AI 定性研究平台",
  description: "从研究设计、匿名 AI 访谈到证据回看的一体化定性研究平台。",
};

export default function HomePage() {
  return <MarketingHome />;
}
