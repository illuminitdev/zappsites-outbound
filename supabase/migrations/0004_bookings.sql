-- Built-in booking page (audit.zappsites.com/book/...), replacing external Calendly/Cal.com links.
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  name text not null,
  email text not null,
  phone text,
  company text,
  method text not null default 'phone' check (method in ('phone', 'video')),
  note text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);
-- One call per slot: a second booking for the same time is rejected by the database.
create unique index if not exists bookings_slot_uniq on bookings(start_at) where status = 'confirmed';
alter table bookings enable row level security;

-- Campaign booking links are optional now; the built-in page is used when empty.
alter table campaigns alter column booking_url set default '';
