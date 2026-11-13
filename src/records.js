import { calculateStandings } from './sim.js';

function makeStats(id, subject) {
  const images = Array.isArray(subject?.driver_images) ? subject.driver_images : [];
  const latestImage = [...images].sort((a, b) => Number(b.year) - Number(a.year))
    .find(image => image.pole_url || image.card_url || image.grid_url);
  return {
    id,
    name: subject?.name || 'Unknown',
    logo: subject?.logo_normal || '',
    portrait: latestImage?.pole_url || latestImage?.card_url || latestImage?.grid_url || '',
    color: subject?.color || '',
    starts: new Set(),
    wins: 0,
    poles: 0,
    podiums: 0,
    championships: 0
  };
}

function getStats(collection, id, subject) {
  if (id === null || id === undefined) return null;
  const key = String(id);
  if (!collection.has(key)) collection.set(key, makeStats(id, subject));
  const stats = collection.get(key);
  if (subject?.name) stats.name = subject.name;
  if (subject?.logo_normal) stats.logo = subject.logo_normal;
  if (subject?.color) stats.color = subject.color;
  if (Array.isArray(subject?.driver_images)) {
    const images = [...subject.driver_images].sort((a, b) => Number(b.year) - Number(a.year));
    const latestImage = images.find(image => image.pole_url || image.card_url || image.grid_url);
    if (latestImage) stats.portrait = latestImage.pole_url || latestImage.card_url || latestImage.grid_url;
  }
  return stats;
}

function ranked(rows, metric) {
  return [...rows]
    .filter(row => row[metric] > 0)
    .sort((a, b) => {
      const byMetric = b[metric] - a[metric];
      if (byMetric) return byMetric;
      const aName = a.name || `${a.firstName || ''} ${a.secondName || ''}`.trim();
      const bName = b.name || `${b.firstName || ''} ${b.secondName || ''}`.trim();
      return aName.localeCompare(bName);
    });
}

function championshipStats(results, seasonResults, calendar, drivers, teams) {
  const gridYears = new Map();
  for (const row of results) {
    if (row.session_type !== 'race' || row.grid_id == null) continue;
    const year = Number(row.races?.year ?? row.grids?.year);
    if (Number.isFinite(year)) gridYears.set(String(row.grid_id), year);
  }
  const racesByYear = new Map();
  for (const race of calendar) {
    const year = Number(race.year);
    if (!Number.isFinite(year)) continue;
    const races = racesByYear.get(year) || [];
    races.push(race);
    racesByYear.set(year, races);
  }

  for (const [gridId, year] of gridYears) {
    const scheduledRaces = racesByYear.get(year) || [];
    if (!scheduledRaces.length) continue;
    const raceIds = new Set(scheduledRaces.map(race => String(race.id)));
    const gridRows = seasonResults.filter(row =>
      String(row.grid_id) === gridId && raceIds.has(String(row.race_id))
    );
    const completedRaceIds = new Set(
      gridRows.filter(row => row.session_type === 'race').map(row => String(row.race_id))
    );
    if (!scheduledRaces.every(race => completedRaceIds.has(String(race.id)))) continue;

    const completedRaces = [...scheduledRaces]
      .sort((a, b) => (Number(a.round) || 0) - (Number(b.round) || 0))
      .map(race => {
        const rows = gridRows.filter(row => String(row.race_id) === String(race.id));
        const normalize = row => ({
          driver: row.drivers || { id: row.driver_id },
          team: row.teams || { id: row.team_id },
          position: row.position,
          points: row.points
        });
        return {
          round: race.round,
          raceResults: rows.filter(row => row.session_type === 'race').map(normalize),
          sprintResults: rows.filter(row => row.session_type === 'sprint').map(normalize)
        };
      });
    const standings = calculateStandings(completedRaces);
    const driverChampion = standings.drivers[0];
    const teamChampion = standings.teams[0];
    if (driverChampion) getStats(drivers, driverChampion.id, driverChampion).championships += 1;
    if (teamChampion) getStats(teams, teamChampion.id, teamChampion).championships += 1;
  }
}

