"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/session";

/** Only allow redirects back into this app (no "//evil.com" or absolute URLs). */
function safeNext(v: string): string {
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : "/";
}

export async function login(f: FormData) {
  const next = safeNext(String(f.get("next") ?? "/"));
  const password = String(f.get("password") ?? "");
  const username = String(f.get("username") ?? "").trim().toLowerCase();
  const { data: userId, error } = await db().rpc("admin_check_login", { p_username: username, p_password: password });
  if (error) console.error("admin login check failed:", error.message);
  if (!username || !password || typeof userId !== "string") {
    redirect(`/login?error=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  }
  (await cookies()).set(SESSION_COOKIE, await sessionToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(next);
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
