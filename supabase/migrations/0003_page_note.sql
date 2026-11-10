-- Personal note from the sender shown at the top of each prospect's audit page.
alter table leads add column if not exists audit_note text;
