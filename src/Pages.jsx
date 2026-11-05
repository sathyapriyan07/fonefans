import { useEffect, useMemo, useRef, useState } from 'react'; import { Link, useParams, useSearchParams } from 'react-router-dom';
import { sb } from './supabase.js'; import { activateDriverBoost, advanceRaceIfRunning, advanceRaceLap, applyDriverPerformanceBoosts, applyPracticeSubstitutions, applyTeamPerformanceBoosts, calculateStandings, calculateTeammateHeadToHead, createRaceState, getBestCareerPositions, getCareerChampionships, getCareerRecords, getCareerStats, getClassification, getTeamCareerStats, getWeekendAwards, getWeekendPhases, practice, requiresMandatoryDryTyreCompounds, setPitInstruction, setTeamRaceAdjustments, simulateQualifyingWeekend } from './sim.js';
import './liveTiming.css';
import { CAR_ATTRIBUTES, CAR_OVERALL_ATTRIBUTES, getCarOverall, getCarScore, getNearestCarYear, rankCarsByAttribute } from './carRatings.js';
import { filterTeamResultsBySeason, getTeamResultCoverage, getTeamResultYear } from './teamResults.js';
function useQ(fn, deps = []) {
  const [query, setQuery] = useState({ data: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setQuery({ data: null, loading: true, error: null });
    Promise.resolve().then(fn).then(result => {
      const isQueryResult = result && typeof result === 'object' && 'data' in result;
      const error = isQueryResult ? result.error : null;
      if (error) throw error;
      if (active) setQuery({ data: isQueryResult ? result.data : result, loading: false, error: null });
    }).catch(error => {
      console.error('Page data failed to load:', error);
      if (active) setQuery({ data: null, loading: false, error });
    });
    return () => { active = false };
  }, [attempt, ...deps]);
  return { ...query, retry: () => setAttempt(value => value + 1) };
}
function QueryStatus({ query, empty }) {
  if (query.loading) return <p className="query-status" role="status">Loading…</p>;
  if (query.error) return <div className="query-status query-error" role="alert"><span>Could not load this page: {query.error.message || String(query.error)}</span><button onClick={query.retry}>Try again</button></div>;
  if (empty && Array.isArray(query.data) && query.data.length === 0) return <p className="query-status">{empty}</p>;
  return null;
}
const Bar = ({ l, v }) => <div className="bar"><span>{l}</span><i><b style={{ width: (v ?? 0) + '%' }} /></i><em>{v ?? '–'}</em></div>;
const PHASE_LABELS = { practice1: 'Practice 1', practice2: 'Practice 2', practice3: 'Practice 3', sprintQualifying: 'Sprint Qualifying', sprint: 'Sprint', qualifying: 'Qualifying', race: 'Grand Prix' };
const sessionLabel = session => PHASE_LABELS[session] || session;
const newQualifyingSeed = () => {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(values)[0];
  return `${Date.now()}:qualifying`;
};
const qualifyingClock = seconds => {
  const remaining = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
};
async function loadTeammateResultRows(driverIds) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('race_results')
      .select('grid_id,race_id,driver_id,team_id,session_type,position,points,races(year),grids(year)')
      .in('driver_id', driverIds)
      .order('grid_id').order('race_id').order('session_type').order('driver_id')
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}
async function loadSavedRaceResults() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('race_results')
      .select('grid_id,race_id,driver_id,team_id,session_type,position,points,status,laps_completed,total_time,best_lap,pole_position,sprint_pole,race_win,sprint_win,fastest_lap,grand_slam,retired,result,races(year,round,name,circuit),grids(year),drivers(id,name,code,number,driver_images(year,grid_url)),teams(id,name,logo_normal,color)')
      .order('race_id', { ascending: false }).order('grid_id').order('session_type').order('position').order('driver_id')
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}
async function loadCareerChampionshipData(driverResults) {
  const gridIds = [...new Set(driverResults
    .filter(row => row.session_type === 'race' && row.grid_id != null)
    .map(row => String(row.grid_id)))];
  const years = [...new Set(driverResults
    .filter(row => row.session_type === 'race')
    .map(row => Number(row.races?.year ?? row.grids?.year))
    .filter(Number.isFinite))];
  if (!gridIds.length || !years.length) return { calendar: [], results: [] };
  const { data: calendar, error: calendarError } = await sb.from('races')
    .select('id,year,round')
    .in('year', years);
  if (calendarError) throw calendarError;
  const results = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('race_results')
      .select('grid_id,race_id,driver_id,team_id,session_type,position,points,drivers(id,name,code),teams(id,name,logo_normal,color)')
      .in('grid_id', gridIds)
      .in('session_type', ['race', 'sprint'])
      .order('grid_id').order('race_id').order('session_type').order('position')
      .range(offset, offset + 999);
    if (error) throw error;
    results.push(...(data || []));
    if (!data || data.length < 1000) return { calendar: calendar || [], results };
  }
}
async function loadSeasonResults(gridId) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('race_results')
      .select('grid_id,race_id,session_type,position,points,pole_position,drivers(id,name,code),teams(id,name,logo_normal,color),races(round,name)')
      .eq('grid_id', gridId)
      .order('race_id').order('session_type').order('position').order('driver_id')
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}
function buildResultRecords(grid, race, sessionType, rows, awards) {
  return rows.map(row => {
    const position = Number(row.practicePos ?? row.position ?? row.grid ?? row.pos);
    const retired = Boolean(row.retired || row.status === 'Retired');
    const fastestLap = String(row.driver.id) === String(sessionType === 'sprint' ? awards.sprintFastestLapDriverId : awards.fastestLapDriverId);
    const achievement = {
      pole_position: sessionType === 'qualifying' && String(row.driver.id) === String(awards.poleDriverId),
      sprint_pole: sessionType === 'sprintQualifying' && String(row.driver.id) === String(awards.sprintPoleDriverId),
      race_win: sessionType === 'race' && String(row.driver.id) === String(awards.raceWinnerId),
      sprint_win: sessionType === 'sprint' && String(row.driver.id) === String(awards.sprintWinnerId),
      fastest_lap: (sessionType === 'race' || sessionType === 'sprint') && fastestLap,
      grand_slam: sessionType === 'race' && String(row.driver.id) === String(awards.grandSlamDriverId),
      retired
    };
    const status = row.status || (retired ? 'Retired' : row.sessionStatus || 'Complete');
    return {
      grid_id: grid.id, race_id: race.id, driver_id: row.driver.id, team_id: row.team.id,
      session_type: sessionType, position, points: row.pts || 0, status,
      laps_completed: row.lapsCompleted || row.lapCount || 0,
      total_time: Number.isFinite(row.totalTime) ? row.totalTime : null,
      best_lap: Number.isFinite(row.bestLap) ? row.bestLap : null,
      ...achievement, updated_at: new Date().toISOString(),
      result: {
        sessionType, sessionLabel: sessionLabel(sessionType),
        driver: { id: row.driver.id, name: row.driver.name, code: row.driver.code, number: row.driver.number },
        team: { id: row.team.id, name: row.team.name, logo_normal: row.team.logo_normal, color: row.team.color },
        car: { model: row.cars?.model || row.c?.model || '' }, position, gridPosition: row.gridPosition ?? row.grid,
        points: row.pts || 0, status, retired, lapsCompleted: row.lapsCompleted || row.lapCount || 0,
        totalTime: Number.isFinite(row.totalTime) ? row.totalTime : null, bestLap: Number.isFinite(row.bestLap) ? row.bestLap : null,
        lastLap: Number.isFinite(row.lastLap) ? row.lastLap : null, sectors: row.sectors || [], pitStops: row.pitStops || 0, pitHistory: row.pitHistory || [],
        lapHistory: row.lapHistory || [], penalties: row.penalties || [], events: row.events || [], substituteFor: row.substituteFor || null,
        awards: achievement
      }
    };
  });
}
const resultAwards = row => [
  row.pole_position && 'Pole',
  row.sprint_pole && 'Sprint pole',
  row.race_win && 'Win',
  row.sprint_win && 'Sprint win',
  row.fastest_lap && 'Fastest lap',
  row.grand_slam && 'Grand Slam'
].filter(Boolean);
const latestImg = (d, k) => [...(d.driver_images || [])].sort((a, b) => b.year - a.year)[0]?.[k];
const driverSeasonImage = (driver, year) => {
  const images = driver.driver_images || [];
  const image = images.find(item => Number(item.year) === Number(year)) || [...images].sort((a, b) => b.year - a.year)[0];
  return image?.card_url || image?.pole_url || image?.grid_url;
};
const driverGridImage = (driver, year) => {
  const images = driver?.driver_images || [];
  const image = images.find(item => Number(item.year) === Number(year) && item.grid_url) || [...images].filter(item => item.grid_url).sort((a, b) => b.year - a.year)[0];
  return image?.grid_url;
};
function SessionPodium({ entries, race, phaseLabel, fastestLap = Infinity, raceResult = false }) {
  const podium = raceResult ? entries.filter(entry => !entry.retired).slice(0, 3) : entries.slice(0, 3);
  const leader = entries.find(entry => Number(entry.position ?? entry.pos) === 1) || podium[0];
  if (!podium.length) return null;
  return <section className="practice-podium" aria-label={`${phaseLabel} top three`}>
    <div className="practice-podium-heading"><h4>{race?.name || 'Race'} · {phaseLabel} top three</h4></div>
    <div className="practice-podium-grid">{podium.map((entry, index) => {
      const reportedPosition = Number(entry.position ?? entry.practicePos ?? entry.grid ?? entry.pos);
      const position = Number.isInteger(reportedPosition) && reportedPosition > 0 ? reportedPosition : index + 1;
      let gap;
      if (raceResult) gap = position === 1 ? 'WINNER' : entry.lapsCompleted < leader.lapsCompleted ? `+${leader.lapsCompleted - entry.lapsCompleted} LAP` : `+${(entry.totalTime - leader.totalTime).toFixed(3)}`;
      else gap = Number.isFinite(entry.bestLap) && Number.isFinite(fastestLap) ? `+${(entry.bestLap - fastestLap).toFixed(3)}` : '—';
      const portrait = driverSeasonImage(entry.driver, race?.year);
      return <article className={`practice-podium-card practice-podium-${index + 1}`} key={entry.driver.id} style={{ '--team-color': entry.team.color || '#d3202f' }}>
        <div className="practice-podium-portrait">{portrait ? <img src={portrait} alt={`${entry.driver.name} portrait`} /> : <span className={entry.driver.code ? 'driver-code' : undefined}>{entry.driver.code || entry.driver.name.trim().split(/\s+/).pop()?.slice(0, 1)}</span>}<strong className="practice-podium-position">P{position}</strong></div>
        <div className="practice-podium-details"><span className="practice-podium-team">{entry.team.logo_normal && <img src={entry.team.logo_normal} alt="" />}{entry.team.name}</span><strong className="practice-podium-driver">{entry.driver.name.toUpperCase()}</strong><span className="practice-podium-gap">{gap}</span></div>
      </article>;
    })}</div>
  </section>;
}
const CAR = CAR_OVERALL_ATTRIBUTES.map(attribute => attribute.key);
const one = x => Array.isArray(x) ? x[0] : x;
export function Home() {
  const n = useQ(async () => { const c = async t => { const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true }); if (error) throw error; return count }; const [drivers, teams, races] = await Promise.all([c('drivers'), c('teams'), c('races')]); return { drivers, teams, races } });
  return <section className="hero"><h1>Build the grid. Run the season.</h1><p>Set up your cars, manage race strategy, and take your custom grid through a full race weekend.</p>
    <div className="row"><Link className="btn" to="/simulate">Start a race weekend</Link><Link className="btn ghost" to="/grids">Build a grid</Link></div>
    {n.data && <p className="muted">{n.data.drivers} drivers, {n.data.teams} teams, {n.data.races} races loaded</p>}<QueryStatus query={n} /></section>
}
export function Drivers() {
  const [driverTab, setDriverTab] = useState('current');
  const currentSeason = new Date().getFullYear();
  const d = useQ(() => sb.from('drivers').select('*,driver_images(*)').order('name'));
  const lineups = useQ(() => sb.from('team_driver_lineups')
    .select('driver_1_id,driver_2_id,reserve_driver_id')
    .eq('year', currentSeason));
  const currentDriverIds = new Set((lineups.data || [])
    .flatMap(lineup => [lineup.driver_1_id, lineup.driver_2_id, lineup.reserve_driver_id])
    .filter(id => id !== null && id !== undefined)
    .map(String));
  const currentDrivers = (d.data || []).filter(driver => currentDriverIds.has(String(driver.id)));
  const pastDrivers = (d.data || []).filter(driver => !currentDriverIds.has(String(driver.id)));
  const selectedDrivers = driverTab === 'current' ? currentDrivers : pastDrivers;
  return <><h2>Drivers</h2>
    <QueryStatus query={d} empty="No drivers yet." />
    <QueryStatus query={lineups} />
    <div className="driver-season-tabs" role="tablist" aria-label="Driver seasons">
      <button type="button" role="tab" id="current-drivers-tab" aria-controls="current-drivers-panel"
        aria-selected={driverTab === 'current'} className={driverTab === 'current' ? 'active' : ''}
        onClick={() => setDriverTab('current')}>Current season{lineups.data ? ` (${currentDrivers.length})` : ''}</button>
      <button type="button" role="tab" id="past-drivers-tab" aria-controls="past-drivers-panel"
        aria-selected={driverTab === 'past'} className={driverTab === 'past' ? 'active' : ''}
        onClick={() => setDriverTab('past')}>Past drivers{lineups.data ? ` (${pastDrivers.length})` : ''}</button>
    </div>
    <section role="tabpanel" id={driverTab === 'current' ? 'current-drivers-panel' : 'past-drivers-panel'}
      aria-labelledby={driverTab === 'current' ? 'current-drivers-tab' : 'past-drivers-tab'}>
      {d.data && lineups.data && (selectedDrivers.length
        ? <div className="grid driver-grid">{selectedDrivers.map(x => {
          const image = driverGridImage(x);
          return <Link key={x.id} to={'/drivers/' + x.id} className={`card driver-card${image ? ' has-image' : ''}`}>{image && <img className="driver-pole-image" src={image} alt="" aria-hidden="true" />}<div className="driver-card-copy"><h3>{x.name}</h3><p><span className="driver-code">{x.code}</span> #{x.number}</p></div></Link>;
        })}</div>
        : <p className="query-status">{driverTab === 'current' ? `No drivers assigned for ${currentSeason}.` : 'No past drivers.'}</p>)}
    </section>
  </>
}
export function Driver() {
  const { id } = useParams(); const d = useQ(() => sb.from('drivers').select('*,driver_images(*),driver_ratings(*)').eq('id', id).single(), [id]);
  const lineups = useQ(() => sb.from('team_driver_lineups').select('*,teams(id,name,logo_normal,color)').or(`driver_1_id.eq.${id},driver_2_id.eq.${id},reserve_driver_id.eq.${id}`).order('year', { ascending: false }), [id]);
  const raceResults = useQ(() => sb.from('race_results').select('grid_id,race_id,session_type,position,points,status,laps_completed,total_time,best_lap,result,pole_position,sprint_pole,race_win,sprint_win,fastest_lap,grand_slam,retired,races(year,round,name),grids(year),teams(id,name,logo_normal,color)').eq('driver_id', id), [id]);
  const championshipResults = useQ(() => loadCareerChampionshipData(raceResults.data || []), [id, raceResults.data]);
  const teammateIds = [...new Set((lineups.data || []).flatMap(lineup => ['driver_1_id', 'driver_2_id', 'reserve_driver_id'].map(slot => lineup[slot]).filter(teammateId => teammateId !== null && teammateId !== undefined && String(teammateId) !== String(id))).map(String))];
  const teammateKey = teammateIds.slice().sort().join(',');
  const headToHeadResults = useQ(() => teammateIds.length ? loadTeammateResultRows([id, ...teammateIds]) : Promise.resolve([]), [id, teammateKey]);
  const rosterDrivers = useQ(() => sb.from('drivers').select('id,name,code,number,driver_images(card_url,year)').order('name'));
  if (d.loading || d.error || !d.data) return <><h2>Driver</h2><QueryStatus query={d} /></>;
  const driver = d.data; const r = one(driver.driver_ratings) || {};
  const images = [...(driver.driver_images || [])].sort((a, b) => b.year - a.year);
  const heroImage = latestImg(driver, 'card_url') || latestImg(driver, 'pole_url');
  const years = [...new Set(images.map(image => image.year))];
  const driverById = new Map((rosterDrivers.data || []).map(rosterDriver => [String(rosterDriver.id), rosterDriver]));
  const teammateHeadToHead = calculateTeammateHeadToHead(id, lineups.data || [], headToHeadResults.data || []);
  const lineupSlots = [['driver_1_id', 'Race driver 1'], ['driver_2_id', 'Race driver 2'], ['reserve_driver_id', 'Reserve driver']];
  const history = [...(raceResults.data || [])].sort(resultOrder);
  const weekendHistory = groupRaceWeekends(history);
  const careerStats = getCareerStats(history);
  const careerRecords = getCareerRecords(history);
  const raceFinishes = history.filter(row => row.session_type === 'race');
  const bestCareerPositions = getBestCareerPositions(history);
  const careerWins = raceFinishes.filter(row => row.race_win).length;
  const careerPodiums = raceFinishes.filter(row => Number(row.position) <= 3 && !row.retired && row.status !== 'Retired').length;
  const careerP2s = raceFinishes.filter(row => Number(row.position) === 2 && !row.retired && row.status !== 'Retired').length;
  const careerP3s = raceFinishes.filter(row => Number(row.position) === 3 && !row.retired && row.status !== 'Retired').length;
  const careerSprintWins = history.filter(row => row.sprint_win).length;
  const careerPoles = history.filter(row => row.pole_position).length;
  const careerSprintPoles = history.filter(row => row.sprint_pole).length;
  const careerFastestLaps = history.filter(row => row.session_type === 'race' && row.fastest_lap).length;
  const careerSprintFastestLaps = history.filter(row => row.session_type === 'sprint' && row.fastest_lap).length;
  const careerRetirements = history.filter(row => row.retired).length;
  const careerGrandSlams = history.filter(row => row.grand_slam).length;
  const careerChampionships = raceResults.data && !championshipResults.loading && !championshipResults.error
    ? getCareerChampionships(id, history, championshipResults.data?.results || [], championshipResults.data?.calendar || [])
    : null;
  const formatCareerPercentage = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
  const imageLabels = { pole_url: 'Pole portrait', grid_url: 'Grid portrait', card_url: 'Driver card' };
  return <><div className="driver-profile-top"><h2>{driver.name} <small>#{driver.number} <span className="driver-code">{driver.code}</span></small></h2>
    {heroImage && <div className="driver-profile-hero"><img src={heroImage} alt={`${driver.name} portrait`} /></div>}</div>
    <p>{driver.nationality_logo && <img height="16" src={driver.nationality_logo} alt="" />} {driver.nationality}</p><p>{driver.bio}</p>
    <div className="split"><div>{['race', 'overtaking', 'speed', 'experience', 'qualifying', 'defence'].map(k => <Bar key={k} l={k} v={r[k]} />)}</div>
      <div className="driver-detail-content"><section className="driver-team-history"><h3>Teams &amp; teammates</h3><QueryStatus query={lineups} empty="No team history recorded." /><QueryStatus query={rosterDrivers} />
        {lineups.data?.map(lineup => {
          const assigned = lineupSlots.map(([key, label]) => ({ id: lineup[key], label })).filter(slot => slot.id); const role = assigned.find(slot => String(slot.id) === String(driver.id))?.label;
          return <article className="driver-team-season" key={`${lineup.team_id}-${lineup.year}`}><div className="driver-team-season-head"><Link className="driver-team-link" to={`/teams/${lineup.team_id}`}>{lineup.teams?.logo_normal && <img src={lineup.teams.logo_normal} alt="" />}<strong>{lineup.teams?.name || 'Team'}</strong></Link><span>{lineup.year === new Date().getFullYear() ? 'Current season' : lineup.year}</span>{role && <small>{role}</small>}</div>
            <div className="driver-teammates">{assigned.filter(slot => String(slot.id) !== String(driver.id)).map(slot => { const teammate = driverById.get(String(slot.id)); return <Link key={`${lineup.year}-${slot.id}`} to={`/drivers/${slot.id}`} className="card driver-card driver-teammate-card">{teammate && latestImg(teammate, 'card_url') && <img className="driver-pole-image" src={latestImg(teammate, 'card_url')} alt="" aria-hidden="true" />}<div className="driver-card-copy"><small>{slot.label}</small><h4>{teammate?.name || `Driver #${slot.id}`}</h4></div></Link> })}</div>
          </article>
        })}</section>
        <section className="teammate-head-to-head"><div className="section-title"><div><h3>Teammate head-to-head</h3><p>Session results from weekends where you shared a team</p></div></div><QueryStatus query={headToHeadResults} />
          {!headToHeadResults.loading && !headToHeadResults.error && !teammateHeadToHead.length && <p className="muted">No shared teammate results saved yet.</p>}
          {!!teammateHeadToHead.length && <div className="teammate-head-to-head-grid">{teammateHeadToHead.map(record => {
            const teammate = driverById.get(String(record.teammateId)); return <article className="teammate-h2h-card" key={record.key} style={{ '--team-color': record.teamColor || '#d3202f' }}>
              <header className="teammate-h2h-header"><div><small>{record.teamName} · {record.years.join(', ')}</small><h4>{teammate?.name || `Driver #${record.teammateId}`}</h4></div>{teammate && <Link to={`/drivers/${teammate.id}`} aria-label={`View ${teammate.name}`} className="teammate-h2h-link">Profile ↗</Link>}</header>
              <div className="teammate-h2h-stats">
                {[['Grand Prix qualifying', record.qualifying], ['Grand Prix races', record.race], ['Sprint qualifying', record.sprintQualifying], ['Sprint races', record.sprint]].map(([label, score]) => <div className="teammate-h2h-stat" key={label}><span>{label}</span><strong>{score.wins}–{score.losses}{score.ties ? `–${score.ties}` : ''}</strong></div>)}
              </div>
              <footer className="teammate-h2h-points"><span>Shared Grand Prix starts <strong>{record.sharedRaces}</strong></span><span>Points <strong>{record.driverPoints}–{record.teammatePoints}</strong></span></footer>
            </article>
          })}</div>}
        </section>
        <section className="race-history"><details className="career-achievements-panel" open><summary className="career-achievements-toggle"><span><strong>Career achievements</strong><small>Totals, rates, and titles calculated from saved results</small></span></summary><div className="career-achievements driver-career-achievements">
          {[
            ['GP starts', careerStats.starts], ['Points', careerStats.points],
            ['Avg. starting pos.', Number.isFinite(careerStats.averageStartingPosition) ? careerStats.averageStartingPosition.toFixed(1) : '—'],
            ['Avg. finishing pos.', Number.isFinite(careerStats.averageFinishingPosition) ? careerStats.averageFinishingPosition.toFixed(1) : '—'],
            ['Avg. points / race', Number.isFinite(careerStats.averagePointsPerRace) ? careerStats.averagePointsPerRace.toFixed(1) : '—'],
            ['Pole-to-win conversion %', formatCareerPercentage(careerStats.poleToWinConversion)],
            ['Points finishes %', formatCareerPercentage(careerStats.pointsFinishPercentage)],
            ['Podium finishes %', formatCareerPercentage(careerStats.podiumPercentage)],
            ['Championships', careerChampionships ?? '—'],
            ['Front row starts', careerStats.frontRowStarts], ['Top 10 starts', careerStats.topTenStarts], ['Top 10 finishes', careerStats.topTenFinishes],
            ['GP wins', careerWins], ['P2 finishes', careerP2s], ['P3 finishes', careerP3s], ['Sprint wins', careerSprintWins],
            ['Podiums', careerPodiums], ['Poles', careerPoles], ['Sprint poles', careerSprintPoles], ['Fastest laps', careerFastestLaps],
            ['Sprint fastest laps', careerSprintFastestLaps], ['Retirements', careerRetirements], ['Grand Slams', careerGrandSlams],
            ['Best finish', Number.isFinite(bestCareerPositions.bestFinish) ? `P${bestCareerPositions.bestFinish}` : '—'],
            ['Best qualifying', Number.isFinite(bestCareerPositions.bestQualifying) ? `P${bestCareerPositions.bestQualifying}` : '—'],
            [`Most wins in a season${careerRecords.mostWinsInSeason ? ` (${careerRecords.mostWinsInSeason.year})` : ''}`, careerRecords.mostWinsInSeason?.value ?? '—'],
            [`Most podiums in a season${careerRecords.mostPodiumsInSeason ? ` (${careerRecords.mostPodiumsInSeason.year})` : ''}`, careerRecords.mostPodiumsInSeason?.value ?? '—'],
            [`Most poles in a season${careerRecords.mostPolesInSeason ? ` (${careerRecords.mostPolesInSeason.year})` : ''}`, careerRecords.mostPolesInSeason?.value ?? '—'],
            [`Most positions gained in a race${careerRecords.mostPositionsGained.year ? ` (${careerRecords.mostPositionsGained.year}${careerRecords.mostPositionsGained.raceName ? ` · ${careerRecords.mostPositionsGained.raceName}` : ''})` : ''}`, careerRecords.mostPositionsGained.value === null ? '—' : careerRecords.mostPositionsGained.value],
            [`Furthest-back winning start${careerRecords.furthestWinningPosition?.year ? ` (${careerRecords.furthestWinningPosition.year}${careerRecords.furthestWinningPosition.raceName ? ` · ${careerRecords.furthestWinningPosition.raceName}` : ''})` : ''}`, careerRecords.furthestWinningPosition?.position ? `P${careerRecords.furthestWinningPosition.position}` : '—']
          ].map(([label, count]) => <div className="career-achievement" key={label}><strong>{count}</strong><span>{label}</span></div>)}
        </div></details>{championshipResults.error && <QueryStatus query={championshipResults} />}<div className="section-title"><div><h3>Race history</h3><p>All saved sessions and session awards</p></div></div><QueryStatus query={raceResults} empty="No saved race results yet." />
          {!!weekendHistory.length && <div className="weekend-history">{weekendHistory.map(weekend => <details className="weekend-history-item" key={weekend.key}>
            <summary className="weekend-history-summary"><span className="weekend-history-year">{weekend.year || '—'}</span><span className="weekend-history-name"><small>ROUND {weekend.round || '—'}</small><strong>{weekend.raceName}</strong></span><span className="weekend-history-count">{weekend.sessions.length} sessions</span><strong className="weekend-history-points">{weekend.pointsTotal} pts</strong></summary>
            <div className="weekend-history-details"><div className="weekend-history-columns driver-weekend-columns"><span>SESSION</span><span>TEAM</span><span>POS</span><span>PTS</span><span>AWARDS</span><span>TIME</span></div>
              {weekend.sessions.map(session => session.rows.map(row => <div className="weekend-history-row driver-weekend-row" key={`${session.session_type}-${row.driver_id}`}><span data-label="Session">{sessionLabel(session.session_type)}</span><span data-label="Team"><Link to={`/teams/${row.teams?.id}`}>{row.teams?.name || 'Team'}</Link></span><span data-label="Position">{row.position === 1 ? 'P1' : `P${row.position}`}{row.retired ? ' · DNF' : ''}</span><span data-label="Points">{row.points}</span><span data-label="Awards">{resultAwards(row).join(' · ') || '—'}</span><span data-label="Time">{row.total_time !== null && Number.isFinite(Number(row.total_time)) ? formatTime(Number(row.total_time)) : '—'}</span></div>))}
            </div>
          </details>)}</div>}
        </section>
        <div className="driver-gallery">{years.map(year => <section className="driver-gallery-year" key={year}><h3>{year}</h3><div className="driver-gallery-grid">{images.filter(image => image.year === year).flatMap(image => ['pole_url', 'grid_url', 'card_url'].filter(key => image[key]).map(key => <figure key={`${image.id}-${key}`}><img src={image[key]} alt={`${driver.name} ${imageLabels[key]}, ${year}`} /><figcaption>{imageLabels[key]}</figcaption></figure>))}</div></section>)}</div></div></div></>
}
const carRatingLabel = key => CAR_ATTRIBUTES.find(attribute => attribute.key === key)?.label || key;
const carRatingText = value => value === null ? 'N/A' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
const CAR_SORT_OPTIONS = [{ key: 'overall', label: 'Overall' }, { key: 'model', label: 'Model' }, ...CAR_ATTRIBUTES];

