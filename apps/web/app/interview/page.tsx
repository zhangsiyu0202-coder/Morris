import { InterviewRoom } from "@/components/interview/interview-room"

export const metadata = {
  title: "AI 访谈",
  description: "与 AI 访谈员进行的语音访谈",
}

/**
 * Interviewee entry point: /interview?link=<token>
 *
 * Reads the link token on the server (Next 15 async searchParams) and hands it
 * to the client room, which exchanges it for a LiveKit token and connects.
 */
export default async function InterviewPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>
}) {
  const { link } = await searchParams
  return (
    <main className="min-h-dvh bg-mauve-50">
      <InterviewRoom linkToken={link ?? null} />
    </main>
  )
}
