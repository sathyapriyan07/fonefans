import { createRaceState, advanceRaceLap, getClassification, qualify, VARIABILITY } from '../src/sim.js';

const RACES = 500;
const LAP_COUNT = 57;
const BASELINE = {
  topTenOverlap: 94.8,
  poleWins: 7,
  fastestCarWins: 5.6,
  safetyCarsPerRace: 0.99,
  dnfsPerRace: 0.31,
  positionChanges: 241.55,
  components: {
    driverSpread: { mean: -0.455, sd: 0.124 },
    carSpread: { mean: 0.331, sd: 0.463 },
    tyre: { mean: -0.100, sd: 0.089 },
    fuel: { mean: 1.423, sd: 0.834 },
    weather: { mean: 0.110, sd: 0 },
    traffic: { mean: 0.098, sd: 0.213 },
    executionSd: { mean: 0.061, sd: 0.018 }
  }
};
const circuit = {
  year: 2025,
  laps: LAP_COUNT,
  circuit_length_km: 5.2,
  straight_line_importance: 0.55,
  high_speed_corner_share: 0.34,
  medium_speed_corner_share: 0.34,
  low_speed_corner_share: 0.32,
  braking_demand: 0.52,
  traction_demand: 0.48,
  downforce_requirement: 0.5,
  tyre_energy: 0.5,
  overtaking_difficulty: 0.42,
  pit_lane_loss_seconds: 20,
  baseline_lap_seconds: 90,
  drs_zones: 2,
  tyre_wear_multiplier: 1
};

const entries = Array.from({ length: 20 }, (_, index) => {
  const teamIndex = Math.floor(index / 2);
  const teammateIndex = index % 2;
  const teamPace = 92 - teamIndex * 5.4;
  const driverPace = 56 + ((index * 17) % 35);
  const teamId = `team-${teamIndex + 1}`;
  const driverId = index + 1;
  return {
    driver: { id: driverId, name: `Driver ${String(driverId).padStart(2, '0')}` },
    team: { id: teamId, name: `Team ${teamIndex + 1}` },
    d: {
      speed: driverPace,
      race: driverPace,
      qualifying: Math.max(40, Math.min(98, driverPace + (teammateIndex ? -3 : 3))),
      experience: 55 + ((index * 11) % 36),
      consistency: 62 + ((index * 7) % 32),
      overtaking: 52 + ((index * 13) % 42),
      defence: 50 + ((index * 19) % 43),
      tyre_management: 52 + ((index * 5) % 43),
      wet_weather: 50 + ((index * 23) % 46),
      starts: 52 + ((index * 9) % 42),
      error_resistance: 55 + ((index * 3) % 42),
      adaptability: 55 + ((index * 17) % 40)
    },
    c: {
      speed: teamPace,
      race: teamPace,
      performance: teamPace,
      qualifying: teamPace,
      reliability: 87 + ((teamIndex * 7) % 13),
      straight_line_speed: teamPace,
      aerodynamic_efficiency: teamPace,
      high_speed_cornering: teamPace,
      medium_speed_cornering: teamPace,
      low_speed_cornering: teamPace,
      downforce: teamPace,
      mechanical_grip: teamPace,
      traction: teamPace,
      braking: teamPace,
      tyre_preservation: teamPace,
      fuel_efficiency: teamPace,
      wet_performance: teamPace,
      drs_effectiveness: teamPace
    }
  };
});

const teamById = new Map(entries.map(entry => [String(entry.team.id), entry.team.name]));
const driverStats = new Map(entries.map(entry => [String(entry.driver.id), {
  name: entry.driver.name,
  finishes: [],
  wins: 0
}]));
const teamStats = new Map([...teamById].map(([id, name]) => [id, { name, wins: 0 }]));
const topTenSets = [];
let poleWins = 0;
let fastestCarWins = 0;
let safetyCars = 0;
let racesWithSafetyCars = 0;
let dnfs = 0;
let positionChanges = 0;
let duplicatePositions = 0;
const componentSamples = {
  driverSpread: [],
  carSpread: [],
  tyre: [],
  fuel: [],
  weather: [],
  traffic: [],
  execution: [],
  stint: [],
  executionSd: []
};

