alter table public.races
  add column if not exists track_map jsonb not null default '{}'::jsonb;
