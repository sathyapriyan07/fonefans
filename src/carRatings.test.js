import test from 'node:test';
import assert from 'node:assert/strict';
import { getCarOverall, getNearestCarYear, getTopCarRankings, rankCarsByAttribute } from './carRatings.js';

test('overall excludes missing ratings and returns null when none are rated', () => {
  assert.equal(getCarOverall({ speed: 90, race: null, qualifying: 70 }), 80);
  assert.equal(getCarOverall({ speed: null, race: '' }), null);
});

test('attribute rankings use competition ranks and include ties at the top-three cutoff', () => {
  const cars = [
    { id: 1, model: 'A', speed: 100 },
    { id: 2, model: 'B', speed: 90 },
    { id: 3, model: 'C', speed: 90 },
    { id: 4, model: 'D', speed: 80 },
    { id: 5, model: 'E', speed: null }
  ];
  assert.deepEqual(rankCarsByAttribute(cars, 'speed').map(item => [item.car.id, item.rank, item.tieCount]), [
    [1, 1, 1], [2, 2, 2], [3, 2, 2], [4, 4, 1]
  ]);
  assert.deepEqual(getTopCarRankings(cars, 'speed', 3).map(item => item.car.id), [1, 2, 3]);
});

test('empty car collections have no nearest season and populated collections select nearest year', () => {
  assert.equal(getNearestCarYear([], 2026), null);
  assert.equal(getNearestCarYear([{ year: 2022 }, { year: 2024 }, { year: 2028 }], 2025), 2024);
});
