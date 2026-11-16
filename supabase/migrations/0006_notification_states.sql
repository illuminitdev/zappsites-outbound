-- Read / cleared state for the bell's notifications, per admin user.
-- Notifications are computed live (e.g. "20 leads with errors"), so we remember the count the
-- user acknowledged. When the live count changes, the notification counts as new again.

create table if not exists notification_states (
  user_id uuid not null references admin_users(id) on delete cascade,
  notif_id text not null,
  read_count integer,          -- count when last marked as read
  read_at timestamptz,
  cleared_count integer,       -- count when last cleared (hidden from the panel)
  cleared_at timestamptz,
  primary key (user_id, notif_id)
);
alter table notification_states enable row level security;