function CarCard({ car, expanded, onExpandedChange = () => {}, onZoom = () => {}, overallRank, bestAttributes = [], carCardRefs }) {
  const [imageFailed, setImageFailed] = useState(false);
  const overall = getCarOverall(car);
  const rated = CAR_ATTRIBUTES
    .map(({ key, label }) => ({ key, label, value: getCarScore(car, key) }))
    .filter(attribute => attribute.value !== null);
  const strongest = rated.length ? Math.max(...rated.map(attribute => attribute.value)) : null;
  const weakest = rated.length ? Math.min(...rated.map(attribute => attribute.value)) : null;
  const imageAvailable = Boolean(car.image_url) && !imageFailed;
  const teamLogo = car.teams?.logo_normal;
  return <details className="card car-card" open={expanded} onToggle={event => onExpandedChange(car.id, event.currentTarget.open)}
    ref={element => {
      if (!carCardRefs) return;
      if (element) carCardRefs.current.set(String(car.id), element);
      else carCardRefs.current.delete(String(car.id));
    }}>
    <summary className={`car-card-summary${imageAvailable ? ' has-image' : ''}`}>
      {imageAvailable
        ? <button type="button" className="car-card-image-button" aria-label={`Enlarge ${car.model} image`} onClick={event => { event.preventDefault(); event.stopPropagation(); onZoom({ src: car.image_url, alt: `${car.year} ${car.model}` }); }}>
          <img className="car-card-image" src={car.image_url} alt={`${car.year} ${car.model}`} loading="lazy" onError={() => setImageFailed(true)} />
        </button>
        : <div className="car-card-image-placeholder" role="img" aria-label={`${car.model} image unavailable`}>Image unavailable</div>}
      <span className="car-card-heading">
        <span className="car-card-title"><strong>{car.model}</strong><small>{car.year}</small></span>
        {(teamLogo || car.teams?.name || car.engine) && <span className="car-card-team">{teamLogo && <img src={teamLogo} alt={`${car.teams?.name || 'Team'} logo`} loading="lazy" />}{car.teams?.name || car.engine}</span>}
        <span className="car-card-badges">
          <span className="car-rank-badge">{overall === null ? 'Overall N/A' : `#${overallRank || '—'} overall · ${car.year}`}</span>
          {bestAttributes.slice(0, 3).map(key => <span className="car-attribute-badge" key={key}>Best {carRatingLabel(key)}</span>)}
          {bestAttributes.length > 3 && <span className="car-attribute-badge">+{bestAttributes.length - 3} attributes</span>}
        </span>
      </span>
    </summary>
    <div className="car-card-details">
      {car.engine && <p className="car-card-engine">{car.engine}</p>}
      <p className="car-card-overall">Overall score <strong>{carRatingText(overall)}</strong></p>
      <p className="car-card-strengths">
        <span>Strongest: <strong>{strongest === null ? 'N/A' : rated.filter(attribute => attribute.value === strongest).map(attribute => attribute.label).join(', ')}</strong></span>
        <span>Weakest: <strong>{weakest === null ? 'N/A' : rated.filter(attribute => attribute.value === weakest).map(attribute => attribute.label).join(', ')}</strong></span>
      </p>
      <div className="car-card-ratings" aria-label={`${car.model} ratings`}>
        {CAR_ATTRIBUTES.map(({ key, label }) => {
          const value = getCarScore(car, key);
          const isStrongest = value !== null && value === strongest;
          const isWeakest = value !== null && value === weakest;
          return <div className={`car-rating-row${isStrongest ? ' is-strongest' : ''}${isWeakest ? ' is-weakest' : ''}`} key={key}>
            <span>{label}{isStrongest && <span className="car-rating-tag">Best</span>}{isWeakest && <span className="car-rating-tag">Lowest</span>}</span>
            <span className="car-rating-track" role="img" aria-label={`${label}: ${carRatingText(value)}`}>
              <i><b style={{ width: value === null ? '0%' : `${Math.max(0, Math.min(100, value))}%` }} /></i><em>{carRatingText(value)}</em>
            </span>
          </div>;
        })}
      </div>
    </div>
  </details>;
}

function CarRatingsLeaderboard({ cars, onSelectCar, expandedAttributes, onToggleAttribute, allTime }) {
  const attributes = useMemo(() => [
    { key: 'overall', label: 'Overall' },
    ...CAR_ATTRIBUTES
  ], []);
  const rankings = useMemo(() => Object.fromEntries(attributes.map(({ key }) =>
    [key, rankCarsByAttribute(cars, key)]
  )), [attributes, cars]);
  return <section className="car-attribute-leaderboard">
    <h3>{allTime ? 'All-time car leaderboard' : 'Best cars by attribute'}</h3>
    <p className="muted">Overall is the average of the seven standard ratings. Missing values are excluded; rows with no rating show N/A.</p>
    <div className="car-attribute-list">{attributes.map(({ key, label }) => {
      const ranked = rankings[key];
      const expanded = expandedAttributes.has(key);
      const cutoff = ranked[2]?.rank;
      const shown = expanded ? ranked : cutoff === undefined ? [] : ranked.filter(item => item.rank <= cutoff);
      return <section className="car-attribute-group" key={key}>
        <h4>{label}</h4>
        {shown.length
          ? <ol>{shown.map(({ car, score, rank, tieCount }) => <li key={car.id}>
            <span className={`car-attribute-rank car-attribute-rank-${rank <= 3 ? rank : 'other'}`}>#{rank}</span>
            <button type="button" className="car-attribute-entry" onClick={() => onSelectCar(car)}>
              {car.teams?.logo_normal && <img src={car.teams.logo_normal} alt={`${car.teams.name || 'Team'} logo`} loading="lazy" />}
              <strong>{car.model}</strong>{allTime && <small>{car.year}</small>}
            </button>
            <strong className="car-attribute-rating">{carRatingText(score)}</strong>
            {tieCount > 1 && <span className="car-tie-label">Tied · {tieCount} cars</span>}
          </li>)}</ol>
          : <p className="car-attribute-empty">N/A</p>}
        {ranked.length > shown.length && <button type="button" className="car-leaderboard-toggle" aria-expanded={expanded} onClick={() => onToggleAttribute(key)}>
          {expanded ? 'Show top 3' : `Show all ${ranked.length}`}
        </button>}
      </section>;
    })}</div>
  </section>;
}

