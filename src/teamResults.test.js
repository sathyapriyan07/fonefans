import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTeamResultsBySeason, getTeamResultCoverage } from './teamResults.js';

const rows = [
  { grid_id: 1, race_id: 11, session_type: 'race', races: { year: 2022 } },
  { grid_id: 1, race_id: 11, session_type: 'sprint', races: { year: 2022 } },
  { grid_id: 1, race_id: 11, session_type: 'qualifying', races: { year: 2022 } },
  { grid_id: 2, race_id: 12, session_type: 'race', grids: { year: 2023 } },
  { grid_id: 3, race_id: 13, session_type: 'race', races: { year: 2024 } }
];

test('season selections filter all sessions using the related race year', () => {
  assert.equal(filterTeamResultsBySeason(rows, 'all'), rows);
  assert.deepEqual(filterTeamResultsBySeason(rows, '2022'), rows.slice(0, 3));
  assert.deepEqual(filterTeamResultsBySeason(rows, '2022-2023'), rows.slice(0, 4));
  assert.deepEqual(filterTeamResultsBySeason(rows, '2024-2022'), []);
});

test('coverage counts unique race and sprint weekends and reports filtered year bounds', () => {
  assert.deepEqual(getTeamResultCoverage(rows.slice(0, 3)), {
    raceCount: 1,
    sprintWeekendCount: 1,
    firstYear: 2022,
    lastYear: 2022
  });
  assert.deepEqual(getTeamResultCoverage([]), {
    raceCount: 0,
    sprintWeekendCount: 0,
    firstYear: null,
    lastYear: null
  });
});
