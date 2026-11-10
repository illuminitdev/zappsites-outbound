import { NextRequest, NextResponse } from "next/server";

// Everything is behind HTTP basic auth except prospect-facing pages and cron endpoints
// (cron endpoints check their own bearer secret).
const PUBLIC_PREFIXES = ["/p/", "/u/", "/book", "/check", "/api/cron/", "/api/public/", "/_next/", "/favicon"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new NextResponse("ADMIN_PASSWORD is not set", { status: 500 });
  }
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const [user, pass] = atob(header.slice(6)).split(":");
    if (user === "admin" && pass === expected) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="outbound"' },
  });
}

export const config = { matcher: "/:path*" };
