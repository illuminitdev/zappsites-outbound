-- Outbound engine schema. Run in the Supabase SQL editor or with `supabase db push`.
-- All access is via the service role from the server; RLS is enabled with no policies,
-- so the anon key can read nothing.

create extension if not exists pgcrypto;

-- Sending mailboxes (use secondary domains, never your main domain).
create table mailboxes (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  from_name text not null,
  smtp_host text not null,
  smtp_port int not null default 465,
  smtp_user text not null,
  smtp_pass text not null,          -- app password; consider Supabase Vault in production
  imap_host text not null,
  imap_port int not null default 993,
  daily_limit int not null default 30,
  imap_last_uid bigint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  offer text not null,              -- what you sell, in one or two sentences
  icp text not null,                -- who it is for
  proof text not null default '',   -- case studies / credibility lines Claude may use (never invented)
  tone text not null default 'plain, direct, British English, no hype',
  booking_url text not null,
  -- [{ "day": 0, "instructions": "..." }, { "day": 3, ... }]
  steps jsonb not null default '[{"day":0,"instructions":"Open with the single most costly finding from their audit. Link their audit page. Ask for a 15 minute call."},{"day":3,"instructions":"Short bump. Add one different finding. Same ask."},{"day":7,"instructions":"Break-up email. Offer to send the full fix list. No pressure."}]'::jsonb,
  send_window_start int not null default 8,    -- local hour, inclusive
  send_window_end int not null default 17,     -- local hour, exclusive
  send_days int[] not null default '{1,2,3,4,5}', -- ISO weekday 1=Mon
  timezone text not null default 'Europe/London',
  signature text not null default '',           -- e.g. "Ram\nFounder, Web Vault Pro"
  -- false = every written sequence waits in the dashboard for your approval before scheduling
  auto_approve boolean not null default false,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create type lead_status as enum (
  'new',          -- imported, nothing done
  'enriched',     -- email found
  'audited',      -- site audited
  'ready',        -- first email written, awaiting PECR check / approval
  'sequencing',   -- emails scheduled or being sent
  'replied',      -- any human reply
  'interested',   -- positive reply
  'meeting',      -- call booked
  'not_interested',
  'unsubscribed',
  'bounced',
  'error'
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete set null,
  company text not null,
  website text,
  domain text,
  first_name text,
  last_name text,
  email text,
  email_status text not null default 'unknown',  -- unknown | valid | risky | invalid
  email_source text,                               -- site | hunter | pattern | csv
  city text,
  source text not null,                            -- csv | companies_house | places
  source_ref text,                                 -- company number / place id
  entity_type text not null default 'unknown',     -- company | llp | sole_trader | partnership | unknown
  -- PECR: unsolicited B2B email is only allowed to corporate subscribers (Ltd, LLP, PLC...)
  -- without prior consent. Sole traders and partnerships need consent. Sending is blocked
  -- until this is true.
  pecr_ok boolean not null default false,
  status lead_status not null default 'new',
  slug text not null unique default encode(gen_random_bytes(6), 'hex'),
  audit jsonb,
  audit_score int,
  audited_at timestamptz,
  notes text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_status_idx on leads(status);
create index leads_campaign_idx on leads(campaign_id);
create unique index leads_campaign_email_uniq on leads(campaign_id, lower(email)) where email is not null;

create table messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  mailbox_id uuid references mailboxes(id) on delete set null,
  direction text not null check (direction in ('out','in')),
  step int,                                  -- sequence step for outbound
  subject text,
  body_text text,
  message_id text,                           -- RFC Message-ID
  in_reply_to text,
  status text not null,                      -- out: draft | scheduled | sent | failed | cancelled ; in: received
  scheduled_for timestamptz,
  sent_at timestamptz,
  received_at timestamptz,
  classification text,                       -- interested | question | not_now | not_interested | unsubscribe | out_of_office | bounce | other
  draft_reply text,                          -- Claude's suggested answer, awaiting your approval
  handled boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index messages_due_idx on messages(status, scheduled_for) where direction = 'out';
create index messages_lead_idx on messages(lead_id);
create index messages_msgid_idx on messages(message_id);

create table suppression (
  value text primary key,                    -- lowercased email or domain
  kind text not null check (kind in ('email','domain')),
  reason text not null,
  created_at timestamptz not null default now()
);

create table events (
  id bigserial primary key,
  lead_id uuid references leads(id) on delete cascade,
  type text not null,                        -- page_view | booking_click | ...
  meta jsonb,
  created_at timestamptz not null default now()
);
create index events_lead_idx on events(lead_id);

-- Count of outbound messages a mailbox has sent today (UTC day).
create or replace function mailbox_sent_today(mb uuid) returns int language sql stable as $$
  select count(*)::int from messages
  where mailbox_id = mb and direction = 'out' and status = 'sent'
    and sent_at >= date_trunc('day', now());
$$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger leads_touch before update on leads for each row execute function touch_updated_at();

alter table mailboxes enable row level security;
alter table campaigns enable row level security;
alter table leads enable row level security;
alter table messages enable row level security;
alter table suppression enable row level security;
alter table events enable row level security;
