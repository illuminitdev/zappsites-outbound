const STAGE: Record<string, string> = {
  Enrich: "Couldn't find contact details",
  Audit: "Website audit failed",
  "Inbound audit": "Website audit failed",
  Write: "Couldn't write the email",
};

/**
 * Turns a stored `last_error` (often "Stage: 401 {raw json}") into one short, readable line.
 * The raw text is still kept in the database for debugging.
 */
export function friendlyError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(Enrich|Audit|Inbound audit|Write):\s*([\s\S]*)$/);
  const stage = m ? STAGE[m[1]] : null;
  const rest = (m ? m[2] : raw).trim();

  const http = rest.match(/^(\d{3})\b\s*([\s\S]*)$/);
  const code = http ? Number(http[1]) : null;
  let detail = http ? http[2] : rest;
  try {
    const j = JSON.parse(detail);
    detail = j?.error?.message ?? j?.message ?? j?.error ?? detail;
  } catch {
    /* not JSON */
  }
  const text = String(detail).toLowerCase();

  let reason: string;
  if (code === 401 || code === 403 || /api[-_ ]?key|unauthori[sz]ed|authentication/.test(text)) reason = "API key is invalid or missing. Check your environment settings.";
  else if (code === 429 || /rate limit/.test(text)) reason = "Rate limited. It will be retried later.";
  else if (code === 529 || /overloaded/.test(text)) reason = "Service is busy. It will be retried later.";
  else if (code && code >= 500) reason = "Service error. Try again later.";
  else if (/credit|billing|balance/.test(text)) reason = "Out of API credit. Check your billing.";
  else if (/timeout|timed out|aborted/.test(text)) reason = "Request timed out.";
  else if (/fetch failed|enotfound|econnrefused|network/.test(text)) reason = "Couldn't reach the site.";
  else {
    const s = String(detail).replace(/\s+/g, " ").trim();
    reason = s.length > 90 ? `${s.slice(0, 87)}…` : s;
  }
  return stage ? `${stage}: ${reason}` : reason;
}
