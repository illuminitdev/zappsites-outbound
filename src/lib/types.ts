export type LeadStatus =
  | "new"
  | "enriched"
  | "audited"
  | "ready"
  | "sequencing"
  | "replied"
  | "interested"
  | "meeting"
  | "not_interested"
  | "unsubscribed"
  | "bounced"
  | "error";

export type EntityType = "company" | "llp" | "sole_trader" | "partnership" | "unknown";

export interface Step {
  day: number; // days after the first send
  instructions: string;
}

export interface Campaign {
  id: string;
  name: string;
  offer: string;
  icp: string;
  proof: string;
  tone: string;
  booking_url: string;
  steps: Step[];
  send_window_start: number;
  send_window_end: number;
  send_days: number[];
  timezone: string;
  signature: string;
  aeo_category: string; // e.g. "commercial insurance brokers for tradespeople"; empty = skip AEO audit
  aeo_prompts: string[]; // templates with {category} {city} {company}
  auto_approve: boolean;
  active: boolean;
}

export interface Message {
  id: string;
  lead_id: string;
  campaign_id: string | null;
  mailbox_id: string | null;
  direction: "out" | "in";
  step: number | null;
  subject: string | null;
  body_text: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  status: string;
  scheduled_for: string | null;
  sent_at: string | null;
  received_at: string | null;
  classification: ReplyClass | null;
  draft_reply: string | null;
  handled: boolean;
  error: string | null;
  created_at: string;
}

export interface Mailbox {
  id: string;
  email: string;
  from_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  imap_host: string;
  imap_port: number;
  daily_limit: number;
  imap_last_uid: number;
  active: boolean;
}

export interface Lead {
  id: string;
  campaign_id: string | null;
  company: string;
  website: string | null;
  domain: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_status: "unknown" | "valid" | "risky" | "invalid";
  email_source: string | null;
  city: string | null;
  source: string;
  source_ref: string | null;
  entity_type: EntityType;
  pecr_ok: boolean;
  status: LeadStatus;
  slug: string;
  audit: Audit | null;
  audit_score: number | null;
  notes: string | null;
  audit_note: string | null;
  last_error: string | null;
  created_at: string;
}

export interface AuditCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  impact: "high" | "medium" | "low";
}

export interface Audit {
  url: string;
  fetchedAt: string;
  reachable: boolean;
  performance: {
    mobileScore: number | null; // 0-100
    lcpSeconds: number | null;
    cls: number | null;
    screenshot?: string | null; // data:image/jpeg;base64 of their homepage on a phone (from Lighthouse)
  };
  checks: AuditCheck[];
  score: number; // 0-100 overall
  topIssues: AuditCheck[]; // worst first, max 3
  aeo?: AeoAudit | null; // AEO/GEO mentions audit, when engines + a category are configured
}

export interface AeoResult {
  engine: "chatgpt" | "claude" | "perplexity" | "gemini";
  prompt: string;
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  snippet: string | null;
  competitors: string[];
  citedDomains: string[];
  answerExcerpt: string;
  error: string | null;
}

export interface AeoAudit {
  ranAt: string;
  category: string;
  services?: string[]; // services read from their website, used to write the questions
  promptSource?: "website" | "campaign" | "fallback" | "default";
  engines: AeoResult["engine"][];
  prompts: string[];
  results: AeoResult[];
  mentionRate: number; // % of answered prompt x engine pairs that mention them
  answered: number;
  mentions: number;
  topCompetitors: { name: string; count: number }[];
  topCitedDomains: { name: string; count: number }[];
}

export type ReplyClass =
  | "interested"
  | "question"
  | "not_now"
  | "not_interested"
  | "unsubscribe"
  | "out_of_office"
  | "bounce"
  | "other";