for (let run = 0; run < RACES; run += 1) {
  const seed = `variance-after-${run}`;
  const qualifying = qualify(entries, {
    race: circuit,
    weather: 'dry',
    seed
  });
  const fastestCarTeam = entries.reduce((fastest, entry) =>
    entry.c.performance > fastest.c.performance ? entry : fastest
  ).team.id;
  const initial = createRaceState({
    entries: qualifying,
    race: circuit,
    format: 'race',
    weather: 'dry',
    strategies: {},
    seed
  });

  let state = initial;
  let raceHadSafetyCar = false;
  while (!state.done) {
    const previousPositions = new Map(state.cars.map(car => [String(car.driverId), car.position]));
    state = advanceRaceLap(state);
    const lapSafetyCars = state.events.filter(event => event.type === 'safety_car').length;
    safetyCars += lapSafetyCars;
    raceHadSafetyCar ||= lapSafetyCars > 0;
    for (const car of state.cars) {
      if (car.lapHistory.length === state.lap) {
        const rating = car.ratings;
        const lap = car.lapHistory.at(-1);
        componentSamples.tyre.push(lap.components.tyre);
        componentSamples.fuel.push(lap.components.fuel);
        componentSamples.weather.push(lap.components.weather);
        componentSamples.traffic.push(lap.components.traffic);
        componentSamples.execution.push(lap.components.execution);
        componentSamples.stint.push(lap.components.stint);
        componentSamples.executionSd.push(VARIABILITY.noise.raceLapSd * Math.max(VARIABILITY.noise.consistencyFloor, (101 - rating.driverConsistency) / 50));
        componentSamples.driverSpread.push(lap.components.driver);
        componentSamples.carSpread.push(lap.components.car);
      }
      if (previousPositions.get(String(car.driverId)) !== car.position) positionChanges += 1;
    }
  }

  const classification = getClassification(state);
  if (raceHadSafetyCar) racesWithSafetyCars += 1;
  if (new Set(classification.map(row => row.position)).size !== classification.length) duplicatePositions += 1;
  const winner = classification[0];
  if (!winner) continue;
  driverStats.get(String(winner.driver.id)).wins += 1;
  teamStats.get(String(winner.team.id)).wins += 1;
  dnfs += classification.filter(row => row.retired).length;
  if (String(winner.driver.id) === String(qualifying[0].driver.id)) poleWins += 1;
  if (String(winner.team.id) === String(fastestCarTeam)) fastestCarWins += 1;
  for (const row of classification) driverStats.get(String(row.driver.id)).finishes.push(row.position);
  topTenSets.push(new Set(classification.slice(0, 10).map(row => String(row.driver.id))));
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const stddev = values => {
  const center = mean(values);
  return Math.sqrt(mean(values.map(value => (value - center) ** 2)));
};
const averageTopTenOverlap = mean(topTenSets.slice(1).map((current, index) => {
  const previous = topTenSets[index];
  return [...current].filter(id => previous.has(id)).length / 10 * 100;
}));

console.log(`After-change variability report (${RACES} full weekends; ${entries.length} drivers; ${LAP_COUNT} laps)`);
console.log('\nDriver wins, mean finish, and finish-position standard deviation');
console.log('Driver       Wins %   Mean   Std dev');
for (const [id, stats] of driverStats) {
  console.log(`${stats.name.padEnd(12)} ${(stats.wins / RACES * 100).toFixed(1).padStart(6)}% ${mean(stats.finishes).toFixed(2).padStart(7)} ${stddev(stats.finishes).toFixed(2).padStart(9)}`);
}
console.log('\nTeam wins');
console.log('Team         Wins %');
for (const [id, stats] of teamStats) {
  console.log(`${stats.name.padEnd(12)} ${(stats.wins / RACES * 100).toFixed(1).padStart(6)}%`);
}
console.log('\nWeekend variability summary');
console.log('\nBefore / after summary');
console.log('Metric                  Before     After');
console.log(`Top-10 overlap          ${BASELINE.topTenOverlap.toFixed(1).padStart(6)}% ${averageTopTenOverlap.toFixed(1).padStart(8)}%`);
console.log(`Pole wins               ${BASELINE.poleWins.toFixed(1).padStart(6)}% ${(poleWins / RACES * 100).toFixed(1).padStart(8)}%`);
console.log(`Fastest-car wins        ${BASELINE.fastestCarWins.toFixed(1).padStart(6)}% ${(fastestCarWins / RACES * 100).toFixed(1).padStart(8)}%`);
console.log(`Safety cars / race      ${BASELINE.safetyCarsPerRace.toFixed(2).padStart(7)} ${(safetyCars / RACES).toFixed(2).padStart(8)}`);
console.log(`DNFs / race             ${BASELINE.dnfsPerRace.toFixed(2).padStart(7)} ${(dnfs / RACES).toFixed(2).padStart(8)}`);
console.log(`Position changes / race ${BASELINE.positionChanges.toFixed(2).padStart(7)} ${(positionChanges / RACES).toFixed(2).padStart(8)}`);
console.log(`Top-10 overlap with previous run: ${averageTopTenOverlap.toFixed(1)}%`);
console.log(`Races won from pole: ${(poleWins / RACES * 100).toFixed(1)}%`);
console.log(`Races won by fastest car: ${(fastestCarWins / RACES * 100).toFixed(1)}%`);
console.log(`Safety cars per race: ${(safetyCars / RACES).toFixed(2)}`);
console.log(`Races with a safety car: ${(racesWithSafetyCars / RACES * 100).toFixed(1)}%`);
console.log(`DNFs per race: ${(dnfs / RACES).toFixed(2)}`);
console.log(`Position changes per race: ${(positionChanges / RACES).toFixed(2)}`);
console.log(`Results with duplicate positions: ${duplicatePositions}`);

console.log('\nObserved pace components (mean contribution and between-car SD; seconds per lap)');
console.log('Component         Before mean   After mean   Before SD   After SD');
for (const [key, samples] of Object.entries(componentSamples)) {
  const baseline=BASELINE.components[key];
  const beforeMean=baseline?baseline.mean.toFixed(3):'n/a';
  const beforeSd=baseline?baseline.sd.toFixed(3):'n/a';
  console.log(`${key.padEnd(17)} ${beforeMean.padStart(11)} ${mean(samples).toFixed(3).padStart(11)} ${beforeSd.padStart(11)} ${stddev(samples).toFixed(3).padStart(10)}`);
}
const dominant=Object.entries(componentSamples).map(([name,samples])=>({name,sd:stddev(samples)})).sort((a,b)=>b.sd-a.sd)[0];
console.log(`Largest observed between-car spread: ${dominant.name} (${dominant.sd.toFixed(3)}s SD).`);
console.log('Note: driver/car values are signed pace deltas; tyre/fuel/weather/traffic are sampled race contributions; execution is modeled SD.');
const poleWinRate=poleWins/RACES*100;
const fastestCarWinRate=fastestCarWins/RACES*100;
if(poleWinRate<40||poleWinRate>55)throw new Error(`Pole-win target missed: ${poleWinRate.toFixed(1)}% (expected 40-55%).`);
if(fastestCarWinRate<35||fastestCarWinRate>50)throw new Error(`Fastest-car win target missed: ${fastestCarWinRate.toFixed(1)}% (expected 35-50%).`);
