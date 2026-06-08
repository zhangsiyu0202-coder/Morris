import { getCurrentUserId } from "@/lib/queries/auth";
import { streamRecordingForOwner } from "@/lib/actions/recordings";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ownerUserId = await getCurrentUserId();
  if (!ownerUserId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { sessionId } = await params;
  const file = await streamRecordingForOwner(sessionId, ownerUserId);
  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(file.buffer, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
    },
  });
}
