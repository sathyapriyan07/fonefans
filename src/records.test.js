import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordLeaderboards } from './records.js';

const drivers = {
  1: { id: 1, name: 'A Driver', driver_images: [
    { year: 2022, pole_url: '/older-portrait.png' },
    { year: 2024, card_url: '/latest-portrait.png' }
  ] },
  2: { id: 2, name: 'B Driver' },
  3: { id: 3, name: 'C Driver' },
  4: { id: 4, name: 'D Driver' }
};
const teams = { 1: { id: 1, name: 'Team One' }, 2: { id: 2, name: 'Team Two' } };
const row = (driverId, teamId, sessionType, position, overrides = {}) => ({
  grid_id: 1,
  race_id: 1,
  driver_id: driverId,
  team_id: teamId,
  session_type: sessionType,
  position,
  drivers: drivers[driverId],
  teams: teams[teamId],
  races: { year: 2024, circuit: 'Test Circuit' },
  ...overrides
});
const board = (records, key) => records.find(record => record.key === key).rows;

test('builds driver and team records from race and qualifying results', () => {
  const results = [
    row(1, 1, 'qualifying', 1),
    row(1, 1, 'race', 1),
    row(2, 1, 'race', 2)
  ];
  const records = buildRecordLeaderboards(results);
  assert.equal(board(records, 'driver-starts')[0].starts, 1);
  assert.equal(board(records, 'team-starts')[0].starts, 1);
  assert.equal(board(records, 'driver-wins')[0].wins, 1);
  assert.equal(board(records, 'team-wins')[0].wins, 1);
  assert.equal(board(records, 'driver-poles')[0].poles, 1);
  assert.equal(board(records, 'team-poles')[0].poles, 1);
  assert.equal(board(records, 'driver-podiums')[0].podiums, 1);
  assert.equal(board(records, 'team-podiums')[0].podiums, 2);
  assert.equal(board(records, 'teammate-races')[0].races, 1);
  assert.equal(board(records, 'driver-circuit-wins')[0].circuit, 'Test Circuit');
  assert.equal(board(records, 'driver-wins')[0].portrait, '/latest-portrait.png');
  assert.equal(board(records, 'team-circuit-wins')[0].wins, 1);
});

test('counts teammate weekends and excludes retired podiums', () => {
  const results = [
    row(1, 1, 'race', 2),
    row(2, 1, 'race', 3, { retired: true, status: 'Retired' }),
    row(1, 1, 'race', 2, { race_id: 2 }),
    row(2, 1, 'race', 4, { race_id: 2 }),
    row(3, 2, 'race', 2, { race_id: 2 }),
    row(4, 2, 'race', 4, { race_id: 2 })
  ];
  const records = buildRecordLeaderboards(results);
  assert.equal(board(records, 'teammate-races')[0].races, 2);
  assert.equal(board(records, 'teammate-races')[1].races, 1);
  assert.equal(board(records, 'driver-podiums').reduce((total, item) => total + item.podiums, 0), 3);
});

test('counts only championships from fully completed scheduled seasons', () => {
  const results = [
    row(1, 1, 'race', 1, { race_id: 1, races: { year: 2024, circuit: 'A' } }),
    row(2, 2, 'race', 2, { race_id: 1, races: { year: 2024, circuit: 'A' } }),
    row(1, 1, 'race', 2, { race_id: 2, races: { year: 2024, circuit: 'B' } }),
    row(2, 2, 'race', 1, { race_id: 2, races: { year: 2024, circuit: 'B' } })
  ];
  const seasonResults = results.map(result => ({ ...result, points: result.position === 1 ? 25 : 18 }));
  const records = buildRecordLeaderboards(results, {
    calendar: [{ id: 1, year: 2024, round: 1 }, { id: 2, year: 2024, round: 2 }],
    results: seasonResults
  });
  assert.equal(board(records, 'driver-championships')[0].name, 'A Driver');
  assert.equal(board(records, 'driver-championships')[0].championships, 1);
  assert.equal(board(records, 'team-championships')[0].name, 'Team One');

  const incomplete = buildRecordLeaderboards(results.slice(0, 2), {
    calendar: [{ id: 1, year: 2024, round: 1 }, { id: 2, year: 2024, round: 2 }],
    results: seasonResults.slice(0, 2)
  });
  assert.equal(board(incomplete, 'driver-championships').length, 0);
});
