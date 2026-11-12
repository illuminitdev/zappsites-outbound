import type { LucideIcon } from "lucide-react";
import type { LeadStatus } from "@/lib/types";

export function Flash({ msg }: { msg?: string }) {
  return msg ? <div className="msg">{msg}</div> : null;
}

const TONE: Partial<Record<LeadStatus | string, string>> = {
  interested: "good",
  meeting: "good",
  valid: "good",
  sent: "good",
  replied: "info",
  question: "info",
  scheduled: "info",
  sequencing: "info",
  ready: "warn",
  risky: "warn",
  not_now: "warn",
  draft: "warn",
  error: "bad",
  failed: "bad",
  bounced: "bad",
  bounce: "bad",
  unsubscribed: "bad",
  unsubscribe: "bad",
  invalid: "bad",
  not_interested: "bad",
};

export function Pill({ v }: { v: string | null | undefined }) {
  if (!v) return null;
  return <span className={`pill ${TONE[v] ?? ""}`}>{v.replace(/_/g, " ")}</span>;
}

/** Audit score as a coloured badge. */
export function Score({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span className="muted">–</span>;
  const tone = v >= 75 ? "good" : v >= 50 ? "warn" : "bad";
  return <span className={`score ${tone}`}>{v}</span>;
}

/** Friendly empty state for lists. */
export function Empty({ title, children, icon: Icon }: { title: string; children?: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className="empty">
      {Icon && (
        <span className="empty-icon">
          <Icon size={22} aria-hidden="true" />
        </span>
      )}
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}

export function fmt(d: string | null | undefined) {
  return d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }) : "";
}
