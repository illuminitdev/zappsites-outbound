-- Booking form: optional website the visitor can add.
alter table bookings add column if not exists website text;
