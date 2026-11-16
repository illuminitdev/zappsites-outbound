"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { SESSION_COOKIE, sessionUserId } from "@/lib/session";

type Snapshot = { id: string; count: number }[];

function clean(items: Snapshot): Snapshot {
  return (Array.isArray(items) ? items : [])
    .filter((n) => typeof n?.id === "string" && n.id.length <= 64 && Number.isInteger(n.count) && n.count >= 0)
    .slice(0, 50);
}

async function save(items: Snapshot, kind: "read" | "cleared"): Promise<{ error?: string }> {
  const userId = await sessionUserId((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return { error: "Your session has expired. Log in again." };
  const list = clean(items);
  if (!list.length) return {};
  const now = new Date().toISOString();
  const rows = list.map((n) =>
    kind === "read"
      ? { user_id: userId, notif_id: n.id, read_count: n.count, read_at: now }
      : { user_id: userId, notif_id: n.id, read_count: n.count, read_at: now, cleared_count: n.count, cleared_at: now },
  );
  const { error } = await db().from("notification_states").upsert(rows, { onConflict: "user_id,notif_id" });
  if (error) {
    console.error(`notification ${kind} failed:`, error.message);
    return {
      error: /notification_states/.test(error.message)
        ? "Not saved: run supabase/migrations/0006_notification_states.sql in the Supabase SQL editor."
        : "Couldn't save. Try again.",
    };
  }
  revalidatePath("/", "layout");
  return {};
}

/** Mark the given notifications (at their current counts) as read. */
export async function markNotificationsRead(items: Snapshot) {
  return save(items, "read");
}

/** Hide the given notifications until their counts change. */
export async function clearNotifications(items: Snapshot) {
  return save(items, "cleared");
}
