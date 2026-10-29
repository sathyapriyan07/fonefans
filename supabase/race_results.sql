create table if not exists public.race_results(
 grid_id bigint not null references public.grids on delete cascade,
 race_id bigint not null references public.races on delete cascade,
 driver_id bigint not null references public.drivers on delete cascade,
 team_id bigint not null references public.teams on delete cascade,
 session_type text not null check(session_type in ('sprint','race')),
 position int not null check(position>0),
 points numeric not null default 0,
 status text not null,
 laps_completed int not null default 0,
 total_time numeric,
 best_lap numeric,
 result jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(grid_id,race_id,session_type,driver_id)
);

alter table public.race_results
 drop constraint if exists race_results_session_type_check;
alter table public.race_results
 add constraint race_results_session_type_check
 check(session_type in ('practice1','practice2','practice3','sprintQualifying','sprint','qualifying','race'));

alter table public.race_results
 add column if not exists pole_position boolean not null default false,
 add column if not exists sprint_pole boolean not null default false,
 add column if not exists race_win boolean not null default false,
 add column if not exists sprint_win boolean not null default false,
 add column if not exists fastest_lap boolean not null default false,
 add column if not exists grand_slam boolean not null default false,
 add column if not exists retired boolean not null default false;

create index if not exists race_results_driver_history_idx
 on public.race_results(driver_id,race_id);
create index if not exists race_results_team_history_idx
 on public.race_results(team_id,race_id);

alter table public.race_results enable row level security;
drop policy if exists "read" on public.race_results;
create policy "read" on public.race_results for select using (true);
drop policy if exists "admin" on public.race_results;
create policy "admin" on public.race_results for all to authenticated using (true) with check (true);

grant select on public.race_results to anon,authenticated;
grant insert,update,delete on public.race_results to authenticated;
