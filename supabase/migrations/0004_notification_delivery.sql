-- Honest notification delivery state. Notifications are inserted un-sent
-- (sent_at = null) and a delivery pass flips sent_at on success or records the
-- failure in delivery_error, bumping attempts. This replaces the previous
-- behaviour where sent_at was set optimistically with no real delivery.

alter table public.notifications
  add column if not exists delivery_error text,
  add column if not exists attempts int not null default 0;

-- Lets a delivery worker quickly find what still needs shipping.
create index if not exists notif_unsent_idx
  on public.notifications(channel, sent_at)
  where sent_at is null;
