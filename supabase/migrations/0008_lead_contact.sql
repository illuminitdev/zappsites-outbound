-- Phone and address from the lead source (Google listing or the free-check form),
-- used to check the website's name/address/phone matches the Google listing.
alter table leads add column if not exists phone text;
alter table leads add column if not exists address text;
