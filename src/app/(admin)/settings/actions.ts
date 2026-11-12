"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { SESSION_COOKIE, sessionUserId } from "@/lib/session";

const back = (key: "ok" | "error", msg: string) => redirect(`/settings?${key}=${encodeURIComponent(msg)}`);

async function currentUser(): Promise<{ id: string; username: string }> {
  const id = await sessionUserId((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) redirect("/login");
  const { data } = await db().from("admin_users").select("id, username").eq("id", id).maybeSingle();
  if (!data) redirect("/login");
  return data;
}

async function passwordMatches(username: string, password: string): Promise<boolean> {
  const { data } = await db().rpc("admin_check_login", { p_username: username, p_password: password });
  return typeof data === "string";
}

export async function updateUsername(f: FormData) {
  const user = await currentUser();
  const username = String(f.get("username") ?? "").trim().toLowerCase();
  const password = String(f.get("current_password") ?? "");

  if (!/^[a-z0-9._@-]{3,64}$/.test(username)) back("error", "Username must be 3–64 characters: letters, numbers, . _ @ or -.");
  if (username === user.username) back("error", "That is already your username.");
  if (!(await passwordMatches(user.username, password))) back("error", "Current password is wrong.");

  const { error } = await db().from("admin_users").update({ username, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (error) back("error", error.code === "23505" ? "That username is already taken." : "Could not update username.");

  revalidatePath("/", "layout");
  back("ok", "Username updated.");
}

export async function updatePassword(f: FormData) {
  const user = await currentUser();
  const current = String(f.get("current_password") ?? "");
  const next = String(f.get("new_password") ?? "");
  const confirm = String(f.get("confirm_password") ?? "");

  if (next.length < 8) back("error", "New password must be at least 8 characters.");
  if (next !== confirm) back("error", "New passwords don't match.");
  if (!(await passwordMatches(user.username, current))) back("error", "Current password is wrong.");

  const { error } = await db().rpc("admin_set_password", { p_username: user.username, p_password: next });
  if (error) back("error", "Could not update password.");

  back("ok", "Password updated.");
}
