-- Dashboard logins live in the database instead of the ADMIN_PASSWORD env var.
-- Passwords are bcrypt-hashed by pgcrypto; the plain password is never stored.
--
-- Create or reset a login (run in the Supabase SQL editor):
--   select admin_set_password('your-username', 'your-password');
-- Remove a login:
--   delete from admin_users where username = 'your-username';

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(btrim(username)) and username <> ''),
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table admin_users enable row level security;

-- Creates the user, or changes the password if the username already exists.
create or replace function admin_set_password(p_username text, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;
  insert into admin_users (username, password_hash)
  values (lower(btrim(p_username)), crypt(p_password, gen_salt('bf', 10)))
  on conflict (username) do update
    set password_hash = excluded.password_hash, updated_at = now();
end;
$$;

-- Returns the user's id when the username and password match, otherwise null.
create or replace function admin_check_login(p_username text, p_password text)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select id from admin_users
  where username = lower(btrim(p_username))
    and password_hash = crypt(p_password, password_hash);
$$;

-- Only the server (service role) may call these.
revoke all on function admin_set_password(text, text) from public, anon, authenticated;
revoke all on function admin_check_login(text, text) from public, anon, authenticated;
grant execute on function admin_set_password(text, text) to service_role;
grant execute on function admin_check_login(text, text) to service_role;

-- Default login: admin / zappsites@2026. Change it after first sign-in with admin_set_password.
-- Only created when there's no "admin" yet, so re-running this keeps a changed password.
do $$
begin
  if not exists (select 1 from admin_users where username = 'admin') then
    perform admin_set_password('admin', 'zappsites@2026');
  end if;
end;
$$;
