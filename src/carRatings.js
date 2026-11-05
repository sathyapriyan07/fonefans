export const CAR_STANDARD_ATTRIBUTES = [
  { key: 'speed', label: 'Speed' },
  { key: 'race', label: 'Race' },
  { key: 'overtaking', label: 'Overtaking' },
  { key: 'defence', label: 'Defence' },
  { key: 'performance', label: 'Performance' },
  { key: 'qualifying', label: 'Qualifying' },
  { key: 'reliability', label: 'Reliability' }
];

export const CAR_EXTRA_ATTRIBUTES = [
  { key: 'straight_line_speed', label: 'Straight line speed' },
  { key: 'aerodynamic_efficiency', label: 'Aerodynamic efficiency' },
  { key: 'high_speed_cornering', label: 'High speed cornering' },
  { key: 'medium_speed_cornering', label: 'Medium speed cornering' },
  { key: 'low_speed_cornering', label: 'Low speed cornering' },
  { key: 'downforce', label: 'Downforce' },
  { key: 'mechanical_grip', label: 'Mechanical grip' },
  { key: 'traction', label: 'Traction' },
  { key: 'braking', label: 'Braking' },
  { key: 'tyre_preservation', label: 'Tyre preservation' },
  { key: 'fuel_efficiency', label: 'Fuel efficiency' },
  { key: 'wet_performance', label: 'Wet performance' },
  { key: 'drs_effectiveness', label: 'DRS effectiveness' }
];

export const CAR_ATTRIBUTES = [...CAR_STANDARD_ATTRIBUTES, ...CAR_EXTRA_ATTRIBUTES];
export const CAR_OVERALL_ATTRIBUTES = CAR_STANDARD_ATTRIBUTES;

export function getCarAttributeValue(car, key) {
  const value = car?.[key];
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getCarOverall(car) {
  const values = CAR_OVERALL_ATTRIBUTES
    .map(({ key }) => getCarAttributeValue(car, key))
    .filter(value => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function getCarScore(car, key) {
  return key === 'overall' ? getCarOverall(car) : getCarAttributeValue(car, key);
}

export function rankCarsByAttribute(cars, key) {
  const scored = (cars || [])
    .map(car => ({ car, score: getCarScore(car, key) }))
    .filter(item => item.score !== null)
    .sort((a, b) => b.score - a.score
      || String(a.car.teams?.name || '').localeCompare(String(b.car.teams?.name || ''))
      || String(a.car.model || '').localeCompare(String(b.car.model || ''))
      || Number(a.car.id) - Number(b.car.id));

  const tieCounts = new Map();
  for (const { score } of scored) tieCounts.set(score, (tieCounts.get(score) || 0) + 1);
  let previousScore = null;
  let rank = 0;
  return scored.map((item, index) => {
    if (previousScore === null || item.score !== previousScore) rank = index + 1;
    previousScore = item.score;
    return { ...item, rank, tieCount: tieCounts.get(item.score) };
  });
}

export function getTopCarRankings(cars, key, limit = 3) {
  const ranked = rankCarsByAttribute(cars, key);
  const cutoff = ranked[limit - 1]?.rank;
  return cutoff === undefined ? ranked : ranked.filter(item => item.rank <= cutoff);
}

export function getNearestCarYear(cars, year) {
  const years = [...new Set((cars || [])
    .map(car => Number(car.year))
    .filter(Number.isInteger))];
  if (!years.length) return null;
  return years.sort((a, b) => Math.abs(a - year) - Math.abs(b - year) || b - a)[0];
}
