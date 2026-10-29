create table if not exists public.team_driver_lineups(
 team_id bigint not null references public.teams on delete cascade,
 year int not null,
 driver_1_id bigint references public.drivers on delete set null,
 driver_2_id bigint references public.drivers on delete set null,
 reserve_driver_id bigint references public.drivers on delete set null,
 primary key(team_id,year),
 check(driver_1_id is null or driver_2_id is null or driver_1_id<>driver_2_id),
 check(driver_1_id is null or reserve_driver_id is null or driver_1_id<>reserve_driver_id),
 check(driver_2_id is null or reserve_driver_id is null or driver_2_id<>reserve_driver_id)
);

alter table public.team_driver_lineups enable row level security;

do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='team_driver_lineups' and policyname='read') then
  create policy "read" on public.team_driver_lineups for select using (true);
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='team_driver_lineups' and policyname='admin') then
  create policy "admin" on public.team_driver_lineups for all to authenticated using (true) with check (true);
 end if;
end $$;

grant select on public.team_driver_lineups to anon,authenticated;
grant insert,update,delete on public.team_driver_lineups to authenticated;
