import { getCurrentUserId } from "@/lib/queries/auth";
import { streamRecordingForOwner } from "@/lib/server/recordings";

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

  // `file.filename` has already been sanitized by `safeFilenameToken` so it is
  // safe to interpolate into the quoted Content-Disposition value. We also
  // forbid CDN/proxy caching: interview recordings are private media and the
  // download URL is owner-gated per request.
  return new Response(file.buffer, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.buffer.byteLength),
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store, private",
    },
  });
}
