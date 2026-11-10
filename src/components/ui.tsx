import type { LeadStatus } from "@/lib/types";

export function Flash({ msg }: { msg?: string }) {
  return msg ? <div className="msg">{msg}</div> : null;
}

const TONE: Partial<Record<LeadStatus | string, string>> = {
  interested: "good",
  meeting: "good",
  valid: "good",
  sequencing: "warn",
  ready: "warn",
  risky: "warn",
  error: "bad",
  bounced: "bad",
  unsubscribed: "bad",
  invalid: "bad",
  not_interested: "bad",
};

export function Pill({ v }: { v: string | null | undefined }) {
  if (!v) return null;
  return <span className={`pill ${TONE[v] ?? ""}`}>{v.replace(/_/g, " ")}</span>;
}

export function fmt(d: string | null | undefined) {
  return d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }) : "";
}
