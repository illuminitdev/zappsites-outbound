import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/session";

// Everything needs an admin session except prospect-facing pages, the login page and cron endpoints
// (cron endpoints check their own bearer secret).
const PUBLIC_PREFIXES = ["/login", "/p/", "/u/", "/book", "/check", "/api/cron/", "/api/public/", "/_next/", "/favicon", "/zappsites-outbound-logo.png"];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new NextResponse("SUPABASE_SERVICE_ROLE_KEY is not set", { status: 500 });

  if (await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = { matcher: "/:path*" };
