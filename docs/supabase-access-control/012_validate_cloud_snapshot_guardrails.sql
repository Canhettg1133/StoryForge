-- Run after the client guardrails are deployed, preferably outside peak hours.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

alter table public.cloud_snapshots validate constraint cloud_snapshots_payload_bytes_check;
alter table public.cloud_snapshots validate constraint cloud_snapshots_slug_length_check;
alter table public.cloud_snapshots validate constraint cloud_snapshots_title_length_check;
alter table public.cloud_snapshots validate constraint cloud_snapshots_metadata_bytes_check;
alter table public.cloud_snapshots validate constraint cloud_snapshots_size_bytes_check;

commit;
