-- One-query stats for the Campaigns and Mailboxes pages. Each database round trip is slow when
-- the app and the database are far apart, so these replace several count queries per item.

create index if not exists messages_campaign_idx on messages(campaign_id);
create index if not exists messages_mailbox_idx on messages(mailbox_id);

create or replace function campaign_stats()
returns table (campaign_id uuid, leads bigint, ready bigint, sent bigint, replies bigint, interested bigint)
language sql stable as $$
  select c.id,
    (select count(*) from leads l where l.campaign_id = c.id),
    (select count(*) from leads l where l.campaign_id = c.id and l.status = 'ready'),
    (select count(*) from messages m where m.campaign_id = c.id and m.direction = 'out' and m.status = 'sent'),
    (select count(*) from messages m where m.campaign_id = c.id and m.direction = 'in'
       and m.classification <> 'bounce' and m.classification <> 'out_of_office'),
    (select count(*) from messages m where m.campaign_id = c.id and m.direction = 'in' and m.classification = 'interested')
  from campaigns c;
$$;

-- sent_today uses the same "today" as mailbox_sent_today (since UTC midnight).
create or replace function mailbox_stats()
returns table (mailbox_id uuid, sent_today bigint, sent_total bigint, received bigint)
language sql stable as $$
  select b.id,
    (select count(*) from messages m where m.mailbox_id = b.id and m.direction = 'out' and m.status = 'sent'
       and m.sent_at >= date_trunc('day', now())),
    (select count(*) from messages m where m.mailbox_id = b.id and m.direction = 'out' and m.status = 'sent'),
    (select count(*) from messages m where m.mailbox_id = b.id and m.direction = 'in')
  from mailboxes b;
$$;

revoke all on function campaign_stats() from public, anon, authenticated;
revoke all on function mailbox_stats() from public, anon, authenticated;
grant execute on function campaign_stats() to service_role;
grant execute on function mailbox_stats() to service_role;
