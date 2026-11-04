import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDriverName, splitDriverName } from './driverName.js';

test('formats only the driver surname in uppercase', () => {
  assert.equal(formatDriverName('Lando Norris'), 'Lando NORRIS');
});

test('keeps a multi-part surname together and uppercases it', () => {
  assert.deepEqual(splitDriverName('Fernando Alonso Díaz'), ['Fernando', 'Alonso Díaz']);
  assert.equal(formatDriverName('Fernando Alonso Díaz'), 'Fernando ALONSO DÍAZ');
});

test('leaves a single-part name unchanged', () => {
  assert.equal(formatDriverName('Senna'), 'Senna');
  assert.equal(formatDriverName(''), '');
});
