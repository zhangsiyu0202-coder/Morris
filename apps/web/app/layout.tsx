import type { Metadata, Viewport } from "next";
import { Inter, Inclusive_Sans, Istok_Web, Inika, Inknut_Antiqua } from "next/font/google";
import "./globals.css";
import { AssistantDock } from "@/components/assistant/assistant-dock";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const inclusive = Inclusive_Sans({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-inclusive",
  display: "swap",
});

const istok = Istok_Web({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-istok",
  display: "swap",
});

const inika = Inika({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-inika",
  display: "swap",
});

const inknut = Inknut_Antiqua({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-inknut",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MerismV2 · 访谈进行中",
  description: "AI 语音访谈受访端 · 结构化题目辅助渲染",
};

export const viewport: Viewport = {
  themeColor: "#d7cfd9",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh"
      className={`bg-mauve-50 ${inter.variable} ${inclusive.variable} ${istok.variable} ${inika.variable} ${inknut.variable}`}
    >
      <body className="font-ui antialiased">
        {children}
        <AssistantDock />
      </body>
    </html>
  );
}
