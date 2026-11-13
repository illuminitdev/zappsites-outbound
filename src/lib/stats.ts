import { cache } from "react";
import { db } from "./db";

// Supabase returns at most 1000 rows per request, so beyond that we fall back to one count per status.
const ROW_LIMIT = 1000;
const FALLBACK_STATUSES = ["new", "enriched", "audited", "ready", "sequencing", "replied", "interested", "meeting", "not_interested", "unsubscribed", "bounced", "error"];

/**
 * Lead counts by status, plus the total, in one database round trip.
 * Cached per request, so the layout and the page share a single query.
 */
export const leadStatusCounts = cache(async (): Promise<{ total: number; byStatus: Map<string, number> }> => {
  const r = await db().from("leads").select("status", { count: "exact" }).range(0, ROW_LIMIT - 1);
  if (r.error) return { total: 0, byStatus: new Map() };
  const rows = (r.data ?? []) as { status: string }[];
  const total = r.count ?? rows.length;

  if (total <= rows.length) {
    const byStatus = new Map<string, number>();
    for (const { status } of rows) byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    return { total, byStatus };
  }

  // Large table: count each status on the server instead (parallel, still correct).
  const head = { count: "exact" as const, head: true };
  const counts = await Promise.all(
    FALLBACK_STATUSES.map(async (s) => [s, (await db().from("leads").select("id", head).eq("status", s)).count ?? 0] as const),
  );
  return { total, byStatus: new Map(counts) };
});
