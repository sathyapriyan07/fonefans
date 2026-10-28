alter table public.driver_ratings
  add column if not exists overall int,
  add column if not exists consistency int,
  add column if not exists tyre_management int,
  add column if not exists wet_weather int,
  add column if not exists starts int,
  add column if not exists braking int,
  add column if not exists error_resistance int,
  add column if not exists adaptability int,
  add column if not exists racecraft int;

alter table public.cars
  add column if not exists straight_line_speed int,
  add column if not exists aerodynamic_efficiency int,
  add column if not exists high_speed_cornering int,
  add column if not exists medium_speed_cornering int,
  add column if not exists low_speed_cornering int,
  add column if not exists downforce int,
  add column if not exists mechanical_grip int,
  add column if not exists traction int,
  add column if not exists braking int,
  add column if not exists tyre_preservation int,
  add column if not exists fuel_efficiency int,
  add column if not exists wet_performance int,
  add column if not exists drs_effectiveness int;

alter table public.teams
  add column if not exists pit_crew_execution int,
  add column if not exists strategy_quality int,
  add column if not exists reliability_management int,
  add column if not exists operational_consistency int,
  add column if not exists damage_repair_efficiency int;

alter table public.races
  add column if not exists circuit_length_km numeric,
  add column if not exists straight_line_importance numeric,
  add column if not exists high_speed_corner_share numeric,
  add column if not exists medium_speed_corner_share numeric,
  add column if not exists low_speed_corner_share numeric,
  add column if not exists braking_demand numeric,
  add column if not exists traction_demand numeric,
  add column if not exists downforce_requirement numeric,
  add column if not exists tyre_energy numeric,
  add column if not exists overtaking_difficulty numeric,
  add column if not exists pit_lane_loss_seconds numeric,
  add column if not exists baseline_lap_seconds numeric,
  add column if not exists drs_zones int,
  add column if not exists weekend_format text,
  add column if not exists sprint_affects_grand_prix_grid boolean;