function CarEvolutionChart({ cars, selectedTeam, onSelectTeam }) {
  const teamOptions = useMemo(() => {
    const groups = new Map();
    for (const car of cars) {
      if (car.team_id == null) continue;
      const key = String(car.team_id);
      if (!groups.has(key)) groups.set(key, { id: key, name: car.teams?.name || `Team ${key}`, logo: car.teams?.logo_normal });
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [cars]);
  const activeTeam = teamOptions.find(team => team.id === selectedTeam) || teamOptions[0];
  const points = useMemo(() => {
    if (!activeTeam) return [];
    const yearly = new Map();
    for (const car of cars) {
      if (String(car.team_id) !== activeTeam.id) continue;
      const year = Number(car.year);
      const score = getCarOverall(car);
      if (!Number.isInteger(year) || score === null) continue;
      yearly.set(year, Math.max(yearly.get(year) ?? -Infinity, score));
    }
    return [...yearly].sort((a, b) => a[0] - b[0]);
  }, [activeTeam, cars]);
  const width = 720, height = 220, margin = { top: 16, right: 24, bottom: 32, left: 42 };
  const x = index => margin.left + (points.length <= 1 ? (width - margin.left - margin.right) / 2 : index * (width - margin.left - margin.right) / (points.length - 1));
  const y = value => margin.top + (100 - value) * (height - margin.top - margin.bottom) / 100;
  return <section className="car-evolution">
    <div className="car-evolution-heading"><div><h3>Car evolution</h3><p>Best overall rating for each team by year</p></div>
      <label>Team <select value={activeTeam?.id || ''} onChange={event => onSelectTeam(event.target.value)} aria-label="Team for car evolution">
        {teamOptions.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}
      </select></label>
    </div>
    {points.length
      ? <div className="car-evolution-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Car overall rating evolution for ${activeTeam?.name}`}>
        <title>Best car overall rating by season for {activeTeam?.name}</title>
        {[0, 25, 50, 75, 100].map(value => <g key={value}><line x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text x={margin.left - 8} y={y(value) + 4} textAnchor="end">{value}</text></g>)}
        <polyline points={points.map(([, score], index) => `${x(index)},${y(score)}`).join(' ')} />
        {points.map(([year, score], index) => <g key={year}><circle cx={x(index)} cy={y(score)} r="5"><title>{year}: {score.toFixed(1)}</title></circle><text x={x(index)} y={height - 8} textAnchor="middle">{year}</text></g>)}
      </svg></div>
      : <p className="muted">No rated cars are available for this team.</p>}
  </section>;
}

function handleSeasonTabKeyDown(event, tabs, active, onSelect) {
  const currentIndex = tabs.findIndex(tab => tab.key === active);
  const nextIndex = event.key === 'ArrowRight' ? (currentIndex + 1) % tabs.length
    : event.key === 'ArrowLeft' ? (currentIndex - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
  if (nextIndex < 0) return;
  event.preventDefault();
  onSelect(tabs[nextIndex].key);
  document.getElementById(tabs[nextIndex].id)?.focus();
}

export function Cars() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSeason = new Date().getFullYear();
  const c = useQ(() => sb.from('cars').select('*,teams(id,name,logo_normal)').order('year', { ascending: false }));
  const cars = c.data || [];
  const years = useMemo(() => [...new Set(cars.map(car => Number(car.year)).filter(Number.isInteger))].sort((a, b) => b - a), [cars]);
  const storedSeason = searchParams.get('season') || 'current';
  const selectedSeason = storedSeason === 'all' || storedSeason === 'current' || years.includes(Number(storedSeason)) ? storedSeason : 'current';
  const allTimeYear = searchParams.get('year') || 'all';
  const selectedYearFilter = allTimeYear === 'all' || years.includes(Number(allTimeYear)) ? allTimeYear : 'all';
  const filter = searchParams.get('filter') || '';
  const storedSort = searchParams.get('sort') || 'overall';
  const sortBy = CAR_SORT_OPTIONS.some(option => option.key === storedSort) ? storedSort : 'overall';
  const expandedParam = searchParams.get('car') || '';
  const evolutionTeamParam = searchParams.get('team') || '';
  const [expandedCarIds, setExpandedCarIds] = useState(() => new Set(expandedParam && expandedParam !== 'all' ? [expandedParam] : []));
  const [expandedAttributes, setExpandedAttributes] = useState(() => new Set());
  const [zoomImage, setZoomImage] = useState(null);
  const carCardRefs = useRef(new Map());
  useEffect(() => {
    if (!zoomImage) return undefined;
    const handleKeyDown = event => {
      if (event.key === 'Escape') setZoomImage(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomImage]);
  const availableSeasons = years.filter(year => year !== currentSeason);
  const tabs = [
    { key: 'current', label: `Current season ${currentSeason}`, id: 'cars-current-tab' },
    ...availableSeasons.map(year => ({ key: String(year), label: String(year), id: `cars-${year}-tab` })),
    { key: 'all', label: 'All-time', id: 'cars-all-tab' }
  ];
  const updateQuery = patch => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    return next;
  }, { replace: true });
  const selectSeason = season => updateQuery({ season, year: season === 'all' ? selectedYearFilter : null });
  const dataSeason = selectedSeason === 'current' ? currentSeason : Number(selectedSeason);
  const seasonCars = useMemo(() => selectedSeason === 'all'
    ? cars.filter(car => selectedYearFilter === 'all' || Number(car.year) === Number(selectedYearFilter))
    : cars.filter(car => Number(car.year) === dataSeason),
  [cars, dataSeason, selectedSeason, selectedYearFilter]);
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const visibleCars = useMemo(() => seasonCars.filter(car => {
    if (!normalizedFilter) return true;
    return [car.model, car.teams?.name, car.engine, car.year].some(value => String(value || '').toLocaleLowerCase().includes(normalizedFilter));
  }), [seasonCars, normalizedFilter]);
  const sortedCars = useMemo(() => [...visibleCars].sort((a, b) => {
    if (sortBy === 'model') return String(a.model).localeCompare(String(b.model)) || Number(b.year) - Number(a.year);
    const left = getCarScore(a, sortBy), right = getCarScore(b, sortBy);
    if (left === null || right === null) return left === right ? String(a.model).localeCompare(String(b.model)) : left === null ? 1 : -1;
    return right - left || String(a.model).localeCompare(String(b.model));
  }), [visibleCars, sortBy]);
  const overallRanks = useMemo(() => new Map(rankCarsByAttribute(visibleCars, 'overall').map(item => [String(item.car.id), item.rank])), [visibleCars]);
  const bestAttributesByCar = useMemo(() => {
    const byCar = new Map();
    for (const attribute of CAR_ATTRIBUTES) {
      for (const item of rankCarsByAttribute(visibleCars, attribute.key)) {
        if (item.rank !== 1) break;
        const key = String(item.car.id), attributes = byCar.get(key) || [];
        attributes.push(attribute.key);
        byCar.set(key, attributes);
      }
    }
    return byCar;
  }, [visibleCars]);
  const seasonSummary = useMemo(() => {
    const overallValues = visibleCars.map(getCarOverall).filter(value => value !== null);
    const teamAverages = new Map();
    for (const car of visibleCars) {
      if (car.team_id == null) continue;
      const value = getCarOverall(car);
      if (value === null) continue;
      const key = String(car.team_id);
      const current = teamAverages.get(key) || { name: car.teams?.name || 'Team', sum: 0, count: 0 };
      current.sum += value;
      current.count += 1;
      teamAverages.set(key, current);
    }
    const topTeam = [...teamAverages.values()].sort((a, b) =>
      b.sum / b.count - a.sum / a.count || a.name.localeCompare(b.name))[0];
    return {
      carCount: visibleCars.length,
      average: overallValues.length ? overallValues.reduce((sum, value) => sum + value, 0) / overallValues.length : null,
      topTeam
    };
  }, [visibleCars]);
  const deltas = useMemo(() => {
    if (selectedSeason === 'all') return [];
    const year = dataSeason;
    const bestPerTeam = targetYear => {
      const best = new Map();
      for (const car of cars.filter(item => Number(item.year) === targetYear)) {
        const score = getCarOverall(car);
        if (score === null || car.team_id == null) continue;
        const key = String(car.team_id), current = best.get(key);
        if (!current || score > current.score) best.set(key, { car, score });
      }
      return best;
    };
    const current = bestPerTeam(year), previous = bestPerTeam(year - 1);
    return [...current].map(([teamId, value]) => ({ teamId, ...value, previous: previous.get(teamId) || null }))
      .sort((a, b) => {
        const aDelta = a.previous ? a.score - a.previous.score : Number.NEGATIVE_INFINITY;
        const bDelta = b.previous ? b.score - b.previous.score : Number.NEGATIVE_INFINITY;
        return bDelta - aDelta;
      });
  }, [cars, dataSeason, selectedSeason]);
  const teamOptions = useMemo(() => [...new Map(cars.filter(car => car.team_id != null).map(car => [String(car.team_id), { id: String(car.team_id), name: car.teams?.name || `Team ${car.team_id}` }])).values()].sort((a, b) => a.name.localeCompare(b.name)), [cars]);
  const selectedEvolutionTeam = teamOptions.some(team => team.id === evolutionTeamParam) ? evolutionTeamParam : teamOptions[0]?.id || '';
  const isExpandAll = expandedParam === 'all';

  useEffect(() => {
    if (expandedParam === 'all') setExpandedCarIds(new Set(cars.map(car => String(car.id))));
    else if (expandedParam && cars.some(car => String(car.id) === expandedParam)) {
      setExpandedCarIds(current => new Set([...current, expandedParam]));
    }
  }, [expandedParam, cars]);
  useEffect(() => {
    if (expandedParam && expandedParam !== 'all') {
      carCardRefs.current.get(expandedParam)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [expandedParam, sortedCars]);

  const handleExpandedChange = (id, open) => {
    const key = String(id), next = new Set(expandedCarIds);
    if (open) next.add(key);
    else next.delete(key);
    setExpandedCarIds(next);
    if (open) updateQuery({ car: key });
    else if (isExpandAll) updateQuery({ car: null });
    else if (expandedParam === key) updateQuery({ car: [...next].at(-1) || null });
  };
  const expandAll = () => {
    const next = new Set(visibleCars.map(car => String(car.id)));
    setExpandedCarIds(next);
    updateQuery({ car: 'all' });
  };
  const collapseAll = () => {
    setExpandedCarIds(new Set());
    updateQuery({ car: null });
  };
  const selectLeaderboardCar = car => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('filter');
      next.set('car', String(car.id));
      return next;
    }, { replace: true });
    setExpandedCarIds(current => new Set([...current, String(car.id)]));
  };
  const nearestYear = getNearestCarYear(cars, dataSeason);
  const filteredDeltas = deltas.filter(item => !normalizedFilter || [item.car.model, item.car.teams?.name, item.car.year].some(value => String(value || '').toLocaleLowerCase().includes(normalizedFilter)));
  const yearsForTabs = [{ key: 'all', value: 'all', label: 'All seasons' }, ...years.map(year => ({ key: String(year), value: String(year), label: String(year) }))];

  return <section className="cars-page">
    <h2>Cars</h2>
    <QueryStatus query={c} empty="No cars have been added yet." />
    {c.loading && <div className="car-loading" aria-label="Loading cars" aria-busy="true">
      <div className="car-skeleton car-skeleton-leaderboard" />
      <div className="grid">{Array.from({ length: 6 }, (_, index) => <div className="car-skeleton car-skeleton-card" key={index} />)}</div>
    </div>}
    {cars.length > 0 && <>
      <div className="car-season-tabs" role="tablist" aria-label="Car model years" onKeyDown={event => handleSeasonTabKeyDown(event, tabs, selectedSeason, selectSeason)}>
        {tabs.map(tab => <button type="button" role="tab" id={tab.id} aria-controls="cars-panel" aria-selected={selectedSeason === tab.key}
          tabIndex={selectedSeason === tab.key ? 0 : -1} className={selectedSeason === tab.key ? 'active' : ''} key={tab.key}
          onClick={() => selectSeason(tab.key)}>{tab.label}{tab.key === 'current' ? ` (${cars.filter(car => Number(car.year) === currentSeason).length})` : ''}</button>)}
      </div>
      {selectedSeason === 'all' && <label className="car-alltime-filter">Season <select value={selectedYearFilter} onChange={event => updateQuery({ year: event.target.value })}>
        {yearsForTabs.map(option => <option key={option.key} value={option.value}>{option.label}</option>)}
      </select></label>}
      <section id="cars-panel" role="tabpanel" aria-labelledby={tabs.find(tab => tab.key === selectedSeason)?.id || 'cars-current-tab'}>
        {selectedSeason !== 'all' && visibleCars.length > 0 && <div className="car-season-summary">
          <div><small>CARS</small><strong>{seasonSummary.carCount}</strong></div>
          <div><small>AVERAGE OVERALL</small><strong>{seasonSummary.average === null ? 'N/A' : seasonSummary.average.toFixed(1)}</strong></div>
          <div className="car-summary-team"><small>TOP TEAM · AVG OVERALL</small><strong>{seasonSummary.topTeam?.name || 'N/A'}</strong></div>
        </div>}
        {selectedSeason === 'all' && visibleCars.length > 0 && <div className="car-season-summary">
          <div><small>CARS</small><strong>{seasonSummary.carCount}</strong></div>
          <div><small>AVERAGE OVERALL</small><strong>{seasonSummary.average === null ? 'N/A' : seasonSummary.average.toFixed(1)}</strong></div>
          <div className="car-summary-team"><small>TOP TEAM · AVG OVERALL</small><strong>{seasonSummary.topTeam?.name || 'N/A'}</strong></div>
        </div>}
        {visibleCars.length > 0
          ? <>
            <CarRatingsLeaderboard cars={visibleCars} onSelectCar={selectLeaderboardCar} expandedAttributes={expandedAttributes}
              onToggleAttribute={key => setExpandedAttributes(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
              allTime={selectedSeason === 'all'} />
            {selectedSeason !== 'all' && <section className="car-season-deltas">
              <h3>Best car change vs. previous season</h3>
              {filteredDeltas.length
                ? <div className="scroll"><table><thead><tr><th>Team</th><th>Best car</th><th>{dataSeason - 1} overall</th><th>{dataSeason} overall</th><th>Change</th></tr></thead><tbody>{filteredDeltas.map(item => {
                  const delta = item.previous ? item.score - item.previous.score : null;
                  return <tr key={item.teamId}><td>{item.car.teams?.name || 'Team'}</td><td>{item.car.model}</td>
                    <td>{item.previous ? item.previous.score.toFixed(1) : 'N/A'}</td><td>{item.score.toFixed(1)}</td>
                    <td className={delta === null ? '' : delta > 0 ? 'car-delta-up' : delta < 0 ? 'car-delta-down' : 'car-delta-same'}>
                      {delta === null ? 'No previous data' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}${delta > 0 ? ' ↑' : delta < 0 ? ' ↓' : ' →'}`}
                    </td>
                  </tr>;
                })}</tbody></table></div>
                : <p className="muted">{dataSeason - 1} car data is not available for comparison.</p>}
            </section>}
            <CarEvolutionChart cars={cars} selectedTeam={selectedEvolutionTeam} onSelectTeam={team => updateQuery({ team })} />
            <div className="car-controls">
              <label>Filter cars <input type="search" value={filter} onChange={event => updateQuery({ filter: event.target.value || null })} placeholder="Model, team, or engine" /></label>
              <label>Sort cars <select value={sortBy} onChange={event => updateQuery({ sort: event.target.value })}>{CAR_SORT_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
              <button type="button" onClick={isExpandAll || (visibleCars.length > 0 && visibleCars.every(car => expandedCarIds.has(String(car.id)))) ? collapseAll : expandAll}>
                {isExpandAll || (visibleCars.length > 0 && visibleCars.every(car => expandedCarIds.has(String(car.id)))) ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
            {sortedCars.length
              ? <div className="grid car-grid">{sortedCars.map(car => <CarCard key={car.id} car={car}
                expanded={isExpandAll || expandedCarIds.has(String(car.id))} onExpandedChange={handleExpandedChange}
                onZoom={setZoomImage} overallRank={overallRanks.get(String(car.id))} bestAttributes={bestAttributesByCar.get(String(car.id)) || []}
                carCardRefs={carCardRefs} />)}</div>
              : <p className="query-status">No cars match “{filter}”. Clear the filter to see this season’s cars.</p>}
          </>
          : <div className="car-empty-state"><p>{cars.length ? selectedSeason === 'all' ? 'No cars match the selected season and filter.' : `No cars for ${selectedSeason === 'current' ? currentSeason : selectedSeason}.` : 'No car data available.'}</p>
            {cars.length > 0 && nearestYear !== null && selectedSeason !== 'all' && <button type="button" onClick={() => selectSeason(String(nearestYear))}>View {nearestYear} cars</button>}
          </div>}
      </section>
    </>}
    {zoomImage && <div className="car-image-dialog-backdrop" role="presentation" onClick={() => setZoomImage(null)}>
      <section className="car-image-dialog" role="dialog" aria-modal="true" aria-label={`${zoomImage.alt} enlarged image`} onClick={event => event.stopPropagation()}>
        <button type="button" aria-label="Close enlarged car image" onClick={() => setZoomImage(null)}>×</button>
        <img src={zoomImage.src} alt={zoomImage.alt} />
      </section>
    </div>}
  </section>;
}
export function Teams() {
  const t = useQ(() => sb.from('teams').select('*').order('name'));
  return <><h2>Teams</h2><QueryStatus query={t} empty="No teams yet." /><div className="grid team-grid">{t.data?.map(x => {
    const detailedLogo = Boolean(x.logo_detailed);
    const logo = x.logo_detailed || x.logo_normal;
    return <Link key={x.id} to={'/teams/' + x.id} className={`card team-card ${detailedLogo ? 'has-detailed-logo' : 'has-normal-logo'}`} aria-label={x.name} style={{ backgroundColor: x.color || '#fff' }}>
      {logo && <img src={logo} alt={`${x.name} logo`} />}
    </Link>;
  })}</div></>
}
export function Team() {
  const { id } = useParams(); const t = useQ(() => sb.from('teams').select('*,cars(*)').eq('id', id).single(), [id]);
  const [searchParams, setSearchParams] = useSearchParams();
  const lineups = useQ(() => sb.from('team_driver_lineups').select('*').eq('team_id', id).order('year', { ascending: false }), [id]);
  const raceResults = useQ(() => sb.from('race_results').select('grid_id,race_id,session_type,driver_id,position,points,status,laps_completed,total_time,pole_position,sprint_pole,race_win,sprint_win,fastest_lap,grand_slam,retired,races(year,round,name),grids(year),drivers(id,name,code)').eq('team_id', id), [id]);
  const drivers = useQ(() => sb.from('drivers').select('id,name,code,number,driver_images(year,grid_url)').order('name'));
  const availableResultYears = useMemo(() => [...new Set((raceResults.data || [])
    .map(getTeamResultYear).filter(year => year !== null))].sort((a, b) => b - a), [raceResults.data]);
  const requestedSeason = searchParams.get('season') || 'all';
  const requestedRange = /^(\d{4})-(\d{4})$/.exec(requestedSeason);
  const isValidRange = requestedRange
    && Number(requestedRange[1]) <= Number(requestedRange[2])
    && availableResultYears.includes(Number(requestedRange[1]))
    && availableResultYears.includes(Number(requestedRange[2]));
  const selectedSeason = requestedSeason === 'all'
    || availableResultYears.includes(Number(requestedSeason))
    || isValidRange ? requestedSeason : 'all';
  const resultRows = useMemo(() => filterTeamResultsBySeason(raceResults.data || [], selectedSeason), [raceResults.data, selectedSeason]);
  const updateSeason = season => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    if (season === 'all') next.delete('season');
    else next.set('season', season);
    return next;
  }, { replace: true });
  if (t.loading || t.error || !t.data) return <><h2>Team</h2><QueryStatus query={t} /></>;
  const team = t.data, driverById = new Map((drivers.data || []).map(driver => [String(driver.id), driver]));
  const teamCareerStats = getTeamCareerStats(resultRows);
  const coverage = getTeamResultCoverage(resultRows);
  const raceRows = resultRows.filter(row => row.session_type === 'race');
  const sprintRows = resultRows.filter(row => row.session_type === 'sprint');
  const hasSavedResults = resultRows.length > 0;
  const formatPercent = (count, denominator) => denominator ? `${(count / denominator * 100).toFixed(1)}% of ${denominator} ${denominator === 1 ? 'weekend' : 'weekends'}` : '—';
  const formatSprintStat = (count, rate = false) => coverage.sprintWeekendCount
    ? rate ? formatPercent(count, coverage.sprintWeekendCount) : count
    : '—';
  const achievements = [
    { label: 'Points', value: teamCareerStats.points, detail: coverage.raceCount ? `${teamCareerStats.averagePointsPerRace.toFixed(1)} points per race` : '—' },
    { label: 'GP wins', value: teamCareerStats.wins, detail: formatPercent(teamCareerStats.wins, coverage.raceCount) },
    { label: 'Podiums', value: teamCareerStats.podiums, detail: formatPercent(teamCareerStats.podiums, coverage.raceCount) },
    { label: '1–2 finishes', value: teamCareerStats.oneTwoFinishes },
    { label: 'Double podiums', value: teamCareerStats.doublePodiums },
    { label: 'Double points', value: teamCareerStats.doublePoints },
    { label: 'Sprint wins', value: formatSprintStat(sprintRows.filter(row => row.sprint_win).length), detail: formatSprintStat(sprintRows.filter(row => row.sprint_win).length, true) },
    { label: 'Poles', value: raceRows.filter(row => row.pole_position).length, detail: formatPercent(raceRows.filter(row => row.pole_position).length, coverage.raceCount) },
    { label: 'Sprint poles', value: formatSprintStat(sprintRows.filter(row => row.sprint_pole).length), detail: formatSprintStat(sprintRows.filter(row => row.sprint_pole).length, true) },
    { label: 'Fastest laps', value: raceRows.filter(row => row.fastest_lap).length, detail: formatPercent(raceRows.filter(row => row.fastest_lap).length, coverage.raceCount) },
    { label: 'Sprint fastest laps', value: formatSprintStat(sprintRows.filter(row => row.fastest_lap).length), detail: formatSprintStat(sprintRows.filter(row => row.fastest_lap).length, true) },
    { label: 'Retirements', value: raceRows.filter(row => row.retired || row.status === 'Retired').length, detail: coverage.raceCount ? `${(raceRows.filter(row => row.retired || row.status === 'Retired').length / coverage.raceCount).toFixed(2)} per race` : '—' },
    { label: 'Grand Slams', value: resultRows.filter(row => row.grand_slam).length }
  ];
  const driverStats = new Map();
  for (const row of resultRows) {
    if (!row.driver_id) continue;
    const key = String(row.driver_id);
    const stats = driverStats.get(key) || { id: row.driver_id, name: row.drivers?.name || driverById.get(key)?.name || 'Driver', points: 0, wins: 0, poles: 0, podiums: 0 };
    stats.points += Number(row.points) || 0;
    if (row.session_type === 'race') {
      if (row.race_win) stats.wins += 1;
      if (!row.retired && row.status !== 'Retired' && Number(row.position) >= 1 && Number(row.position) <= 3) stats.podiums += 1;
    }
    if (row.pole_position) stats.poles += 1;
    driverStats.set(key, stats);
  }
  const driverLeaderboards = [
    { label: 'Wins', key: 'wins' },
    { label: 'Poles', key: 'poles' },
    { label: 'Podiums', key: 'podiums' },
    { label: 'Points', key: 'points' }
  ].map(category => ({
    ...category,
    drivers: [...driverStats.values()]
      .filter(driver => driver[category.key] > 0)
      .sort((a, b) => b[category.key] - a[category.key] || a.name.localeCompare(b.name))
  }));
  const weekendHistory = groupRaceWeekends(resultRows);
  const rangeMatch = /^(\d{4})-(\d{4})$/.exec(selectedSeason);
  const seasonMode = selectedSeason === 'all' ? 'all' : rangeMatch ? 'range' : 'season';
  const selectedYear = seasonMode === 'season' ? selectedSeason : String(availableResultYears[0] || '');
  const rangeStart = rangeMatch ? rangeMatch[1] : String(availableResultYears.at(-1) || '');
  const rangeEnd = rangeMatch ? rangeMatch[2] : String(availableResultYears[0] || '');
  const periodLabel = selectedSeason === 'all' ? 'All time' : rangeMatch ? `${rangeStart}–${rangeEnd}` : selectedSeason;
  const coverageLabel = coverage.firstYear === null ? '' : `Based on ${coverage.raceCount} saved ${coverage.raceCount === 1 ? 'race' : 'races'}, ${coverage.firstYear}–${coverage.lastYear}.`;
  const lineupSlots = [['driver_1_id', 'Race driver 1'], ['driver_2_id', 'Race driver 2'], ['reserve_driver_id', 'Reserve driver']];
  return <><div className="team-profile-heading">{team.logo_normal && <img src={team.logo_normal} alt={`${team.name} logo`} />}<h2>{team.name}</h2></div>
    <section className="team-lineup-history"><h3>Driver lineups</h3><QueryStatus query={lineups} empty="No driver lineups recorded." /><QueryStatus query={drivers} />
      <div className="team-lineup-seasons">{lineups.data?.map(lineup => <section className="team-lineup-season" key={lineup.year}><h4>{lineup.year}</h4><div className="grid team-lineup-cards">{lineupSlots.map(([key, label]) => {
        const driver = lineup[key] ? driverById.get(String(lineup[key])) : null;
        const image = driverGridImage(driver, lineup.year);
        const content = <>{image && <img className="lineup-driver-image" src={image} alt="" aria-hidden="true" />}<div className="lineup-driver-copy"><small>{label}</small><strong>{driver?.name || 'Not assigned'}</strong></div></>;
        const className = `card lineup-driver-card${image ? ' has-image' : ''}`;
        return driver ? <Link key={key} to={`/drivers/${driver.id}`} className={className}>{content}</Link> : <div key={key} className={className}>{content}</div>;
      })}</div></section>)}</div></section>
    <section className="race-history">
      <div className="section-title"><div><h3>Team achievements</h3><p>Totals calculated from saved results</p></div></div>
      <div className="team-results-filter">
        <label>Results period<select value={seasonMode} onChange={event => {
          if (event.target.value === 'all') updateSeason('all');
          else if (event.target.value === 'season') updateSeason(selectedYear || String(new Date().getFullYear()));
          else updateSeason(`${rangeStart}-${rangeEnd}`);
        }}>
          <option value="all">All time</option><option value="season" disabled={!availableResultYears.length}>Single season</option><option value="range" disabled={!availableResultYears.length}>Season range</option>
        </select></label>
        {seasonMode === 'season' && <label>Season<select value={selectedYear} onChange={event => updateSeason(event.target.value)}>
          {availableResultYears.map(year => <option value={year} key={year}>{year}</option>)}
        </select></label>}
        {seasonMode === 'range' && <div className="team-results-range">
          <label>From<select value={rangeStart} onChange={event => {
            const start = Number(event.target.value), end = Number(rangeEnd);
            updateSeason(`${start}-${Math.max(start, end)}`);
          }}>{[...availableResultYears].sort((a, b) => a - b).map(year => <option value={year} key={year}>{year}</option>)}</select></label>
          <span aria-hidden="true">to</span>
          <label>To<select value={rangeEnd} onChange={event => {
            const end = Number(event.target.value), start = Number(rangeStart);
            updateSeason(`${Math.min(start, end)}-${end}`);
          }}>{[...availableResultYears].sort((a, b) => a - b).map(year => <option value={year} key={year}>{year}</option>)}</select></label>
        </div>}
      </div>
      <QueryStatus query={raceResults} />
      {coverageLabel && !raceResults.loading && <p className="team-results-coverage">{coverageLabel}</p>}
      {!raceResults.loading && !raceResults.error && !hasSavedResults
        ? <p className="team-results-empty">{selectedSeason === 'all' ? 'No saved results for this team.' : `No saved results for ${periodLabel}.`}</p>
        : hasSavedResults && <div className="career-achievements team-achievements-list">
          {achievements.map(({ label, value, detail }) => <div className="career-achievement" key={label}>
            <strong>{value}</strong><span>{label}</span>{detail && <small>{detail}</small>}
          </div>)}
        </div>}
      <section className="team-driver-leaderboards"><div className="section-title"><div><h3>Driver leaderboard</h3><p>Team drivers ranked by saved results · {periodLabel}</p></div></div>{driverLeaderboards.some(category => category.drivers.length) ? <div className="team-driver-leaderboard-grid">{driverLeaderboards.map(category => <section className="team-driver-leaderboard" key={category.key}><h4>{category.label}</h4>{category.drivers.length ? <ol>{category.drivers.map((driver, index) => <li key={driver.id}><span className="leaderboard-rank">{index + 1}</span><Link to={`/drivers/${driver.id}`}>{driver.name}</Link><strong>{driver[category.key]}</strong></li>)}</ol> : <p>No {category.label.toLowerCase()} recorded.</p>}</section>)}</div> : <p className="muted">{hasSavedResults ? 'No driver results recorded for this period.' : 'No driver results recorded.'}</p>}</section>
      <div className="section-title team-race-history-title"><div><h3>Race history</h3><p>All saved sessions and driver awards · {periodLabel}</p></div></div>
      {!!weekendHistory.length && <div className="weekend-history">{weekendHistory.map(weekend => <details className="weekend-history-item" key={weekend.key}>
        <summary className="weekend-history-summary"><span className="weekend-history-year">{weekend.year || '—'}</span><span className="weekend-history-name"><small>ROUND {weekend.round || '—'}</small><strong>{weekend.raceName}</strong></span><span className="weekend-history-count">{weekend.sessions.length} sessions</span><strong className="weekend-history-points">{weekend.pointsTotal} pts</strong></summary>
        <div className="weekend-history-details"><div className="weekend-history-columns team-weekend-columns"><span>SESSION</span><span>DRIVER RESULTS</span><span>TEAM PTS</span></div>
          {weekend.sessions.map(session => <div className="weekend-history-row team-weekend-row" key={session.session_type}><span data-label="Session">{sessionLabel(session.session_type)}</span><span data-label="Driver results" className="weekend-driver-results">{[...session.rows].sort((a, b) => a.position - b.position).map(row => <span className="team-result-driver" key={row.driver_id}><Link to={`/drivers/${row.drivers?.id}`}>{row.drivers?.code ? <span className="driver-code">{row.drivers.code}</span> : row.drivers?.name || 'Driver'}</Link> P{row.position}{row.retired ? ' DNF' : ''}{resultAwards(row).length > 0 && <small> ({resultAwards(row).join(', ')})</small>}</span>)}</span><span data-label="Team points">{session.rows.reduce((sum, row) => sum + (Number(row.points) || 0), 0)}</span></div>)}
        </div>
      </details>)}</div>}
      {!raceResults.loading && !raceResults.error && !weekendHistory.length && <p className="team-results-empty">No saved race history for {periodLabel}.</p>}
    </section>
    <QueryStatus query={{ ...t, data: team.cars || [] }} empty="No cars registered for this team." /><div className="grid car-grid">{[...(team.cars || [])].sort((a, b) => b.year - a.year).map(car => <CarCard key={car.id} car={{ ...car, teams: team }} bestAttributes={[]} />)}</div></>
}
async function loadCircuitResults(circuitName) {
  const { data: races, error: raceError } = await sb.from('races')
    .select('id,year,round,name,circuit,country,circuit_image_url,date')
    .eq('circuit', circuitName)
    .order('year', { ascending: false }).order('round');
  if (raceError) throw raceError;
  if (!races?.length) return { races: [], results: [] };
  const results = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('race_results')
      .select('grid_id,race_id,driver_id,team_id,session_type,position,points,pole_position,race_win,fastest_lap,retired,status,drivers(id,name,code),teams(id,name,logo_normal,color)')
      .in('race_id', races.map(race => race.id))
      .order('race_id').order('session_type').order('position')
      .range(offset, offset + 999);
    if (error) throw error;
    results.push(...(data || []));
    if (!data || data.length < 1000) return { races, results };
  }
}

export function Races() {
  const r = useQ(() => sb.from('races').select('*').order('year', { ascending: false }).order('round'));
  return <><h2>Races</h2><QueryStatus query={r} empty="No races yet." /><table><tbody>{r.data?.map(x => <tr key={x.id}><td>{x.year}</td><td>R{x.round}</td><td>{x.name}</td><td>{x.circuit && <Link to={`/circuits/${encodeURIComponent(x.circuit)}`}>{x.circuit}</Link>}</td><td>{x.date}</td><td>{x.is_sprint && 'Sprint'}</td></tr>)}</tbody></table></>
}

export function Circuits() {
  const races = useQ(() => sb.from('races').select('id,year,name,circuit,country,circuit_image_url').order('year', { ascending: false }));
  const circuits = [...(races.data || []).reduce((groups, race) => {
    const name = race.circuit?.trim();
    if (!name) return groups;
    const circuit = groups.get(name) || { name, races: [] };
    circuit.races.push(race);
    groups.set(name, circuit);
    return groups;
  }, new Map()).values()].sort((a, b) => a.name.localeCompare(b.name));
  return <section className="circuits-page">
    <h2>Circuits</h2>
    <QueryStatus query={races} empty="No circuits found in the race calendar." />
    <div className="grid circuit-grid">{circuits.map(circuit => {
      const latestRace = circuit.races[0];
      const years = circuit.races.map(race => Number(race.year)).filter(Number.isFinite);
      return <Link key={circuit.name} to={`/circuits/${encodeURIComponent(circuit.name)}`} className="card circuit-card">
        {latestRace.circuit_image_url
          ? <img src={latestRace.circuit_image_url} alt={`${circuit.name} circuit`} />
          : <div className="circuit-card-placeholder" aria-hidden="true">F1</div>}
        <div><h3>{circuit.name}</h3><p>{latestRace.country || 'Circuit'} · {circuit.races.length} race{circuit.races.length === 1 ? '' : 's'}</p>
          {years.length > 0 && <small>{Math.min(...years)}–{Math.max(...years)}</small>}</div>
      </Link>;
    })}</div>
  </section>;
}

function CircuitStatsTable({ title, rows, entity, metric, metricLabel }) {
  const [showAll, setShowAll] = useState(false);
  const sortedRows = [...rows]
    .filter(row => Number(row[metric]) > 0)
    .sort((a, b) => Number(b[metric]) - Number(a[metric]) || a.name.localeCompare(b.name));
  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, 10);
  return <section className="circuit-stats">
    <header className="circuit-leaderboard-heading"><h3>{title}</h3><span>{metricLabel}</span></header>
    {sortedRows.length
      ? <><div className="scroll circuit-stats-scroll"><table><thead><tr><th aria-label="Rank">#</th><th>{entity}</th><th>{metricLabel}</th></tr></thead><tbody>{visibleRows.map((row, index) => <tr key={row.id} className={index < 3 ? `circuit-leaderboard-top-${index + 1}` : undefined}>
        <td className="circuit-leaderboard-rank">{index + 1}</td><td><Link className="circuit-stat-entity" to={`/${entity === 'Driver' ? 'drivers' : 'teams'}/${row.id}`}>
          {row.logo && <img src={row.logo} alt="" />}{row.name}
        </Link></td><td className="circuit-leaderboard-score">{Number(row[metric]).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
      </tr>)}</tbody></table></div>
      {sortedRows.length > 10 && <button type="button" className="circuit-leaderboard-toggle" onClick={() => setShowAll(current => !current)}>{showAll ? 'Show top 10' : `Show all ${sortedRows.length}`}</button>}</>
      : <p className="muted">No {metricLabel.toLowerCase()} recorded for {title.toLowerCase()} at this circuit.</p>}
  </section>;
}

export function Circuit() {
  const { name } = useParams();
  const circuit = useQ(() => loadCircuitResults(name || ''), [name]);
  const [selectedMetric, setSelectedMetric] = useState('points');
  const metrics = [
    ['wins', 'Wins'], ['poles', 'Poles'], ['podiums', 'Podiums'],
    ['points', 'Points'], ['races', 'Races'], ['fastestLaps', 'Fastest laps']
  ];
  const races = circuit.data?.races || [];
  const results = circuit.data?.results || [];
  const drivers = new Map();
  const teams = new Map();
  const addStats = (collection, subject, id, result) => {
    if (!id || !subject) return null;
    const key = String(id);
    const stats = collection.get(key) || {
      id, name: subject.name || `${entityLabel(collection)} #${id}`, code: subject.code || '',
      logo: subject.logo_normal || '', wins: 0, poles: 0, podiums: 0, points: 0,
      races: new Set(), fastestLaps: 0
    };
    const event = `${result.grid_id}:${result.race_id}`;
    if (result.session_type === 'race') {
      stats.races.add(event);
      const position = Number(result.position);
      if (result.race_win || position === 1) stats.wins += 1;
      if (position >= 1 && position <= 3 && !result.retired && result.status !== 'Retired') stats.podiums += 1;
      if (result.fastest_lap) stats.fastestLaps += 1;
    } else if (result.session_type === 'qualifying' && (result.pole_position || Number(result.position) === 1)) {
      stats.poles += 1;
    }
    if (result.session_type === 'race' || result.session_type === 'sprint') stats.points += Number(result.points) || 0;
    collection.set(key, stats);
    return stats;
  };
  const entityLabel = collection => collection === drivers ? 'Driver' : 'Team';
  for (const result of results) {
    addStats(drivers, result.drivers, result.driver_id, result);
    addStats(teams, result.teams, result.team_id, result);
  }
  const driverStats = [...drivers.values()].map(({ races: starts, ...stats }) => ({ ...stats, races: starts.size }));
  const teamStats = [...teams.values()].map(({ races: starts, ...stats }) => ({ ...stats, races: starts.size }));
  const image = races.find(race => race.circuit_image_url)?.circuit_image_url;
  if (circuit.loading || circuit.error) return <section className="circuit-detail"><Link to="/circuits">← All circuits</Link><h2>{name || 'Circuit'}</h2><QueryStatus query={circuit} /></section>;
  if (!races.length) return <section className="circuit-detail"><Link to="/circuits">← All circuits</Link><h2>Circuit not found</h2></section>;
  return <section className="circuit-detail">
    <Link to="/circuits">← All circuits</Link>
    <header className="circuit-detail-heading">
      {image && <img src={image} alt={`${name} circuit map`} />}
      <div><p className="eyebrow">CIRCUIT</p><h2>{name}</h2><p>{[...new Set(races.map(race => race.country).filter(Boolean))].join(' · ')}</p><strong>{races.length} race{races.length === 1 ? '' : 's'} in calendar</strong></div>
    </header>
    <p className="muted circuit-stats-note">Race starts and race awards are from Grand Prix results. Points include Grand Prix and sprint sessions; fastest laps exclude sprint sessions.</p>
    <div className="circuit-metric-tabs" role="tablist" aria-label="Circuit leaderboard categories">
      {metrics.map(([key, label]) => <button type="button" role="tab" id={`circuit-${key}-tab`} aria-controls="circuit-leaderboards-panel"
        aria-selected={selectedMetric === key} className={selectedMetric === key ? 'active' : ''} key={key}
        onClick={() => setSelectedMetric(key)}>{label}</button>)}
    </div>
    <section id="circuit-leaderboards-panel" role="tabpanel" aria-labelledby={`circuit-${selectedMetric}-tab`} className="circuit-leaderboards">
      <CircuitStatsTable key={`${selectedMetric}-drivers`} title="Driver leaderboard" rows={driverStats} entity="Driver" metric={selectedMetric} metricLabel={metrics.find(([key]) => key === selectedMetric)?.[1]} />
      <CircuitStatsTable key={`${selectedMetric}-teams`} title="Team leaderboard" rows={teamStats} entity="Team" metric={selectedMetric} metricLabel={metrics.find(([key]) => key === selectedMetric)?.[1]} />
    </section>
    <section className="circuit-race-history"><h3>Races at this circuit</h3><div className="scroll"><table><thead><tr><th>Season</th><th>Round</th><th>Race</th><th>Date</th></tr></thead><tbody>{races.map(race => <tr key={race.id}><td>{race.year}</td><td>{race.round ? `R${race.round}` : '—'}</td><td>{race.name}</td><td>{race.date || '—'}</td></tr>)}</tbody></table></div></section>
  </section>;
}

export function Results() {
  const results = useQ(loadSavedRaceResults);
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const weekends = groupRaceWeekends(results.data || []);
  const years = [...new Set(weekends.map(weekend => weekend.year).filter(Boolean))].sort((a, b) => b - a);
  const activeYear = years.includes(Number(selectedYear)) ? Number(selectedYear) : years[0];
  const yearWeekends = weekends.filter(weekend => weekend.year === activeYear);
  const activeWeekend = yearWeekends.find(weekend => String(weekend.raceId) === String(selectedRaceId)) || yearWeekends[0];
  const defaultSession = activeWeekend?.sessions.find(session => session.session_type === 'race')
    || activeWeekend?.sessions.find(session => session.session_type === 'qualifying')
    || activeWeekend?.sessions.find(session => session.session_type === 'sprint')
    || activeWeekend?.sessions[activeWeekend.sessions.length - 1];
  const activeSession = activeWeekend?.sessions.find(session => session.session_type === selectedSession) || defaultSession;
  const classification = [...(activeSession?.rows || [])].sort((a, b) => a.position - b.position);
  const changeYear = year => { setSelectedYear(year); setSelectedRaceId(''); setSelectedSession('') };
  const changeRace = raceId => { setSelectedRaceId(raceId); setSelectedSession('') };
  return <section className="results-page">
    <div className="results-page-heading"><div><p className="eyebrow">OFFICIAL CLASSIFICATION</p><h2>Race results</h2><p>Browse saved results by season, Grand Prix, and session.</p></div><button type="button" onClick={results.retry} disabled={results.loading}>Refresh results</button></div>
    <QueryStatus query={results} empty="No saved race results yet. Simulate a race weekend to see the classifications here." />
    {weekends.length > 0 && <><nav className="results-year-nav" aria-label="Results season pages">{years.map(year => <button type="button" key={year} className={year === activeYear ? 'active' : ''} aria-current={year === activeYear ? 'page' : undefined} onClick={() => changeYear(year)}>{year}</button>)}</nav>
      <section className="results-season-page" aria-label={`${activeYear} race results`}>
        <header className="results-season-heading"><div><small>SEASON</small><h3>{activeYear}</h3></div><span>{yearWeekends.length} race{yearWeekends.length === 1 ? '' : 's'}</span></header>
        <nav className="results-race-nav" aria-label={`${activeYear} races`}>{yearWeekends.map(weekend => <button type="button" key={weekend.key} className={String(weekend.raceId) === String(activeWeekend?.raceId) ? 'active' : ''} aria-current={String(weekend.raceId) === String(activeWeekend?.raceId) ? 'true' : undefined} onClick={() => changeRace(weekend.raceId)}><span>R{weekend.round || '—'}</span><strong>{weekend.raceName}</strong></button>)}</nav>
        {activeWeekend && activeSession && <div className="results-classification">
          <header className="results-classification-heading"><div><small>{activeWeekend.year} · ROUND {activeWeekend.round || '—'}</small><h3>{activeWeekend.raceName}</h3><span>{sessionLabel(activeSession.session_type)} classification</span></div>{activeWeekend.sessions.some(session => session.session_type === 'sprint') && <strong className="results-sprint-tag">SPRINT WEEKEND</strong>}</header>
          <nav className="results-session-nav" aria-label={`${activeWeekend.raceName} sessions`}>{activeWeekend.sessions.map(session => <button type="button" key={session.session_type} className={session.session_type === activeSession.session_type ? 'active' : ''} aria-current={session.session_type === activeSession.session_type ? 'true' : undefined} onClick={() => setSelectedSession(session.session_type)}>{sessionLabel(session.session_type)}</button>)}</nav>
          <div className="scroll results-table-scroll"><table className="race-table live-timing-table results-table"><thead><tr><th>POS</th><th>DRIVER</th><th>GRID</th><th>STATUS</th><th>LAPS</th><th>TIME</th><th>BEST</th><th>PTS</th><th>AWARDS</th><th></th></tr></thead><tbody>
            {classification.map((row, index) => {
              const saved = row.result || {}; const driver = saved.driver || row.drivers || {}; const team = saved.team || row.teams || {}; const gridPosition = saved.gridPosition ?? saved.grid ?? '—'; const gridNumber = Number(gridPosition); const positionChange = Number.isFinite(gridNumber) ? gridNumber - Number(row.position) : 0; const time = saved.totalTime ?? row.total_time; const bestLap = saved.bestLap ?? row.best_lap; return <tr key={`${row.driver_id}-${index}`} className={index === 0 ? 'leader' : ''} style={{ '--team-color': team.color || '#d3202f' }}>
                <td className="position-cell"><span className="position-number">{row.position === 1 ? 'P1' : row.position}</span>{Number.isFinite(gridNumber) && <span className={`position-change ${positionChange > 0 ? 'up' : positionChange < 0 ? 'down' : 'same'}`} title={positionChange > 0 ? `${positionChange} place${positionChange === 1 ? '' : 's'} gained` : positionChange < 0 ? `${Math.abs(positionChange)} place${positionChange === -1 ? '' : 's'} lost` : 'No position change'}>{positionChange > 0 ? '▲' : positionChange < 0 ? '▼' : '→'}</span>}</td>
                <td><Link className="results-driver-link" to={`/drivers/${driver.id || row.driver_id}`} aria-label={driver.name || `Driver #${row.driver_id}`} title={driver.name || `Driver #${row.driver_id}`}><span className="driver-result"><span className="team-logo" title={team.name || 'Team'}>{team.logo_normal && <img src={team.logo_normal} alt="" />}</span><strong className={driver.code ? 'driver-code' : undefined}>{driver.code || driver.name?.trim().split(/\s+/).pop()?.toUpperCase() || 'DRIVER'}</strong></span></Link></td>
                <td>{gridPosition === '—' ? '—' : `P${gridPosition}`}</td><td><span className={`results-status ${row.retired ? 'is-retired' : ''}`}>{row.retired ? 'RETIRED' : row.status || 'FINISHED'}</span></td>
                <td>{row.laps_completed || saved.lapsCompleted || '—'}</td>
                <td>{time !== null && time !== undefined && Number.isFinite(Number(time)) ? formatTime(Number(time)) : '—'}</td>
                <td>{bestLap !== null && bestLap !== undefined && Number.isFinite(Number(bestLap)) ? formatTime(Number(bestLap)) : row.fastest_lap ? 'FASTEST LAP' : '—'}</td>
                <td className="results-points">{Number(row.points) || 0}</td>
                <td>{resultAwards(row).map(award => <span className="results-award" key={award}>{award}</span>)}</td>
                <td className="driver-grid-image-cell">{driverGridImage(row.drivers, activeWeekend.year) && <img className="driver-grid-image" src={driverGridImage(row.drivers, activeWeekend.year)} alt={`${driver.name || 'Driver'} grid image`} />}</td>
              </tr>
            })}
          </tbody></table></div>
          {!classification.length && <p className="muted results-no-classification">No drivers are saved for this session.</p>}
        </div>}
      </section>
    </>}
  </section>;
}
export function Grids() {
  const [tick, setT] = useState(0); const g = useQ(() => sb.from('grids').select('*,grid_entries(*,drivers(name),teams(name))').order('year', { ascending: false }), [tick]);
  const teams = useQ(() => sb.from('teams').select('*,cars(*)').order('name')); const drivers = useQ(() => sb.from('drivers').select('id,name').order('name')); const [f, setF] = useState({});
  const teamRows = teams.data || []; const driverRows = drivers.data || [];
  const add = async gid => {
    if (!f.driver || !f.car) return; const car = teamRows.flatMap(t => t.cars || []).find(c => c.id == f.car);
    if (!car) return alert('Choose a valid car.');
    const { error } = await sb.from('grid_entries').insert({ grid_id: gid, driver_id: f.driver, car_id: car.id, team_id: car.team_id }); if (error) alert(error.message + ' (sign in via /admin first)'); setT(t => t + 1)
  };
  const del = async id => { await sb.from('grid_entries').delete().eq('id', id); setT(t => t + 1) };
  return <><h2>Grids</h2><p className="muted">A grid is a set of driver and car pairings. Create grids in Admin, then fill them here (sign-in required to edit).</p>
    <QueryStatus query={g} empty="No grids yet." /><QueryStatus query={teams} empty="No teams or cars available." /><QueryStatus query={drivers} empty="No drivers available." />
    {(g.data || []).map(x => <div key={x.id} className="card wide"><h3>{x.name} <small>{x.year}</small></h3>
      <div className="f1-starting-grid">{Array.from({ length: Math.ceil((x.grid_entries || []).length / 2) }, (_, rowIndex) => {
        const rowEntries = (x.grid_entries || []).slice(rowIndex * 2, rowIndex * 2 + 2);
        return <div key={rowIndex} className="f1-grid-row">{rowEntries.map((e, sideIndex) => {
          const position = rowIndex * 2 + sideIndex;
          return <div key={e.id} className={`f1-grid-slot ${sideIndex === 0 ? 'pole-side' : 'off-side'}`}><span className="f1-grid-pos">P{position + 1}</span><span className="f1-grid-driver">{e.drivers?.name}</span><span className="f1-grid-team">{e.teams?.name}</span><button className="f1-grid-remove" onClick={() => del(e.id)} title="Remove">×</button></div>;
        })}</div>;
      })}</div>
      <div className="row"><select onChange={e => setF({ ...f, driver: e.target.value })}><option value="">Driver</option>{driverRows.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select onChange={e => setF({ ...f, car: e.target.value })}><option value="">Car</option>{teamRows.flatMap(t => (t.cars || []).map(c => <option key={c.id} value={c.id}>{t.name} {c.model} ({c.year})</option>))}</select>
        <button className="btn" onClick={() => add(x.id)}>Add to grid</button></div></div>)}</>
}
const DEFAULT_SETUP = { aero: 50, suspension: 50, tyreCare: 50 };
const DEFAULT_STRATEGY = { tyre: 'auto', stops: 'auto' };
const formatTime = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(3).padStart(6, '0')}` : '—';
const tyreLetter = compound => ({ soft: 'S', medium: 'M', hard: 'H', intermediate: 'I', wet: 'W' }[compound] || '—');
const ordinalPlace = value => `${value}${value % 100 >= 11 && value % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th')}`;

function getRaceGap(entry, leader) {
  if (!entry || !leader) return '—';
  if (entry.retired) return 'Out';
  if (entry.lapsCompleted < leader.lapsCompleted) return `+${leader.lapsCompleted - entry.lapsCompleted} Lap`;
  if (String(entry.driver?.id) === String(leader.driver?.id)) return 'Leader';
  return `+${(entry.totalTime - leader.totalTime).toFixed(3)}`;
}

function TowerRow({ entry, index, leader, selected, focused, onSelect }) {
  const gap = getRaceGap(entry, leader);
  const code = entry.driver?.code || entry.driver?.name?.trim().split(/\s+/).pop()?.toUpperCase() || '—';
  const compound = entry.tyre?.compound;
  return <button type="button" className={`timing-tower-row${selected ? ' selected' : ''}${focused ? ' battle-target' : ''}${entry.retired ? ' retired' : ''}`}
    style={{ '--team-color': entry.team?.color || '#d3202f' }} aria-pressed={selected}
    aria-label={`Position ${index + 1}, ${entry.driver?.name || 'driver'}, ${gap}`}
    onClick={onSelect}>
    <span className="timing-tower-position">{entry.retired ? 'OUT' : index + 1}</span>
    <span className="timing-tower-team">{entry.team?.logo_normal
      ? <img className={entry.team?.name?.toLowerCase().includes('red bull') ? 'mirror-logo' : ''} src={entry.team.logo_normal} alt={`${entry.team?.name || 'Team'} logo`} />
      : <small>{entry.team?.name?.slice(0, 3).toUpperCase() || 'F1'}</small>}</span>
    <strong className="timing-tower-code">{code}</strong>
    <span className={`timing-tower-gap${gap === 'Leader' ? ' leader-gap' : ''}${entry.retired ? ' out-gap' : ''}`}>{gap}</span>
    <span className={`timing-tower-tyre ${compound || ''}`} aria-label={compound ? `${compound} tyres` : 'Tyre compound unavailable'} title={compound ? `${compound} tyres` : 'Tyre compound unavailable'}>{tyreLetter(compound)}</span>
  </button>;
}

function BattleCard({ ahead, behind, position, gap }) {
  const stripe = (entry, label, fallbackPosition) => <div className={`timing-battle-driver${entry ? '' : ' unavailable'}`} aria-label={entry ? `${label}: ${entry.driver?.name || 'Driver'}` : `${label}: no car`}>
    <span className="timing-battle-position">{entry ? fallbackPosition : '—'}</span>
    <span className="timing-battle-team" style={{ '--team-color': entry?.team?.color || '#555' }}>
      {entry?.team?.logo_normal && <img className={entry.team?.name?.toLowerCase().includes('red bull') ? 'mirror-logo' : ''} src={entry.team.logo_normal} alt={`${entry.team?.name || 'Team'} logo`} />}
    </span>
    <strong>{entry?.driver?.code || entry?.driver?.name || 'NO CAR'}</strong>
  </div>;
  return <section className="timing-battle" aria-label={`Battle for ${ordinalPlace(position)}`}>
    <div className="timing-battle-divider" />
    <h4>BATTLE FOR {ordinalPlace(position)}</h4>
    {stripe(ahead, 'Ahead', position - 1)}
    <div className="timing-battle-gap" aria-label={`Gap to car ahead: ${gap}`}>{gap}</div>
    {stripe(behind, 'Behind', position + 1)}
  </section>;
}

function TimingTower({ entries, lap, totalLaps, selectedDriverId, defaultFocusIndex, onSelect }) {
  const leader = entries[0];
  const focusIndex = entries.findIndex(entry => String(entry.driver?.id) === String(selectedDriverId));
  const activeFocusIndex = focusIndex >= 0 ? focusIndex : defaultFocusIndex;
  const focusedEntry = entries[activeFocusIndex];
  const ahead = activeFocusIndex > 0 ? entries[activeFocusIndex - 1] : null;
  const behind = activeFocusIndex >= 0 && activeFocusIndex < entries.length - 1 ? entries[activeFocusIndex + 1] : null;
  const adjacent = ahead || behind;
  const battleGap = focusedEntry && adjacent
    ? focusedEntry.lapsCompleted !== adjacent.lapsCompleted
      ? `+${Math.abs(focusedEntry.lapsCompleted - adjacent.lapsCompleted)} Lap`
      : `+${Math.abs(focusedEntry.totalTime - adjacent.totalTime).toFixed(3)}`
    : '—';
  return <aside className="timing-tower" aria-label="Race live timing tower">
    <header className="timing-tower-header">
      <div className="timing-tower-brand"><span className="timing-tower-mark" aria-label="F1">F1</span><strong>RACE</strong></div>
      <div className="timing-tower-lap"><em>LAP</em><span className="timing-tower-current-lap">{lap}</span><em>/{totalLaps}</em></div>
    </header>
    <div className="timing-tower-rows">
      {entries.map((entry, index) => {
        return <div className="timing-tower-item" key={entry.driver?.id}>
          <TowerRow entry={entry} index={index} leader={leader} selected={String(entry.driver?.id) === String(selectedDriverId)}
            focused={index === activeFocusIndex} onSelect={() => onSelect(entry.driver?.id)} />
        </div>;
      })}
    </div>
    {focusedEntry && <BattleCard ahead={ahead} behind={behind} position={activeFocusIndex + 1} gap={battleGap} />}
  </aside>;
}

function DriverStage({ entry, car, opponent, position, raceState, pitCompound, pitLap, pitFeedback,
  onPitCompound, onPitLap, onPitCommand, onBoost, onClose, boostDisabled, boostLabel }) {
  if (!entry || !car) return <section className="driver-stage"><p>No driver telemetry available.</p></section>;
  const incidents = car.events.filter(event => event.type !== 'overtake' && event.type !== 'attack_defended');
  const laps = entry.lapHistory || [];
  const opponentLaps = opponent?.lapHistory || [];
  const lastFour = laps.slice(-4);
  const opponentRelation = position === 1 ? 'car behind' : 'car ahead';
  return <section className="driver-stage" aria-label={`${entry.driver?.name || 'Driver'} timing and telemetry`}>
    <header className="driver-stage-header" style={{ '--team-color': entry.team?.color || '#d3202f' }}>
      <div className="driver-stage-identity">
        {entry.team?.logo_normal && <img src={entry.team.logo_normal} alt={`${entry.team.name || 'Team'} logo`} />}
        <div><p>{entry.team?.name || 'Team'} · P{position}</p><h3>{entry.driver?.name || 'Driver'}</h3></div>
      </div>
      <div className="driver-stage-status"><strong>{tyreLetter(entry.tyre?.compound)} · {entry.tyre?.compound?.toUpperCase() || 'NO TYRE'}</strong><span>{entry.tyre?.age ?? '—'} laps on tyre</span></div>
      <button type="button" className="driver-stage-close" onClick={onClose} aria-label="Clear selected driver">×</button>
    </header>
    <div className="driver-stage-metrics" aria-label="Selected driver telemetry">
      <div><span>Fuel</span><strong>{car.fuelRemaining.toFixed(1)} kg</strong></div>
      <div><span>Damage</span><strong>{(car.damage * 100).toFixed(0)}%</strong></div>
      <div><span>Tyre wear</span><strong>{car.tyre.wear.toFixed(1)}%</strong></div>
      <div><span>Grip</span><strong>{(car.tyre.grip * 100).toFixed(0)}%</strong></div>
      <div><span>Pit stops</span><strong>{car.pitStops}</strong></div>
    </div>
    <div className="driver-stage-actions">
      <div className="driver-stage-pit-inputs">
        <label>Next tyre<select value={pitCompound} onChange={event => onPitCompound(event.target.value)}>{['soft', 'medium', 'hard', 'intermediate', 'wet'].map(compound => <option key={compound} value={compound}>{compound.toUpperCase()}</option>)}</select></label>
        <label>Pit lap<input type="number" min={raceState.lap + 1} max={raceState.totalLaps - 1} value={pitLap} onChange={event => onPitLap(Number(event.target.value))} /></label>
      </div>
      <div className="driver-stage-command-buttons">
        <button type="button" onClick={() => onPitCommand('pit_this_lap')} disabled={car.retired || car.completed || raceState.done}>Pit now</button>
        <button type="button" onClick={() => onPitCommand('pit_next_lap')} disabled={car.retired || car.completed || raceState.done}>Pit next lap</button>
        <button type="button" onClick={() => onPitCommand('planned_stop')} disabled={car.retired || car.completed || raceState.done}>Schedule lap {Math.max(pitLap, raceState.lap + 1)}</button>
        <button type="button" onClick={() => onPitCommand('set_compound')} disabled={car.retired || car.completed || raceState.done}>Set next tyre</button>
        <button type="button" onClick={() => onPitCommand('stay_out')} disabled={car.retired || car.completed || raceState.done}>Stay out</button>
        <button type="button" onClick={() => onPitCommand('auto')} disabled={car.retired || car.completed || raceState.done}>Auto strategy</button>
        <button type="button" onClick={() => onPitCommand('cancel')} disabled={car.retired || car.completed || raceState.done}>Cancel command</button>
        <button type="button" className="driver-stage-boost" onClick={() => onBoost(entry.driver.id)} disabled={boostDisabled}>{boostLabel}</button>
      </div>
      {pitFeedback && <p className="driver-stage-feedback" role="status">{pitFeedback}</p>}
    </div>
    <section className="driver-last-laps">
      <div className="driver-stage-section-heading"><h4>Last 4 laps</h4><span>{opponent ? `vs ${opponent.driver?.code || opponent.driver?.name} · ${opponentRelation}` : 'No adjacent car'}</span></div>
      <div className="driver-lap-strip">{[...lastFour].reverse().map(lap => {
        const otherLap = opponentLaps.find(item => item.lap === lap.lap);
        const delta = otherLap ? lap.time - otherLap.time : null;
        return <div className="driver-lap-cell" key={lap.lap}><small>L{lap.lap}</small><strong>{formatTime(lap.time)}</strong>
          <span className={delta === null ? '' : delta < 0 ? 'faster' : delta > 0 ? 'slower' : 'same'}>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(3)}`}</span></div>;
      })}{!lastFour.length && <p>No completed laps yet.</p>}</div>
    </section>
    <div className="driver-stage-lower">
      <section><h4>Incidents</h4>{incidents.length
        ? [...incidents].reverse().map((event, index) => <p key={`${event.type}-${index}`}><strong>Lap {event.lap}</strong> · {event.type.replaceAll('_', ' ')}</p>)
        : <p>No incidents recorded.</p>}</section>
      <section><h4>Pit history</h4>{car.pitHistory.length
        ? [...car.pitHistory].reverse().map((pit, index) => <p key={`${pit.lap}-${index}`}>Lap {pit.lap}: {pit.from.toUpperCase()} → {pit.to.toUpperCase()} · +{pit.timeLoss.toFixed(1)} sec{pit.stages?.length ? ` (${pit.stages.map(stage => `${stage.phase.replaceAll('_', ' ')} ${stage.seconds.toFixed(1)}s`).join(' → ')})` : ''}</p>)
        : <p>No pit stops recorded.</p>}</section>
    </div>
    <details className="driver-stage-details">
      <summary>Full driver telemetry</summary>
      <div className="driver-detail-facts">
        <span>Tyre status <strong>{car.tyre.state.toUpperCase()} · {car.tyre.remainingCompetitiveLaps?.toFixed(1) ?? '—'} laps to limit</strong></span>
        <span>Position <strong>P{position}</strong></span>
        <span>Command <strong>{car.pitStatus}</strong></span>
        {car.mechanicalFault && <span>Vehicle fault <strong>{car.mechanicalFault.replaceAll('_', ' ')}</strong></span>}
        {car.retired && <span>Retirement <strong>Lap {car.retirementLap} · {car.retirementReason}</strong></span>}
      </div>
      <section className="driver-recent-laps"><h4>Recent laps</h4>
        {laps.slice(-8).reverse().map(lap => <p key={lap.lap}>Lap {lap.lap}: {formatTime(lap.time)} · {lap.tyre.toUpperCase()} ({lap.tyreAge}) · {lap.fuel.toFixed(1)} kg</p>)}
      </section>
    </details>
  </section>;
}

function seasonSnapshots(rows = []) {
  const events = new Map();
  for (const row of rows) {
    const key = String(row.race_id), race = events.get(key) || {
      raceId: row.race_id, round: row.races?.round || 0, raceName: row.races?.name || 'Race',
      raceResults: [], sprintResults: [], qualifyingResults: []
    };
    const saved = row.result || {};
    const record = {
      driver: saved.driver || row.drivers,
      team: saved.team || row.teams,
      position: row.position,
      points: Number(row.points) || 0
    };
    if (row.session_type === 'sprint') race.sprintResults.push(record);
    if (row.session_type === 'race') race.raceResults.push(record);
    if (row.session_type === 'qualifying') race.qualifyingResults.push({ ...record, polePosition: row.pole_position });
    events.set(key, race);
  }
  return [...events.values()];
}
const resultOrder = (a, b) => (Number(b.races?.year || b.grids?.year) || 0) - (Number(a.races?.year || a.grids?.year) || 0) || (Number(b.races?.round) || 0) - (Number(a.races?.round) || 0) - Number(a.session_type === 'race') + Number(b.session_type === 'race');
const SESSION_ORDER = ['practice1', 'practice2', 'practice3', 'sprintQualifying', 'sprint', 'qualifying', 'race'];
function groupRaceWeekends(rows = []) {
  const weekends = new Map();
  for (const row of rows) {
    const key = `${row.grid_id}:${row.race_id}`;
    let weekend = weekends.get(key);
    if (!weekend) {
      weekend = { key, raceId: row.race_id, year: Number(row.races?.year || row.grids?.year) || 0, round: Number(row.races?.round) || 0, raceName: row.races?.name || 'Race', sessions: new Map(), pointsTotal: 0 };
      weekends.set(key, weekend);
    }
    const session = weekend.sessions.get(row.session_type) || [];
    session.push(row);
    weekend.sessions.set(row.session_type, session);
    weekend.pointsTotal += Number(row.points) || 0;
  }
  return [...weekends.values()].map(weekend => ({
    ...weekend,
    sessions: [...weekend.sessions].sort(([a], [b]) => (SESSION_ORDER.indexOf(a) < 0 ? Infinity : SESSION_ORDER.indexOf(a)) - (SESSION_ORDER.indexOf(b) < 0 ? Infinity : SESSION_ORDER.indexOf(b))).map(([session_type, rows]) => ({ session_type, rows }))
  })).sort((a, b) => b.year - a.year || b.round - a.round);
}
export function Simulate() {
  const grids = useQ(() => sb.from('grids').select('id,name,year').order('year', { ascending: false }));
  const [gid, setG] = useState(''); const [rid, setR] = useState(''); const [phaseIndex, setPhaseIndex] = useState(0);
  const [simulationTab, setSimulationTab] = useState('weekend');
  const [weekendStarted, setWeekendStarted] = useState(false); const [weekendComplete, setWeekendComplete] = useState(false);
  const [results, setResults] = useState({}); const [setups, setSetups] = useState({}); const [strategies, setStrategies] = useState({}); const [performanceBoosts, setPerformanceBoosts] = useState({}); const [driverPerformanceBoosts, setDriverPerformanceBoosts] = useState({}); const [strategyEnabled, setStrategyEnabled] = useState(false); const [garageSetupEnabled, setGarageSetupEnabled] = useState(false);
  const [qualifyingSimulation, setQualifyingSimulation] = useState(null); const [qualifyingSpeed, setQualifyingSpeed] = useState(1);
  const [qualifyingRunPlans,setQualifyingRunPlans]=useState({});
  const [reserveDriversEnabled, setReserveDriversEnabled] = useState(false);
  const [practiceSubstitutions, setPracticeSubstitutions] = useState({});
  const [resultSaveError, setResultSaveError] = useState(''); const [resultSaveFailed, setResultSaveFailed] = useState(false); const [resultSaveSaving, setResultSaveSaving] = useState(false); const [resultSaveNeedsAuth, setResultSaveNeedsAuth] = useState(false); const [resultSaveSuccess, setResultSaveSuccess] = useState('');
  const [raceState, setRaceState] = useState(null); const [isRunning, setIsRunning] = useState(false); const [raceViewTab, setRaceViewTab] = useState('timing'); const [raceTeamAdjustments, setRaceTeamAdjustments] = useState({}); const [simulationSpeed, setSimulationSpeed] = useState(1); const [weatherMode, setWeatherMode] = useState('dry'); const [selectedDriverId, setSelectedDriverId] = useState(null); const [pitCompound, setPitCompound] = useState('medium'); const [pitLap, setPitLap] = useState(1); const [pitFeedback, setPitFeedback] = useState(''); const [boostFeedback, setBoostFeedback] = useState('');
  const [nextRaceNotice, setNextRaceNotice] = useState('');
  const completedRaceRef = useRef(null);
  const resultSaveQueueRef = useRef([]);
  const resultSaveInFlightRef = useRef(false);
  const activeSetups = garageSetupEnabled ? setups : {};
  const tyreImagesQuery = useQ(() => sb.from('tyre_images').select('compound,image_url'));
  const tyreImages = Object.fromEntries((tyreImagesQuery.data || []).map(item => [item.compound, item.image_url]));
  const grid = grids.data?.find(g => String(g.id) === gid);
  const races = useQ(() => grid ? sb.from('races').select('*').eq('year', grid.year).order('round') : Promise.resolve({ data: [], error: null }), [grid?.year]);
  const practiceLineups = useQ(() => grid ? sb.from('team_driver_lineups').select('team_id,reserve_driver_id').eq('year', grid.year) : Promise.resolve({ data: [], error: null }), [grid?.year]);
  const reserveDriverIds = [...new Set((practiceLineups.data || []).map(lineup => lineup.reserve_driver_id).filter(Boolean).map(String))].sort();
  const reserveDriverKey = reserveDriverIds.join(',');
  const reserveDriversQuery = useQ(() => reserveDriverIds.length ? sb.from('drivers').select('*,driver_ratings(*),driver_images(*)').in('id', reserveDriverIds) : Promise.resolve([]), [reserveDriverKey]);
  const seasonResultsQuery = useQ(() => grid ? loadSeasonResults(grid.id) : Promise.resolve({ data: [], error: null }), [grid?.id]);
  const selectedRace = races.data?.find(r => String(r.id) === rid);
  const entriesQuery = useQ(() => gid ? sb.from('grid_entries').select('*,drivers(*,driver_ratings(*),driver_images(*)),teams(*),cars(*)').eq('grid_id', gid) : Promise.resolve({ data: [], error: null }), [gid]);
  const entries = (entriesQuery.data || []).filter(e => e.drivers && e.teams && e.cars).map(e => ({
    driver: e.drivers, team: e.teams, d: one(e.drivers.driver_ratings) || {}, c: e.cars
  }));
  const performanceEntries = applyDriverPerformanceBoosts(applyTeamPerformanceBoosts(entries, performanceBoosts), driverPerformanceBoosts);
  const practiceEntries = applyPracticeSubstitutions(performanceEntries, practiceLineups.data || [], reserveDriversQuery.data || [], reserveDriversEnabled ? practiceSubstitutions : {});
  const phases = getWeekendPhases(selectedRace || {});
  const seasonKey = grid ? `${grid.id}:${grid.year}` : '';
  const savedSeason = seasonSnapshots((seasonResultsQuery.data || []).filter(row => String(row.grid_id) === String(grid?.id)));
  const seasonRacesCompleted = Boolean(grid && races.data?.length && races.data.every(race => savedSeason.some(result => String(result.raceId) === String(race.id) && result.raceResults.length > 0)));
  const upcomingRace = races.data?.find(race => Number(race.year) === Number(grid?.year) && !savedSeason.some(result => String(result.raceId) === String(race.id) && result.raceResults.length > 0));
  const seasonStandings = calculateStandings(savedSeason, entries);
  const seasonDriverById = new Map(entries.map(entry => [String(entry.driver.id), entry.driver]));
  const phase = phases[Math.min(phaseIndex, phases.length - 1)];
  const mandatoryDryTyreCompounds = requiresMandatoryDryTyreCompounds(selectedRace || {}, phase === 'race' ? 'race' : 'sprint', weatherMode);
  const racePhase = phase === 'sprint' ? 'sprint' : phase === 'race' ? 'race' : null;
  const phaseResult = results[phase] || ((racePhase && raceState?.format === racePhase) ? getClassification(raceState) : null);
  const currentQualifying = qualifyingSimulation?.phase === phase ? qualifyingSimulation : null;
  const qualifyingViewIndex = Math.min(currentQualifying?.viewIndex??currentQualifying?.sessionIndex??0,(currentQualifying?.sessions.length||1)-1);
  const qualifyingSession = currentQualifying?.sessions[qualifyingViewIndex] || null;
  const qualifyingSessionIsCurrent = Boolean(currentQualifying&&qualifyingViewIndex===currentQualifying.sessionIndex);
  const qualifyingElapsed = currentQualifying&&qualifyingSessionIsCurrent?currentQualifying.elapsed:qualifyingSession?.duration||0;
  const qualifyingEvents = qualifyingSession?.timeline.filter(event => event.t <= qualifyingElapsed) || [];
  const qualifyingWeather = [...qualifyingEvents].reverse().find(event=>event.type==='weatherChange')?.weather||qualifyingSession?.weather;
  const qualifyingLiveRows = qualifyingSession ? (() => {
    const rows = new Map(qualifyingSession.standings.map(row => [String(row.driver?.id), {
      ...row,bestLap:Infinity,lastLap:null,sectors:[],currentSectors:[],tyreCompound:row.tyreCompound,currentStatus:'In pit'
    }]));
    for (const event of qualifyingEvents) {
      const row = rows.get(String(event.driverId));
      if (!row) continue;
      if (event.type === 'pitExit') { row.currentStatus = 'Out lap'; row.tyreCompound = event.tyreCompound || row.tyreCompound; }
      if (event.type === 'lapStart') { row.currentStatus = 'Flying lap'; row.currentSectors=[]; row.tyreCompound = event.tyreCompound || row.tyreCompound; }
      if (event.type === 'sectorComplete') row.currentSectors[event.sector-1]=event.sectorTime;
      if (event.type === 'lapComplete') {
        row.currentStatus = 'In lap'; row.lastLap = event.lapTime;
        const sectors = event.sectors.map(sector => sector.time);
        row.currentSectors=sectors;
        if (!Number.isFinite(row.bestLap) || event.lapTime < row.bestLap) { row.bestLap = event.lapTime; row.sectors = sectors; }
      }
      if (event.type === 'invalidLap') { row.currentStatus = 'In lap'; row.lastLap = event.lapTime; }
      if (event.type === 'pitEntry') row.currentStatus = 'In pit';
    }
    return [...rows.values()].sort((a,b) => Number.isFinite(a.bestLap) !== Number.isFinite(b.bestLap)
      ? (Number.isFinite(a.bestLap) ? -1 : 1)
      : a.bestLap - b.bestLap || String(a.driver?.id).localeCompare(String(b.driver?.id)));
  })() : [];
  const qualifyingFastestSectors = [0,1,2].map(index => Math.min(...qualifyingEvents.flatMap(event =>
    event.type==='sectorComplete'&&event.sector-1===index?[event.sectorTime]
      :event.type==='lapComplete'?[event.sectors[index]?.time]:[]
  ).filter(Number.isFinite)));
  const fastestSessionLap = phaseResult ? Math.min(...phaseResult.map(entry => entry.bestLap).filter(Number.isFinite)) : Infinity;
  const stageEntry = phaseResult?.find(entry => String(entry.driver.id) === String(selectedDriverId)) || phaseResult?.[0] || null;
  const stagePosition = stageEntry ? phaseResult.findIndex(entry => String(entry.driver.id) === String(stageEntry.driver.id)) + 1 : 0;
  const stageOpponent = stagePosition > 1 ? phaseResult[stagePosition - 2] : phaseResult?.[1] || null;
  const selectedCar = raceState?.cars.find(car => String(car.driverId) === String(stageEntry?.driver.id));
  const teams = [...new Map(entries.map(e => [e.team.id, e.team])).values()];
  const practiceSubstitutionOptions = teams.map(team => {
    const lineup = practiceLineups.data?.find(item => String(item.team_id) === String(team.id));
    const reserve = (reserveDriversQuery.data || []).find(driver => String(driver.id) === String(lineup?.reserve_driver_id));
    const targetId = practiceSubstitutions[team.id] || '';
    const reserveAlreadyEntered = Boolean(reserve && entries.some(entry => String(entry.driver.id) === String(reserve.id)));
    return { team, lineup, reserve, targetId, reserveAlreadyEntered, drivers: entries.filter(entry => String(entry.team.id) === String(team.id)) };
  });
  const saveResults = async () => {
    if (resultSaveInFlightRef.current || !resultSaveQueueRef.current.length) return;
    resultSaveInFlightRef.current = true;
    setResultSaveSaving(true);
    let needsAuth = false;
    try {
      const { data: authData, error: authError } = await sb.auth.getSession();
      if (authError) throw authError;
      if (!authData.session) {
        needsAuth = true;
        throw new Error('Sign in through Admin before saving results. Your unsaved session results are still queued; sign in, then retry here.');
      }
      while (resultSaveQueueRef.current.length) {
        const pending = resultSaveQueueRef.current[0];
        const { data, error } = await sb.from('race_results')
          .upsert(pending.records, { onConflict: 'grid_id,race_id,session_type,driver_id' })
          .select('driver_id');
        if (error) throw error;
        if ((data || []).length !== pending.records.length) {
          throw new Error(`Supabase confirmed ${data?.length || 0} of ${pending.records.length} session results. The batch was kept for retry.`);
        }
        resultSaveQueueRef.current.shift();
        setResultSaveSuccess(`Saved ${pending.sessionLabel} results to Supabase.`);
        if (String(grid?.id) === String(pending.gridId)) seasonResultsQuery.retry();
        if (String(grid?.id) === String(pending.gridId) && pending.sessionType === 'race') {
          const raceIndex = races.data?.findIndex(race => String(race.id) === String(pending.raceId)) ?? -1;
          const nextRace = raceIndex >= 0 ? races.data[raceIndex + 1] : null;
          setNextRaceNotice(nextRace ? `Round ${pending.round} complete. Round ${nextRace.round}: ${nextRace.name} is ready.` : 'Season complete. Final standings are shown above.');
        }
      }
      setResultSaveError(''); setResultSaveFailed(false); setResultSaveNeedsAuth(false);
    } catch (error) {
      console.error('Could not save race results to Supabase:', error);
      const message = error.message || String(error);
      needsAuth = needsAuth || error.code === '42501' || /row-level security|permission denied/i.test(message);
      setResultSaveFailed(true);
      setResultSaveNeedsAuth(needsAuth);
      const pending = resultSaveQueueRef.current[0];
      setResultSaveError(`Could not save ${pending?.sessionLabel || 'session'} results to Supabase: ${message}${resultSaveQueueRef.current.length > 1 ? ` ${resultSaveQueueRef.current.length} session save(s) remain queued.` : ''}`);
    } finally {
      resultSaveInFlightRef.current = false;
      setResultSaveSaving(false);
    }
  };
  const enqueueResults = (pending) => {
    resultSaveQueueRef.current.push(pending);
    setResultSaveFailed(false);
    setResultSaveNeedsAuth(false);
    setResultSaveSuccess('');
    setResultSaveError('');
    void saveResults();
  };
  const persistPhaseResults = (sessionPhase,rows) => {
    const completedSessions = { ...results, [sessionPhase]: rows };
    phases.slice(phaseIndex + 1).forEach(name => delete completedSessions[name]);
    setResults(completedSessions);
    if (selectedRace && grid) {
      const awards = getWeekendAwards(phases, completedSessions, []);
      enqueueResults({
        gridId: grid.id, sessionType: sessionPhase, sessionLabel: sessionLabel(sessionPhase), raceId: selectedRace.id, round: selectedRace.round,
        records: buildResultRecords(grid, selectedRace, sessionPhase, rows, awards)
      });
    }
    setRaceState(null); setIsRunning(false); setWeekendComplete(false);
  };
  const selectRace = raceId => {
    setNextRaceNotice('');
    setR(raceId ? String(raceId) : '');
    setWeekendStarted(false);
    setWeekendComplete(false);
    setResults({});
    setQualifyingSimulation(null);
    setRaceState(null);
    setIsRunning(false);
    setPhaseIndex(0);
    setPracticeSubstitutions({});
  };
  useEffect(() => {
    if (simulationTab !== 'weekend' || !grid || races.loading || seasonResultsQuery.loading || rid || !races.data) return;
    if (upcomingRace) selectRace(upcomingRace.id);
  }, [simulationTab, grid?.id, races.loading, races.data, seasonResultsQuery.loading, seasonResultsQuery.data, rid]);
  useEffect(() => { setR(''); setWeekendStarted(false); setWeekendComplete(false); setPhaseIndex(0); setResults({}); setQualifyingSimulation(null); setRaceState(null); setIsRunning(false); setPracticeSubstitutions({}) }, [gid]);
  useEffect(() => {
    if (!isRunning || !raceState || raceState.done) return;
    const timer = window.setInterval(() => setRaceState(current => current ? advanceRaceIfRunning(current, true) : current), Math.max(100, 1000 / simulationSpeed));
    return () => window.clearInterval(timer);
  }, [isRunning, raceState?.done, simulationSpeed]);
  useEffect(() => {
    if (!qualifyingSimulation?.playing) return;
    const timer = window.setInterval(() => setQualifyingSimulation(current => {
      if (!current?.playing) return current;
      const session = current.sessions[current.sessionIndex];
      const elapsed = Math.min(session.duration,current.elapsed+current.speed*0.1);
      return {...current,elapsed,playing:elapsed<session.duration};
    }),100);
    return () => window.clearInterval(timer);
  }, [qualifyingSimulation?.playing,qualifyingSimulation?.sessionIndex,qualifyingSimulation?.speed,qualifyingSimulation?.sessions]);
  useEffect(() => {
    if (!raceState?.done) return;
    const resultKey = raceState.format === 'sprint' ? 'sprint' : 'race';
    const classification = getClassification(raceState);
    setIsRunning(false);
    const completedSessions = { ...results, [resultKey]: classification };
    setResults(completedSessions);
    if (!selectedRace || !grid) return;
    const completionKey = `${grid.id}:${selectedRace.id}:${resultKey}`;
    if (completedRaceRef.current === completionKey) return;
    completedRaceRef.current = completionKey;
    const awards = getWeekendAwards(phases, completedSessions, resultKey === 'race' ? classification : []);
    enqueueResults({
      gridId: grid.id, sessionType: resultKey, sessionLabel: sessionLabel(resultKey), raceId: selectedRace.id, round: selectedRace.round,
      records: buildResultRecords(grid, selectedRace, resultKey, classification, awards)
    });
  }, [raceState?.done]);
  useEffect(() => { if (selectedDriverId !== null) { setPitLap(current => current <= raceState?.lap ? ((raceState?.lap || 0) + 1) : current); setPitFeedback('') } }, [selectedDriverId]);
  const updateTeam = (setter, id, key, value) => setter(current => ({ ...current, [id]: { ...current[id], [key]: value } }));
  const startWeekend = () => {
    if (resultSaveInFlightRef.current || resultSaveQueueRef.current.length) {
      setResultSaveError('Wait for queued results to save, or retry the pending save, before restarting the weekend.');
      return;
    }
    setNextRaceNotice(''); setResultSaveError(''); setResultSaveFailed(false); setResultSaveNeedsAuth(false); setResultSaveSuccess(''); setBoostFeedback(''); setWeekendStarted(true); setWeekendComplete(false); setPhaseIndex(0); setResults({}); setQualifyingSimulation(null); setRaceState(null)
  };
  const resetSeasonStandings = async () => {
    if (!grid || !window.confirm(`Delete all saved simulated results for ${grid.name} (${grid.year}) from Supabase? This cannot be undone.`)) return;
    try {
      const { data, error } = await sb.from('race_results').delete().eq('grid_id', grid.id).select('race_id');
      if (error) throw error;
      if (seasonResultsQuery.data?.length && !data?.length) throw new Error('No rows were deleted. Sign in with an authorized Supabase account and try again.');
    } catch (error) { console.error('Could not reset saved season results:', error); setResultSaveFailed(false); setResultSaveError(`Season results could not be reset: ${error.message || String(error)}`); return }
    setResultSaveError(''); setResultSaveFailed(false); seasonResultsQuery.retry();
    completedRaceRef.current = null; setWeekendStarted(false); setWeekendComplete(false); setPhaseIndex(0); setResults({}); setRaceState(null); setIsRunning(false); setSelectedDriverId(null);
    setNextRaceNotice(`${grid.year} standings reset. Select any race in this season to simulate it again.`);
  };
  const runPhase = () => {
    if (entries.length < 2) return alert('Add at least 2 complete driver and car entries to this grid.');
    if (phase === 'race' || phase === 'sprint') {
      completedRaceRef.current = null;
      const gridKey = phase === 'sprint' ? 'sprintQualifying' : 'qualifying';
      const useSprintGrid = phase === 'race' && selectedRace?.sprint_affects_grand_prix_grid;
      const sourceKey = useSprintGrid ? 'sprint' : gridKey;
      const startRows = results[sourceKey]?.map((entry, index) => ({
        ...entry,
        grid: sourceKey === 'sprint' ? (entry.position || entry.pos || index + 1) : entry.grid
      }));
      if (!startRows?.length) return alert(`Complete ${PHASE_LABELS[sourceKey] || sourceKey} before starting this session.`);
      if (phase === 'race') completedRaceRef.current = null;
      const isSprint = phase === 'sprint';
      const raceLaps = Number(selectedRace.laps) || 57;
      const state = createRaceState({
        entries: applyDriverPerformanceBoosts(applyTeamPerformanceBoosts(startRows, performanceBoosts), driverPerformanceBoosts), race: selectedRace, format: isSprint ? 'sprint' : 'race',
        strategies: strategyEnabled ? strategies : {}, setups: activeSetups, weather: weatherMode, laps: isSprint ? Math.max(1, Math.round(raceLaps * 0.32)) : raceLaps
      });
      setRaceState(state); setRaceViewTab('timing'); setRaceTeamAdjustments({}); setBoostFeedback(''); setIsRunning(true); setWeekendComplete(false);
      return;
    }
    if (phase === 'qualifying' || phase === 'sprintQualifying') {
      const seed = newQualifyingSeed();
      const simulation = simulateQualifyingWeekend(performanceEntries,{
        race:selectedRace,setups:activeSetups,weather:weatherMode,seed,
        sprint:phase==='sprintQualifying',
        teamStrategies:Object.fromEntries(teams.filter(team=>qualifyingRunPlans[team.id]).map(team=>[team.id,{qualifyingRuns:qualifyingRunPlans[team.id]}]))
      });
      setQualifyingSimulation({...simulation,phase,sessionIndex:0,viewIndex:0,elapsed:0,playing:true,speed:qualifyingSpeed});
      setRaceState(null);setIsRunning(false);setWeekendComplete(false);
      return;
    }
    let rows;
    if (phase.startsWith('practice')) rows = practice(practiceEntries, { race: selectedRace, setups: activeSetups, weather: weatherMode });
    persistPhaseResults(phase,rows);
  };
  const skipQualifying = () => {
    const simulation=currentQualifying||simulateQualifyingWeekend(performanceEntries,{
      race:selectedRace,setups:activeSetups,weather:weatherMode,seed:newQualifyingSeed(),
      sprint:phase==='sprintQualifying',
      teamStrategies:Object.fromEntries(teams.filter(team=>qualifyingRunPlans[team.id]).map(team=>[team.id,{qualifyingRuns:qualifyingRunPlans[team.id]}]))
    });
    setQualifyingSimulation(null);
    persistPhaseResults(phase,simulation.results);
  };
  const continueQualifying = () => {
    if (!currentQualifying) return;
    if (currentQualifying.sessionIndex<currentQualifying.sessions.length-1) {
      setQualifyingSimulation(current=>({...current,sessionIndex:current.sessionIndex+1,viewIndex:current.sessionIndex+1,elapsed:0,playing:true}));
      return;
    }
    setQualifyingSimulation(null);
    persistPhaseResults(phase,currentQualifying.results);
  };
  const advance = () => { setQualifyingSimulation(null); if (phaseIndex < phases.length - 1) setPhaseIndex(i => i + 1); else setWeekendComplete(true) };
  const issuePitCommand = (command) => {
    if (!raceState || !selectedCar) return;
    try {
      const next = setPitInstruction(raceState, selectedCar.driverId, command, { compound: pitCompound, targetLap: Math.max(pitLap, raceState.lap + 1) });
      setRaceState(next); setPitFeedback(next.cars.find(car => String(car.driverId) === String(selectedCar.driverId)).pitStatus);
    } catch (error) { setPitFeedback(error instanceof Error ? error.message : String(error)) }
  };
  const issueDriverBoost = (driverId) => {
    if (!raceState) return;
    try {
      const next = activateDriverBoost(raceState, driverId);
      setRaceState(next);
      const driver = next.cars.find(car => String(car.driverId) === String(driverId))?.entry.driver.name || 'Driver';
      setBoostFeedback(`${driver} boost armed for lap ${next.lap + 1}. Stronger pace for one lap; one-lap cooldown afterward.`);
    } catch (error) { setBoostFeedback(error instanceof Error ? error.message : String(error)) }
  };
  const adjustLiveTeam = (teamId, key, rawValue) => {
    const adjustments = { ...raceTeamAdjustments[String(teamId)], [key]: Number(rawValue) };
    setRaceTeamAdjustments(current => ({ ...current, [String(teamId)]: adjustments }));
    setRaceState(current => current && !current.done ? setTeamRaceAdjustments(current, teamId, adjustments) : current);
  };
  const setSetup = (id, key, value) => updateTeam(setSetups, id, key, value);
  const setStrategy = (id, key, value) => updateTeam(setStrategies, id, key, value);
  const setPerformanceBoost = (id, value) => setPerformanceBoosts(current => ({ ...current, [String(id)]: Math.max(0, Math.min(20, Number(value) || 0)) }));
  const setDriverPerformanceBoost = (id, value) => setDriverPerformanceBoosts(current => ({ ...current, [String(id)]: Math.max(0, Math.min(20, Number(value) || 0)) }));
  const isQualifying = phase === 'qualifying' || phase === 'sprintQualifying'; const isPractice = phase.startsWith('practice');
  const getPosition = (entry, index) => isPractice ? entry.practicePos : isQualifying ? entry.grid : entry.dnf ? 'DNF' : entry.pos;
  return <section className="weekend">
    <div className="weekend-heading"><div><p className="eyebrow">RACE OPERATIONS</p><h2>Simulation</h2>
      <p className="muted">Build your setup, qualify the grid, then call the race strategy.</p></div>
      {selectedRace && <div className="race-round">ROUND <strong>{selectedRace.round || '—'}</strong></div>}
    </div>
    <div className="simulation-navigation">
      <label>Season grid<select value={gid} onChange={e => { setNextRaceNotice(''); setG(e.target.value); setR('') }}><option value="">Choose a grid</option>{grids.data?.map(g => <option key={g.id} value={g.id}>{g.name} · {g.year}</option>)}</select></label>
      <div className="tabs" role="tablist" aria-label="Simulation sections">
        <button type="button" role="tab" aria-selected={simulationTab === 'weekend'} className={simulationTab === 'weekend' ? 'on' : ''} onClick={() => { setSimulationTab('weekend'); selectRace(upcomingRace?.id) }}>Race weekend</button>
        <button type="button" role="tab" aria-selected={simulationTab === 'standings'} className={simulationTab === 'standings' ? 'on' : ''} onClick={() => setSimulationTab('standings')}>Standings</button>
        <button type="button" role="tab" aria-selected={simulationTab === 'performance'} className={simulationTab === 'performance' ? 'on' : ''} onClick={() => setSimulationTab('performance')}>Performance</button>
      </div>
    </div>
    <QueryStatus query={grids} empty="Create a grid before viewing the simulation." />
    {resultSaveSaving && <p className="query-status" role="status">Saving {resultSaveQueueRef.current[0]?.sessionLabel || 'session'} results to Supabase…</p>}
    {!resultSaveSaving && resultSaveSuccess && <p className="query-status" role="status">{resultSaveSuccess}</p>}
    {resultSaveError && <div className="query-status query-error" role="alert"><span>{resultSaveError}{resultSaveNeedsAuth && <> <a href="/admin" target="_blank" rel="noreferrer">Sign in via Admin</a>, then return here and retry.</>}</span>{resultSaveFailed && <button type="button" onClick={() => void saveResults()}>Retry save</button>}</div>}
    {simulationTab === 'standings' ? grid ? <section className="standings-panel">
      <div className="section-title"><div><h3>{grid.year} season standings</h3><p>Race and sprint points · wins and podiums count Grand Prix results</p></div>{savedSeason.length > 0 && <button type="button" className="btn-danger" onClick={resetSeasonStandings} disabled={resultSaveSaving || resultSaveQueueRef.current.length > 0}>Reset / Delete results</button>}</div>
      <div className="standings-grid">
        {[['Drivers', seasonStandings.drivers], ['Constructors', seasonStandings.teams]].map(([title, rows]) => <div key={title}>
          <h4>{title}</h4><div className="scroll"><table className="race-table standings-table"><thead><tr><th>POS</th><th>{title === 'Drivers' ? 'DRIVER' : 'TEAM'}</th><th>PTS</th><th>W</th><th>POD</th><th>POLE</th>{title === 'Drivers' && <th aria-label="Driver image"></th>}</tr></thead>
            <tbody>{rows.map((row, index) => {
              const driver = title === 'Drivers' ? seasonDriverById.get(String(row.id)) : null;
              const image = driver && driverGridImage(driver, grid.year);
              return <tr key={row.id} className={index === 0 ? 'leader' : ''}><td className="position-cell"><span className="position-number">{index + 1}</span></td><td>{title === 'Drivers' ? <span className="driver-result"><span className="team-logo">{row.team?.logo_normal && <img src={row.team.logo_normal} alt="" />}</span><strong className={row.code ? 'driver-code' : undefined}>{row.code || '—'}</strong></span> : <span className="driver-result"><span className="team-logo">{row.logo_normal && <img src={row.logo_normal} alt="" />}</span><strong>{row.name}</strong></span>}</td><td><strong>{row.points}</strong></td><td>{row.wins}</td><td>{row.podiums}</td><td>{row.poles}</td>{title === 'Drivers' && <td className="driver-grid-image-cell">{image && <img className="driver-grid-image" src={image} alt={`${driver.name} grid image`} />}</td>}</tr>;
            })}</tbody>
          </table></div>
        </div>)}
      </div>
      <QueryStatus query={seasonResultsQuery} empty="No race results have been saved for this season yet." />
    </section> : <div className="weekend-empty"><h3>Choose a season grid</h3><p>Select a grid above to view its standings.</p></div> : simulationTab === 'performance' ? grid ? <section className="performance-panel">
      <div className="section-title"><div><h3>{grid.year} team performance</h3><p>Boost a team to improve the car ratings of all its drivers in upcoming sessions.</p></div></div>
      <div className="performance-team-grid">{teams.map(team => {
        const boost = performanceBoosts[String(team.id)] || 0;
        const teamDrivers = entries.filter(entry => String(entry.team.id) === String(team.id));
        return <article className="performance-team-card" key={team.id} style={{ '--team-color': team.color || '#d3202f' }}>
          <div className="performance-team-heading">{team.logo_normal && <img src={team.logo_normal} alt="" />}<div><h4>{team.name}</h4><p>{teamDrivers.map((entry, index) => <span key={entry.driver.id}>{index > 0 && ' · '}{entry.driver.code ? <span className="driver-code">{entry.driver.code}</span> : entry.driver.name}</span>)}</p></div></div>
          <label className="performance-boost-control"><span>Car performance <strong>+{boost} pts</strong></span><input type="range" min="0" max="20" step="1" value={boost} onChange={event => setPerformanceBoost(team.id, event.target.value)} /><small>Improves speed, aero, grip, race and qualifying ratings for this team.</small></label>
          <button type="button" className="performance-reset" onClick={() => setPerformanceBoost(team.id, 0)} disabled={boost === 0}>Reset boost</button>
          {!!teamDrivers.length && <div className="performance-driver-boosts">{teamDrivers.map(entry => {
            const driverBoost = driverPerformanceBoosts[String(entry.driver.id)] || 0;
            return <label className="performance-driver-boost" key={entry.driver.id}><span>{entry.driver.code || entry.driver.name}<strong>+{driverBoost}</strong></span><input type="range" min="0" max="20" step="1" value={driverBoost} onChange={event => setDriverPerformanceBoost(entry.driver.id, event.target.value)} /></label>;
          })}</div>}
        </article>;
      })}</div>
      {!teams.length && <p className="muted">No complete teams are assigned to this grid.</p>}
      <div className="team-garage performance-garage"><div className="section-title"><div><h3>Garage setup</h3><p>Off by default: teams use their standard setup. Enabled setups apply to upcoming sessions.</p></div></div>
        <label className="strategy-toggle"><input type="checkbox" checked={garageSetupEnabled} onChange={event => setGarageSetupEnabled(event.target.checked)} /><span>Enable custom garage setup</span></label>
        {garageSetupEnabled && teams.map(team => {
          const setup = { ...DEFAULT_SETUP, ...setups[team.id] }; return <details className="team-panel" key={team.id} style={{ '--team-color': team.color || '#d3202f' }}>
            <summary><strong>{team.name}</strong><span>Adjust setup</span></summary>
            <div className="setup-controls">
              {[['aero', 'Aero balance', 'Low drag ↔ Downforce'], ['suspension', 'Mechanical grip', 'Stable ↔ Responsive'], ['tyreCare', 'Tyre management', 'Attack ↔ Preserve']].map(([key, label, help]) =>
                <label key={key}>{label}<span className="range-value">{setup[key]}</span><input type="range" min="0" max="100" value={setup[key]} onChange={e => setSetup(team.id, key, +e.target.value)} /><small>{help}</small></label>)}
            </div>
          </details>
        })}
      </div>
    </section> : <div className="weekend-empty"><h3>Choose a season grid</h3><p>Select a grid above to manage team performance.</p></div> : <>
      <div className="weekend-select">
        <label>Grand Prix<select value={rid} onChange={e => selectRace(e.target.value)} disabled={!grid || races.loading}><option value="">Choose a race</option>{races.data?.map(r => <option key={r.id} value={r.id}>R{r.round} · {r.name}</option>)}</select></label>
        <label>Weather<select value={weatherMode} onChange={e => setWeatherMode(e.target.value)}><option value="dry">Dry</option><option value="variable">Changeable</option><option value="wet">Wet</option></select></label>
        <button className="btn weekend-start" disabled={!grid || !selectedRace || entries.length < 2 || resultSaveSaving || resultSaveQueueRef.current.length > 0} onClick={startWeekend}>
          {resultSaveSaving ? 'Saving results…' : weekendStarted ? 'Restart weekend' : 'Start race weekend'}
        </button>
      </div>
      {nextRaceNotice && <p className="query-status" role="status">{nextRaceNotice}</p>}
      {grid && <QueryStatus query={races} empty="No races found for this grid's season. Add the calendar in Admin." />}
      {grid && selectedRace && <QueryStatus query={entriesQuery} empty="Add at least two complete driver and car entries to this grid." />}
      {selectedRace && <div className="circuit-panel">
        {selectedRace.circuit_image_url ? <img className="circuit-map-image" src={selectedRace.circuit_image_url} alt={`${selectedRace.circuit || selectedRace.name} circuit layout`} /> : <svg className="circuit-map" viewBox="0 0 180 110" role="img" aria-label="Circuit illustration">
          <path d="M22 72 33 32 68 20 92 35 127 21 155 38 148 66 164 82 133 94 105 81 77 94 49 81 22 72Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
          <path d="M22 72 33 32 68 20" fill="none" stroke="var(--red)" strokeWidth="5" strokeLinecap="round" />
        </svg>}
        <div><p className="eyebrow">CIRCUIT</p><h3>{selectedRace.circuit || selectedRace.name}</h3>
          <p>{selectedRace.country || 'Race weekend'}{selectedRace.date ? ` · ${selectedRace.date}` : ''}</p></div>
        <div className="circuit-facts"><span>{selectedRace.laps || 57}<small> LAPS</small></span><span>{selectedRace.is_sprint ? 'SPRINT FORMAT' : 'GRAND PRIX'}</span></div>
      </div>}
      {!weekendStarted && <div className="weekend-empty">
        <h3>Prepare for lights out</h3>
        <p>Choose a race grid and event to open the garage and begin the weekend.</p>
        {grid && entries.length > 0 && entries.length < 2 && <p className="muted">This grid needs at least two entries with a driver, team, and car.</p>}
      </div>}
      {weekendStarted && <>
        <div className="session-timeline">{phases.map((name, index) => {
          const complete = Boolean(results[name]) || ((name === 'race' || name === 'sprint') && phase === name && raceState?.done);
          return <button key={name}
            className={`session-step ${phaseIndex === index ? 'current' : ''} ${complete ? 'complete' : ''}`}
            onClick={() => { if (index <= phaseIndex && !weekendComplete && !isRunning && !currentQualifying?.playing) { setQualifyingSimulation(null); setPhaseIndex(index) } }}
            disabled={weekendComplete || isRunning || currentQualifying?.playing || index > phaseIndex}>
            <span className="session-number">{complete ? '✓' : `0${index + 1}`}</span><span>{PHASE_LABELS[name]}</span>
          </button>
        })}</div>
        {weekendComplete ? <div className="weekend-empty finish-banner"><p className="eyebrow">CHEQUERED FLAG</p>
          <h3>{selectedRace.name} complete</h3><p>Weekend results are ready. Start another weekend to run a new event.</p>
          <button className="btn" onClick={() => { setWeekendStarted(false); setWeekendComplete(false); setResults({}) }}>Return to race selection</button>
        </div> : <>
          <div className="session-header"><div><p className="eyebrow">SESSION {String(phaseIndex + 1).padStart(2, '0')}</p>
            <h3>{PHASE_LABELS[phase]}</h3><p>{isPractice ? 'Dial in the car before qualifying.' : phase === 'qualifying' ? 'Set the starting order for the weekend.' : phase === 'sprint' ? 'A short-format race for extra points.' : 'Choose your race strategy and go racing.'}</p>
          </div>
            {phaseResult && (phase !== 'race' && phase !== 'sprint' || raceState?.done) && <button className="btn" onClick={advance}>{phaseIndex === phases.length - 1 ? 'Finish weekend' : 'Continue to ' + PHASE_LABELS[phases[phaseIndex + 1]]}</button>}
          </div>
          {isQualifying&&!phaseResult&&!currentQualifying&&<>
            <details className="qualifying-strategy"><summary>Qualifying run plans</summary><div>{teams.map(team=><label key={team.id}>{team.name}
              <select value={qualifyingRunPlans[team.id]||'auto'} onChange={event=>setQualifyingRunPlans(current=>({...current,[team.id]:event.target.value==='auto'?undefined:Number(event.target.value)}))}>
                <option value="auto">Team choice · 1–3 runs</option><option value="1">One run</option><option value="2">Two runs</option><option value="3">Three runs</option>
              </select>
            </label>)}</div></details>
            <div className="qualifying-start-actions">
              <button type="button" className="btn run-session" onClick={runPhase}>Start {PHASE_LABELS[phase]}</button>
              <button type="button" className="qualifying-skip" onClick={skipQualifying}>Skip simulation</button>
            </div>
          </>}
          {currentQualifying&&qualifyingSession&&<section className="qualifying-live" aria-label={`${qualifyingSession.session} live timing`}>
            <div className="qualifying-session-tabs" role="tablist" aria-label="Qualifying sessions">
              {currentQualifying.sessions.map((session,index)=><button type="button" role="tab" key={session.session}
                aria-selected={qualifyingViewIndex===index} className={qualifyingViewIndex===index?'active':''}
                disabled={index>currentQualifying.sessionIndex}
                onClick={()=>setQualifyingSimulation(current=>({...current,viewIndex:index}))}>{session.session}</button>)}
            </div>
            {(()=>{
              const red=qualifyingSession.timeline.find(event=>event.type==='red');
              const clockRemaining=!red?qualifyingSession.clockDuration-qualifyingElapsed
                :qualifyingElapsed<red.t?qualifyingSession.clockDuration-qualifyingElapsed
                  :qualifyingElapsed<red.t+red.addedSeconds?qualifyingSession.clockDuration-red.clock
                    :qualifyingSession.clockDuration-(qualifyingElapsed-red.addedSeconds);
              const redActive=Boolean(red&&qualifyingElapsed>=red.t&&qualifyingElapsed<red.t+red.addedSeconds);
              const dropStart=Math.max(0,qualifyingLiveRows.length-qualifyingSession.eliminated.length);
              const leader=qualifyingLiveRows.find(row=>Number.isFinite(row.bestLap));
              const completed=qualifyingElapsed>=qualifyingSession.duration;
              return <>
                <div className="qualifying-status">
                  <div><span className="eyebrow">{qualifyingSession.session} · {qualifyingSession.fieldSize} CARS</span><strong className="qualifying-clock">{qualifyingClock(clockRemaining)}</strong></div>
                  <span className={`qualifying-control ${redActive?'red':'green'}`}>{redActive?'RED FLAG':completed?'CHEQUERED FLAG':'LIVE TIMING'}</span>
                  <span className="qualifying-weather">{qualifyingWeather?.wetness>=0.65?'WET':qualifyingWeather?.wetness>=0.3?'DAMP':'DRY'} TRACK</span>
                </div>
                <div className="qualifying-controls">
                  {qualifyingSessionIsCurrent&&!completed&&<button type="button" onClick={()=>setQualifyingSimulation(current=>({...current,playing:!current.playing}))}>{currentQualifying.playing?'Pause':'Play'}</button>}
                  <label>Speed<select value={qualifyingSpeed} onChange={event=>{const speed=Number(event.target.value);setQualifyingSpeed(speed);setQualifyingSimulation(current=>current?({...current,speed}):current)}}><option value={1}>1×</option><option value={5}>5×</option><option value={20}>20×</option></select></label>
                  {qualifyingSessionIsCurrent&&!completed&&<button type="button" onClick={()=>setQualifyingSimulation(current=>({...current,elapsed:qualifyingSession.duration,playing:false}))}>Skip to end</button>}
                  {qualifyingSessionIsCurrent&&completed&&<button type="button" className="btn" onClick={continueQualifying}>{currentQualifying.sessionIndex<currentQualifying.sessions.length-1
                    ?`Continue to ${currentQualifying.sessions[currentQualifying.sessionIndex+1].session} · ${Math.floor(currentQualifying.sessionBreakSeconds/60)} min break`
                    :'Complete qualifying'}</button>}
                  {qualifyingSessionIsCurrent&&!completed&&<button type="button" className="qualifying-skip" onClick={skipQualifying}>Skip simulation</button>}
                </div>
                <div className="scroll"><table className="race-table qualifying-timing-table"><thead><tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>BEST</th><th>GAP</th><th>S1</th><th>S2</th><th>S3</th><th>TYRE</th><th>STATUS</th></tr></thead>
                  <tbody>{qualifyingLiveRows.map((row,index)=>{
                    const drop=qualifyingSession.eliminated.length>0&&index>=dropStart;
                    const sectors=row.currentSectors?.length?row.currentSectors:row.sectors||[];
                    return <tr key={row.driver?.id} className={`${index===0&&leader?'leader':''} ${drop?'drop-zone':''}`}>
                      <td className="position-cell">{index+1}</td>
                      <td><span className="driver-result"><span className="team-logo">{row.team?.logo_normal&&<img src={row.team.logo_normal} alt="" />}</span><strong className={row.driver?.code?'driver-code':undefined}>{row.driver?.code||row.driver?.name}</strong></span></td>
                      <td>{row.team?.name||'—'}</td>
                      <td>{formatTime(row.bestLap)}</td>
                      <td>{index===0||!leader||!Number.isFinite(row.bestLap)?'—':`+${(row.bestLap-leader.bestLap).toFixed(3)}`}</td>
                      {[0,1,2].map(sector=>{
                        const value=sectors[sector],fastest=qualifyingFastestSectors[sector];
                        const className=Number.isFinite(value)&&Math.abs(value-fastest)<1e-8?'sector-purple':Number.isFinite(value)?'sector-green':'sector-yellow';
                        return <td className={className} key={sector}>{Number.isFinite(value)?value.toFixed(3):'—'}</td>;
                      })}
                      <td><span className={`qualifying-tyre ${row.tyreCompound||''}`}>{row.tyreCompound?.toUpperCase()||'—'}</span></td>
                      <td>{row.currentStatus}</td>
                    </tr>;
                  })}</tbody></table></div>
                {completed&&<div className="qualifying-eliminations"><strong>{qualifyingSession.eliminated.length?`${qualifyingSession.eliminated.length} eliminated`:qualifyingSession.session.endsWith('3')?'Final session complete':'No eliminations'}</strong>
                  {qualifyingSession.eliminated.length>0&&<span>{qualifyingSession.eliminated.map((row,index)=>`P${row.sessionPosition} ${row.driver?.code||row.driver?.name}`).join(' · ')}</span>}
                </div>}
              </>;
            })()}
          </section>}
          {isPractice && <>
            <label className="strategy-toggle"><input type="checkbox" checked={reserveDriversEnabled} onChange={event => { setReserveDriversEnabled(event.target.checked); if (!event.target.checked) setPracticeSubstitutions({}) }} /><span>Enable reserve drivers</span></label>
            {reserveDriversEnabled && <section className="practice-substitution"><div><h4>Practice-only reserve substitutions</h4><p>Choose which team driver the assigned reserve replaces for practice sessions. Qualifying and races use the original grid.</p></div>
            <QueryStatus query={practiceLineups} empty="No season lineups found. Assign reserve drivers in Admin to enable substitutions." />
            {practiceLineups.data?.length > 0 && <QueryStatus query={reserveDriversQuery} empty="No assigned reserve drivers are available." />}
            {!practiceLineups.loading && !practiceLineups.error && <div className="practice-substitution-grid">{practiceSubstitutionOptions.map(({ team, lineup, reserve, targetId, reserveAlreadyEntered, drivers: teamDrivers }) => <label className="practice-substitution-card" key={team.id} style={{ '--team-color': team.color || '#d3202f' }}>
              <strong>{team.name}</strong>
              {!lineup?.reserve_driver_id ? <span className="practice-substitution-note">No reserve assigned</span>
                : reserveDriversQuery.loading ? <span className="practice-substitution-note">Loading reserve driver…</span>
                  : !reserve ? <span className="practice-substitution-note">Reserve driver details unavailable</span>
                    : reserveAlreadyEntered ? <span className="practice-substitution-note">{reserve.name} is already entered in this grid</span>
                      : <><span className="practice-substitution-note">Reserve: {reserve.name}</span><select aria-label={`${team.name} practice substitution`} value={targetId} onChange={event => setPracticeSubstitutions(current => ({ ...current, [team.id]: event.target.value }))}><option value="">No substitution</option>{teamDrivers.map(entry => <option key={entry.driver.id} value={entry.driver.id}>{entry.driver.name}</option>)}</select></>}
            </label>)}</div>}
            </section>}
          </>}
          {(phase === 'sprint' || phase === 'race') && <div className="strategy-panel"><div className="section-title"><h3>Race strategy</h3><p>Off by default: the simulator selects each team’s tyre and pit plan automatically.</p></div>
            <label className="strategy-toggle"><input type="checkbox" checked={strategyEnabled} onChange={e => setStrategyEnabled(e.target.checked)} /><span>Enable custom race strategy</span></label>
            {strategyEnabled && <div className="strategy-grid">{teams.map(team => {
              const strategy = { ...DEFAULT_STRATEGY, ...strategies[team.id] }; return <article className="strategy-card" key={team.id} style={{ '--team-color': team.color || '#d3202f' }}>
                <strong>{team.name}</strong><label>Tyre compound<select value={strategy.tyre} onChange={e => setStrategy(team.id, 'tyre', e.target.value)}><option value="auto">Automatic strategy</option><option value="soft">Soft · fastest</option><option value="medium">Medium · balanced</option><option value="hard">Hard · durable</option></select></label>
                <label>Pit stops<select value={mandatoryDryTyreCompounds && Number(strategy.stops) === 0 ? 1 : strategy.stops} onChange={e => setStrategy(team.id, 'stops', e.target.value === 'auto' ? 'auto' : Number(e.target.value))}><option value="auto">Automatic plan</option><option value={0} disabled={mandatoryDryTyreCompounds}>No stop · high wear{mandatoryDryTyreCompounds ? ' (unavailable under dry-race rules)' : ''}</option><option value={1}>One stop</option><option value={2}>Two stops</option></select></label>
              </article>
            })}</div>}
          </div>}
          {!phaseResult&&!isQualifying&&<button className="btn run-session" onClick={runPhase}>{isPractice ? `Run ${PHASE_LABELS[phase]}` : phase === 'sprint' ? 'Start sprint' : 'Start Grand Prix'}</button>}
          {phaseResult && (phase === 'race' || phase === 'sprint') && raceState && <div className="race-live">
            <div className="race-status">
              <div><span className="eyebrow">{raceState.format === 'sprint' ? 'SPRINT' : 'GRAND PRIX'}</span><strong>LAP {raceState.lap} / {raceState.totalLaps}</strong></div>
              <div className={`control-state ${raceState.raceControl === 'safety_car' ? 'yellow' : ''}`}>{raceState.raceControl === 'safety_car' ? 'SAFETY CAR' : 'GREEN FLAG'}</div>
              <div><span className="eyebrow">TRACK</span><strong>{raceState.weather.wetness >= 0.65 ? 'WET' : raceState.weather.wetness >= 0.3 ? 'DAMP' : 'DRY'}</strong></div>
            </div>
            <div className="race-controls">
              {!raceState.done && <button onClick={() => setIsRunning(value => !value)}>{isRunning ? 'Pause' : 'Resume'}</button>}
              <button onClick={() => { setIsRunning(false); setRaceState(current => current && !current.done ? advanceRaceLap(current) : current) }} disabled={isRunning || raceState.done}>Advance one lap</button>
              <label>Speed<select value={simulationSpeed} onChange={e => setSimulationSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option><option value={10}>10×</option></select></label>
              <button onClick={() => { const restartSource = phase === 'sprint' ? 'sprintQualifying' : phase === 'race' && selectedRace?.sprint_affects_grand_prix_grid ? 'sprint' : 'qualifying'; const restartEntries = results[restartSource]?.map((entry, index) => ({ ...entry, grid: restartSource === 'sprint' ? (entry.position || entry.pos || index + 1) : entry.grid })); if (!restartEntries?.length) return alert(`Complete ${PHASE_LABELS[restartSource] || restartSource} before restarting.`); setIsRunning(false); let restarted = createRaceState({ entries: applyDriverPerformanceBoosts(applyTeamPerformanceBoosts(restartEntries, performanceBoosts), driverPerformanceBoosts), race: selectedRace, format: phase === 'sprint' ? 'sprint' : 'race', strategies: strategyEnabled ? strategies : {}, setups: activeSetups, weather: weatherMode, laps: phase === 'sprint' ? Math.max(1, Math.round((Number(selectedRace.laps) || 57) * 0.32)) : Number(selectedRace.laps) || 57 }); Object.entries(raceTeamAdjustments).forEach(([teamId, adjustments]) => { restarted = setTeamRaceAdjustments(restarted, teamId, adjustments) }); setRaceState(restarted); setRaceViewTab('timing'); setIsRunning(true) }}>Restart race</button>
              <button onClick={() => { setIsRunning(false); setRaceState(null); setSelectedDriverId(null); setPitFeedback(''); setResults(current => { const next = { ...current }; delete next[phase]; return next }) }}>Reset session</button>
            </div>
            <div className="race-view-tabs" role="tablist" aria-label="Race views">
              <button type="button" role="tab" aria-selected={raceViewTab === 'timing'} className={raceViewTab === 'timing' ? 'on' : ''} onClick={() => setRaceViewTab('timing')}>Live timing</button>
              <button type="button" role="tab" aria-selected={raceViewTab === 'performance'} className={raceViewTab === 'performance' ? 'on' : ''} onClick={() => setRaceViewTab('performance')}>Team performance</button>
            </div>
            {raceViewTab === 'performance' ? <section className="race-performance-panel">
              <div className="section-title"><div><h3>Live team performance</h3><p>Changes affect each team’s next lap and remain in effect for the rest of this race.</p></div></div>
              <div className="performance-team-grid">{teams.map(team => {
                const adjustments = raceTeamAdjustments[String(team.id)] || {};
                const teamDrivers = entries.filter(entry => String(entry.team.id) === String(team.id));
                return <article className="performance-team-card" key={team.id} style={{ '--team-color': team.color || '#d3202f' }}>
                  <div className="performance-team-heading">{team.logo_normal && <img src={team.logo_normal} alt="" />}<div><h4>{team.name}</h4><p>{teamDrivers.map((entry, index) => <span key={entry.driver.id}>{index > 0 && ' · '}{entry.driver.code ? <span className="driver-code">{entry.driver.code}</span> : entry.driver.name}</span>)}</p></div></div>
                  <div className="race-performance-controls">{[['performance', 'Performance'], ['pace', 'Pace'], ['overtake', 'Overtaking'], ['defense', 'Defense']].map(([key, label]) => {
                    const value = adjustments[key] || 0;
                    return <label className="performance-boost-control" key={key}><span>{label}<strong>{value > 0 ? '+' : ''}{value}</strong></span><input type="range" min="-20" max="20" step="1" value={value} disabled={raceState.done} onChange={event => adjustLiveTeam(team.id, key, event.target.value)} /><small>{value > 0 ? 'Boost' : value < 0 ? 'Reduce' : 'No change'} this team’s {label.toLowerCase()} rating.</small></label>;
                  })}</div>
                  <button type="button" className="performance-reset" onClick={() => { setRaceTeamAdjustments(current => ({ ...current, [String(team.id)]: { performance: 0, pace: 0, overtake: 0, defense: 0 } })); setRaceState(current => current && !current.done ? setTeamRaceAdjustments(current, team.id, {}) : current) }} disabled={raceState.done || !Object.values(adjustments).some(value => value !== 0)}>Reset live adjustments</button>
                </article>;
              })}</div>
            </section> : <>
              {raceState.done && <SessionPodium entries={phaseResult} race={selectedRace} phaseLabel={PHASE_LABELS[phase]} raceResult fastestLap={fastestSessionLap} />}
              <QueryStatus query={tyreImagesQuery} />
              <div className="results-panel"><div className="section-title"><h3>Live timing</h3><p>{raceState.done ? 'Chequered flag' : 'Simulation in progress'}</p></div>
                {boostFeedback && <p className="boost-feedback" role="status">{boostFeedback}</p>}
                <div className="live-timing-layout">
                  <TimingTower entries={phaseResult} lap={raceState.lap} totalLaps={raceState.totalLaps}
                    selectedDriverId={selectedDriverId} defaultFocusIndex={Math.min(8, Math.max(0, phaseResult.length - 1))}
                    onSelect={driverId => setSelectedDriverId(driverId)} />
                  <div className="timing-stage-column">
                    <DriverStage entry={stageEntry} car={selectedCar} opponent={stageOpponent} position={stagePosition}
                      raceState={raceState} pitCompound={pitCompound} pitLap={pitLap} pitFeedback={pitFeedback}
                      onPitCompound={setPitCompound} onPitLap={setPitLap} onPitCommand={issuePitCommand}
                      onBoost={issueDriverBoost} onClose={() => setSelectedDriverId(null)}
                      boostDisabled={raceState.done || stageEntry.retired || stageEntry.completed || stageEntry.boostLap != null || stageEntry.boostCooldownLaps > 0}
                      boostLabel={stageEntry.boostLap != null ? 'BOOST ARMED' : stageEntry.boostCooldownLaps > 0 ? `BOOST · ${stageEntry.boostCooldownLaps}L` : 'BOOST'} />
                    <details className="timing-details">
                      <summary>Detailed timing and race controls</summary>
                      <div className="scroll"><table className="race-table live-timing-table"><thead><tr><th>POS</th><th>DRIVER</th><th>GAP</th><th>INT</th><th>LAST</th><th>BEST</th><th>TYRE</th><th>AGE</th><th>WEAR</th><th>GRIP</th><th>PITS</th><th>FUEL</th><th>PIT COMMAND</th><th>STATUS</th><th>BOOST</th><th></th></tr></thead>
                  <tbody>{phaseResult.map((entry, index) => {
                    const leader = phaseResult[0], ahead = phaseResult[index - 1];
                    const gap = entry.lapsCompleted < leader.lapsCompleted ? `+${leader.lapsCompleted - entry.lapsCompleted} LAP` : index === 0 ? '—' : `+${(entry.totalTime - leader.totalTime).toFixed(3)}`;
                    const interval = index === 0 ? '—' : entry.lapsCompleted < ahead.lapsCompleted ? `+${ahead.lapsCompleted - entry.lapsCompleted} LAP` : `+${(entry.totalTime - ahead.totalTime).toFixed(3)}`;
                    return <tr key={`${entry.driver.id}-${index}`} className={index === 0 ? 'leader' : ''}>
                      <td className="position-cell"><span className="position-number">{entry.retired ? 'RET' : index + 1}</span>{(() => {
                        const change = (entry.gridPosition ?? entry.grid ?? index + 1) - (index + 1);
                        const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'same';
                        const symbol = change > 0 ? '▲' : change < 0 ? '▼' : '→';
                        const description = change > 0 ? `${change} place${change === 1 ? '' : 's'} gained` : change < 0 ? `${Math.abs(change)} place${change === -1 ? '' : 's'} lost` : 'no position change';
                        return <span className={`position-change ${direction}`} aria-label={description} title={description}>{symbol}</span>;
                      })()}</td>
                      <td><button className="driver-select" onClick={() => setSelectedDriverId(entry.driver.id)}><span className="driver-result"><span className="team-logo">{entry.team.logo_normal && <img src={entry.team.logo_normal} alt={`${entry.team.name} logo`} />}</span><strong className={entry.driver.code ? 'driver-code' : undefined}>{entry.driver.code || entry.driver.name.trim().split(/\s+/).pop()?.toUpperCase()}</strong></span></button></td>
                      <td>{gap}</td><td>{interval}</td><td>{formatTime(entry.lastLap)}</td><td>{formatTime(entry.bestLap)}</td>
                      <td className="tyre-compound-cell">{entry.tyre?.compound && tyreImages[entry.tyre.compound] ? <img className="tyre-compound-image" src={tyreImages[entry.tyre.compound]} alt={entry.tyre.compound} title={entry.tyre.compound} /> : entry.tyre?.compound?.toUpperCase() || '—'}</td><td>{entry.tyre?.age ?? '—'}</td><td>{entry.tyre?.wear?.toFixed(0) ?? '—'}%</td><td>{entry.tyre?.state?.toUpperCase() || '—'}</td><td>{entry.pitStops}</td><td>{entry.retired ? '—' : `${entry.fuelRemaining.toFixed(1)} kg`}</td><td>{entry.pitInstruction ? `${entry.pitInstruction.mode.toUpperCase()} · LAP ${entry.pitInstruction.targetLap}` : entry.pitStatus}</td><td>{entry.retired ? `RETIRED · L${entry.retirementLap}` : entry.status}</td>
                      <td><button className={`driver-boost ${entry.boostLap != null ? 'armed' : ''}`} onClick={() => issueDriverBoost(entry.driver.id)} disabled={raceState.done || entry.retired || entry.completed || entry.boostLap != null || entry.boostCooldownLaps > 0} title={entry.boostLap != null ? `Boost armed for lap ${entry.boostLap}` : entry.boostCooldownLaps > 0 ? `Available in ${entry.boostCooldownLaps} laps` : 'Boost pace for the next lap'}>{entry.boostLap != null ? 'ARMED' : entry.boostCooldownLaps > 0 ? `${entry.boostCooldownLaps}L` : 'BOOST'}</button></td>
                      <td className="driver-grid-image-cell">{driverGridImage(entry.driver, selectedRace?.year) && <img className="driver-grid-image" src={driverGridImage(entry.driver, selectedRace?.year)} alt={`${entry.driver.name} grid image`} />}</td>
                    </tr>
                  })}</tbody></table></div>
                    </details>
                  </div>
                </div>
              </div>
              {!!raceState.events.length && <div className="race-events"><h3>Race control</h3>{raceState.events.slice(-6).reverse().map((event, index) => <p key={`${event.type}-${event.lap}-${index}`}><strong>L{event.lap}</strong> · {event.type.replaceAll('_', ' ')}{event.reason ? ` — ${event.reason}` : ''}</p>)}</div>}
            </>}
          </div>}
          {phaseResult && phase !== 'race' && phase !== 'sprint' && <div className="results-panel"><div className="section-title"><h3>{PHASE_LABELS[phase]} classification</h3><p>{isPractice ? 'Practice pace' : isQualifying ? 'Starting grid' : 'Session results'}</p></div>
            {(isPractice || isQualifying) && <SessionPodium entries={phaseResult} race={selectedRace} phaseLabel={PHASE_LABELS[phase]} fastestLap={fastestSessionLap} />}
            <div className={`scroll ${isPractice ? 'practice-classification-scroll' : ''}`}><table className={`race-table session-classification-table ${isPractice ? 'practice-classification-table' : ''}`}><thead><tr><th>POS</th><th>DRIVER</th><th>GAP</th><th>BEST LAP</th>{!isPractice && <th>CAR</th>}<th></th></tr></thead>
              <tbody>{phaseResult.map((entry, index) => {
                const gap = Number.isFinite(entry.bestLap) && Number.isFinite(fastestSessionLap) && entry.bestLap > fastestSessionLap ? `+${(entry.bestLap - fastestSessionLap).toFixed(3)}` : '—';
                return <tr key={`${entry.driver.id}-${index}`} className={index === 0 ? 'leader' : ''}>
                  <td className="position-cell">{getPosition(entry, index)}</td><td><span className="driver-result"><span className="team-logo">{entry.team.logo_normal && <img src={entry.team.logo_normal} alt={`${entry.team.name} logo`} />}</span><strong className={isPractice && entry.driver.code ? 'driver-code' : undefined}>{isPractice ? (entry.driver.code || entry.driver.name.trim().split(/\s+/).pop()?.toUpperCase()) : entry.driver.name.trim().split(/\s+/).pop()?.toUpperCase()}</strong></span></td>
                  <td>{gap}</td><td>{formatTime(entry.bestLap)}</td>{!isPractice && <td>{entry.cars?.model || entry.c.model || '—'}</td>}<td className="driver-grid-image-cell">{driverGridImage(entry.driver, selectedRace?.year) && <img className="driver-grid-image" src={driverGridImage(entry.driver, selectedRace?.year)} alt={`${entry.driver.name} grid image`} />}</td>
                </tr>
              })}</tbody></table></div>
          </div>}
        </>}
      </>}
    </>}
  </section>
}
