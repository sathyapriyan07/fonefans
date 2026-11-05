export function getTeamResultYear(row) {
  const year = Number(row?.races?.year || row?.grids?.year);
  return Number.isInteger(year) && year > 0 ? year : null;
}

export function filterTeamResultsBySeason(rows, season) {
  if (season === 'all' || !season) return rows;
  const range = /^(\d{4})-(\d{4})$/.exec(season);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start > end) return [];
    return rows.filter(row => {
      const year = getTeamResultYear(row);
      return year !== null && year >= start && year <= end;
    });
  }
  if (/^\d{4}$/.test(season)) {
    const selectedYear = Number(season);
    return rows.filter(row => getTeamResultYear(row) === selectedYear);
  }
  return rows;
}

export function getTeamResultCoverage(rows) {
  const weekendKeys = new Set();
  const sprintWeekendKeys = new Set();
  const years = [];
  for (const row of rows) {
    const key = `${row.grid_id}:${row.race_id}`;
    if (row.session_type === 'race') {
      weekendKeys.add(key);
      const year = getTeamResultYear(row);
      if (year !== null) years.push(year);
    } else if (row.session_type === 'sprint') {
      sprintWeekendKeys.add(key);
    }
  }
  return {
    raceCount: weekendKeys.size,
    sprintWeekendCount: sprintWeekendKeys.size,
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null
  };
}