export function buildRecordLeaderboards(results = [], championshipData = {}) {
  const drivers = new Map();
  const teams = new Map();
  const teammatePairs = new Map();
  const circuitWins = new Map();
  const raceRowsByWeekend = new Map();
  const circuitRecord = (entity, row) => {
    const circuit = row.races?.circuit?.trim();
    if (!circuit || !row.race_id || row.grid_id == null) return;
    const id = entity === 'driver' ? row.driver_id : row.team_id;
    const subject = entity === 'driver' ? row.drivers : row.teams;
    if (id === null || id === undefined) return;
    const driverImages = Array.isArray(subject?.driver_images) ? [...subject.driver_images] : [];
    driverImages.sort((a, b) => Number(b.year) - Number(a.year));
    const latestImage = driverImages.find(image => image.pole_url || image.card_url || image.grid_url);
    const key = `${entity}:${id}:${circuit}`;
    const record = circuitWins.get(key) || {
      id, name: subject?.name || 'Unknown', circuit, entity,
      logo: subject?.logo_normal || '',
      portrait: latestImage?.pole_url || latestImage?.card_url || latestImage?.grid_url || '',
      color: subject?.color || '',
      wins: 0
    };
    record.wins += 1;
    circuitWins.set(key, record);
  };

  for (const row of results) {
    const driver = getStats(drivers, row.driver_id, row.drivers);
    const team = getStats(teams, row.team_id, row.teams);
    if (row.session_type === 'race') {
      const event = `${row.grid_id}:${row.race_id}`;
      if (driver) driver.starts.add(event);
      if (team) team.starts.add(event);
      const weekendRows = raceRowsByWeekend.get(event) || [];
      weekendRows.push(row);
      raceRowsByWeekend.set(event, weekendRows);
      const position = Number(row.position);
      const retired = row.retired || row.status === 'Retired';
      const won = row.race_win || position === 1;
      if (won) {
        if (driver) driver.wins += 1;
        if (team) team.wins += 1;
        circuitRecord('driver', row);
        circuitRecord('team', row);
      }
      if (!retired && position >= 1 && position <= 3) {
        if (driver) driver.podiums += 1;
        if (team) team.podiums += 1;
      }
    } else if (row.session_type === 'qualifying'
      && (row.pole_position || Number(row.position) === 1)) {
      if (driver) driver.poles += 1;
      if (team) team.poles += 1;
    }
  }

  for (const rows of raceRowsByWeekend.values()) {
    const byTeam = new Map();
    for (const row of rows) {
      if (row.team_id === null || row.team_id === undefined || row.driver_id === null || row.driver_id === undefined) continue;
      const teamKey = String(row.team_id);
      const teamDrivers = byTeam.get(teamKey) || new Map();
      teamDrivers.set(String(row.driver_id), row.drivers?.name || `Driver #${row.driver_id}`);
      byTeam.set(teamKey, teamDrivers);
    }
    for (const teamDrivers of byTeam.values()) {
      const members = [...teamDrivers.entries()].sort((a, b) => a[1].localeCompare(b[1]));
      for (let first = 0; first < members.length; first += 1) {
        for (let second = first + 1; second < members.length; second += 1) {
          const [firstId, firstName] = members[first];
          const [secondId, secondName] = members[second];
          const key = `${firstId}:${secondId}`;
          const pair = teammatePairs.get(key) || {
            firstId, firstName, secondId, secondName, races: 0
          };
          pair.races += 1;
          teammatePairs.set(key, pair);
        }
      }
    }
  }

  championshipStats(
    results,
    championshipData.results || [],
    championshipData.calendar || [],
    drivers,
    teams
  );

  const finalize = collection => [...collection.values()].map(stats => ({
    ...stats,
    starts: stats.starts.size
  }));
  const driverRows = finalize(drivers);
  const teamRows = finalize(teams);
  for (const pair of teammatePairs.values()) {
    pair.firstPortrait = drivers.get(String(pair.firstId))?.portrait || '';
    pair.secondPortrait = drivers.get(String(pair.secondId))?.portrait || '';
  }
  const metricBoard = (rows, metric) => ranked(rows, metric).slice(0, 10);
  const circuitBoard = entity => [...circuitWins.values()]
    .filter(row => row.entity === entity)
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name) || a.circuit.localeCompare(b.circuit))
    .slice(0, 10);

  return [
    { key: 'driver-starts', title: 'Most race starts', entity: 'Driver', rows: metricBoard(driverRows, 'starts'), metric: 'starts' },
    { key: 'team-starts', title: 'Most race starts', entity: 'Team', rows: metricBoard(teamRows, 'starts'), metric: 'starts' },
    { key: 'driver-wins', title: 'Most wins', entity: 'Driver', rows: metricBoard(driverRows, 'wins'), metric: 'wins' },
    { key: 'team-wins', title: 'Most wins', entity: 'Team', rows: metricBoard(teamRows, 'wins'), metric: 'wins' },
    { key: 'driver-poles', title: 'Most poles', entity: 'Driver', rows: metricBoard(driverRows, 'poles'), metric: 'poles' },
    { key: 'team-poles', title: 'Most poles', entity: 'Team', rows: metricBoard(teamRows, 'poles'), metric: 'poles' },
    { key: 'driver-podiums', title: 'Most podiums', entity: 'Driver', rows: metricBoard(driverRows, 'podiums'), metric: 'podiums' },
    { key: 'team-podiums', title: 'Most podiums', entity: 'Team', rows: metricBoard(teamRows, 'podiums'), metric: 'podiums' },
    { key: 'teammate-races', title: 'Most races as teammates', entity: 'Teammates', rows: ranked([...teammatePairs.values()], 'races').slice(0, 10), metric: 'races' },
    { key: 'driver-circuit-wins', title: 'Most wins at a circuit', entity: 'Driver', rows: circuitBoard('driver'), metric: 'wins' },
    { key: 'team-circuit-wins', title: 'Most wins at a circuit', entity: 'Team', rows: circuitBoard('team'), metric: 'wins' },
    { key: 'driver-championships', title: 'Most championships', entity: 'Driver', rows: metricBoard(driverRows, 'championships'), metric: 'championships' },
    { key: 'team-championships', title: 'Most championships', entity: 'Team', rows: metricBoard(teamRows, 'championships'), metric: 'championships' }
  ];
}
