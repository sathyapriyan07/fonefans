create table drivers(id bigserial primary key,name text not null,code text,number int,bio text,nationality text,nationality_logo text,jolpica_id text unique);
create table driver_images(id bigserial primary key,driver_id bigint references drivers on delete cascade,year int not null,pole_url text,grid_url text,card_url text,unique(driver_id,year));
create table driver_ratings(id bigserial primary key,driver_id bigint unique references drivers on delete cascade,race int default 50,overtaking int default 50,speed int default 50,experience int default 50,qualifying int default 50,defence int default 50);
create table teams(id bigserial primary key,name text not null,logo_detailed text,logo_normal text,color text default '#d3202f',jolpica_id text unique);
create table cars(id bigserial primary key,team_id bigint references teams on delete cascade,year int not null,model text not null,image_url text,engine text,speed int default 50,race int default 50,overtaking int default 50,defence int default 50,performance int default 50,qualifying int default 50,reliability int default 50);
create table grids(id bigserial primary key,name text not null,year int not null);
create table grid_entries(id bigserial primary key,grid_id bigint references grids on delete cascade,team_id bigint references teams,car_id bigint references cars,driver_id bigint references drivers,unique(grid_id,driver_id));
create table races(id bigserial primary key,year int not null,round int,name text not null,circuit text,country text,date date,is_sprint bool default false,laps int default 57,unique(year,round));
do $$ declare t text; begin foreach t in array array['drivers','driver_images','driver_ratings','teams','cars','grids','grid_entries','races'] loop
execute format('alter table %I enable row level security',t);
execute format('create policy "read" on %I for select using (true)',t);
execute format('create policy "admin" on %I for all to authenticated using (true) with check (true)',t); end loop; end $$;
-- Create your admin user in Supabase > Authentication > Users. Any signed-in user can write.
grant select on public.drivers,public.driver_images,public.driver_ratings,public.teams,public.cars,public.grids,public.grid_entries,public.races to anon,authenticated;
grant insert,update,delete on public.drivers,public.driver_images,public.driver_ratings,public.teams,public.cars,public.grids,public.grid_entries,public.races to authenticated;
grant usage,select on sequence public.drivers_id_seq,public.driver_images_id_seq,public.driver_ratings_id_seq,public.teams_id_seq,public.cars_id_seq,public.grids_id_seq,public.grid_entries_id_seq,public.races_id_seq to authenticated;
