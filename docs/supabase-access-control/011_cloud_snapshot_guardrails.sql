-- Add low-cost per-row Cloud Sync limits without scanning existing payloads.
-- New and updated rows are checked immediately; validate existing rows with 012.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cloud_snapshots_payload_bytes_check') then
    alter table public.cloud_snapshots
      add constraint cloud_snapshots_payload_bytes_check
      check (octet_length(payload_text) <= 67108864) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'cloud_snapshots_slug_length_check') then
    alter table public.cloud_snapshots
      add constraint cloud_snapshots_slug_length_check
      check (char_length(item_slug) <= 256) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'cloud_snapshots_title_length_check') then
    alter table public.cloud_snapshots
      add constraint cloud_snapshots_title_length_check
      check (char_length(item_title) <= 256) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'cloud_snapshots_metadata_bytes_check') then
    alter table public.cloud_snapshots
      add constraint cloud_snapshots_metadata_bytes_check
      check (octet_length(metadata::text) <= 65536) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'cloud_snapshots_size_bytes_check') then
    alter table public.cloud_snapshots
      add constraint cloud_snapshots_size_bytes_check
      check (size_bytes = octet_length(payload_text)) not valid;
  end if;
end
$$;
