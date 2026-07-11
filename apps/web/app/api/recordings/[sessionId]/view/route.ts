import { getCurrentUserId } from "@/lib/queries/auth";
import { streamRecordingForOwner } from "@/lib/server/recordings";

export async function GET(
  req: Request,
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

  const total = file.buffer.byteLength;
  const baseHeaders: Record<string, string> = {
    "Content-Type": file.contentType,
    "Content-Disposition": `inline; filename="${file.filename}"`,
    "Cache-Control": "no-store, private",
    "Accept-Ranges": "bytes",
  };

  // Honor a single byte-range so <video>/<audio> can seek. The whole file is
  // already buffered in memory (see streamRecordingForOwner), so a range is a
  // cheap slice — no second storage round-trip.
  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
      if (Number.isNaN(start) || start > end || start >= total) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
        });
      }
      const slice = file.buffer.slice(start, end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Length": String(slice.byteLength),
          "Content-Range": `bytes ${start}-${end}/${total}`,
        },
      });
    }
  }

  return new Response(file.buffer, {
    headers: { ...baseHeaders, "Content-Length": String(total) },
  });
}

