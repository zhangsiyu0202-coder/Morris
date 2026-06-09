import { NextResponse, type NextRequest } from "next/server";

/**
 * Coarse-grained route gate for the researcher workspace (Formbricks `proxy.ts`
 * pattern). Edge runtime cannot validate the Appwrite session, so this only
 * checks for the presence of the session cookie and redirects to `/login`
 * otherwise. Real validation happens in Server Components via
 * `requireResearcher()` / `getCurrentResearcher()`.
 *
 * Interviewee surfaces (`/`, `/interview`) and the auth pages are NOT matched,
 * so anonymous interviewees and signed-out researchers can still reach them.
 */
export function middleware(req: NextRequest) {
  const projectId = process.env.APPWRITE_PROJECT_ID;
  const cookieName = projectId ? `a_session_${projectId}` : null;
  const hasSession = cookieName ? req.cookies.has(cookieName) : false;

  if (hasSession) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("callbackUrl", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/home/:path*",
    "/studies/:path*",
    "/notebooks/:path*",
    "/reports/:path*",
    "/assistant/:path*",
    "/settings/:path*",
  ],
};
