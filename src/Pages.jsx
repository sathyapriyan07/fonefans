import {useEffect,useState} from 'react';import {Link,useParams} from 'react-router-dom';
import {sb} from './supabase.js';import {practice,qualify,race} from './sim.js';
function useQ(fn,deps=[]){
 const [query,setQuery]=useState({data:null,loading:true,error:null});
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true;
  setQuery({data:null,loading:true,error:null});
  Promise.resolve().then(fn).then(result=>{
   const isQueryResult=result&&typeof result==='object'&&'data' in result;
   const error=isQueryResult?result.error:null;
   if(error)throw error;
   if(active)setQuery({data:isQueryResult?result.data:result,loading:false,error:null});
  }).catch(error=>{
   console.error('Page data failed to load:',error);
   if(active)setQuery({data:null,loading:false,error});
  });
  return()=>{active=false};
 },[attempt,...deps]);
 return {...query,retry:()=>setAttempt(value=>value+1)};
}
function QueryStatus({query,empty}){
 if(query.loading)return <p className="query-status" role="status">Loading…</p>;
 if(query.error)return <div className="query-status query-error" role="alert"><span>Could not load this page: {query.error.message||String(query.error)}</span><button onClick={query.retry}>Try again</button></div>;
 if(empty&&Array.isArray(query.data)&&query.data.length===0)return <p className="query-status">{empty}</p>;
 return null;
}
const Bar=({l,v})=><div className="bar"><span>{l}</span><i><b style={{width:(v??0)+'%'}}/></i><em>{v??'–'}</em></div>;
const latestImg=(d,k)=>[...(d.driver_images||[])].sort((a,b)=>b.year-a.year)[0]?.[k];
const CAR=['speed','race','overtaking','defence','performance','qualifying','reliability'];
const one=x=>Array.isArray(x)?x[0]:x;
export function Home(){const n=useQ(async()=>{const c=async t=>{const {count,error}=await sb.from(t).select('*',{count:'exact',head:true});if(error)throw error;return count};const [drivers,teams,races]=await Promise.all([c('drivers'),c('teams'),c('races')]);return {drivers,teams,races}});
 return <section className="hero"><h1>Build the grid. Run the season.</h1><p>Set up your cars, manage race strategy, and take your custom grid through a full race weekend.</p>
 <div className="row"><Link className="btn" to="/simulate">Start a race weekend</Link><Link className="btn ghost" to="/grids">Build a grid</Link></div>
 {n.data&&<p className="muted">{n.data.drivers} drivers, {n.data.teams} teams, {n.data.races} races loaded</p>}<QueryStatus query={n}/></section>}
export function Drivers(){const d=useQ(()=>sb.from('drivers').select('*,driver_images(*)').order('name'));
 return <><h2>Drivers</h2><QueryStatus query={d} empty="No drivers yet."/><div className="grid">{d.data?.map(x=><Link key={x.id} to={'/drivers/'+x.id} className="card">{latestImg(x,'card_url')&&<img src={latestImg(x,'card_url')}/>}<h3>{x.name}</h3><p>{x.code} #{x.number}</p></Link>)}</div></>}
export function Driver(){const {id}=useParams();const d=useQ(()=>sb.from('drivers').select('*,driver_images(*),driver_ratings(*)').eq('id',id).single(),[id]);
 if(d.loading||d.error||!d.data)return <><h2>Driver</h2><QueryStatus query={d}/></>;
 const driver=d.data;const r=one(driver.driver_ratings)||{};
 return <><h2>{driver.name} <small>#{driver.number} {driver.code}</small></h2><p>{driver.nationality_logo&&<img height="16" src={driver.nationality_logo}/>} {driver.nationality}</p><p>{driver.bio}</p>
 <div className="split"><div>{['race','overtaking','speed','experience','qualifying','defence'].map(k=><Bar key={k} l={k} v={r[k]}/>)}</div>
 <div className="grid">{[...(driver.driver_images||[])].sort((a,b)=>b.year-a.year).map(i=><figure key={i.id}><figcaption>{i.year}</figcaption>{['pole_url','grid_url','card_url'].map(k=>i[k]&&<img key={k} src={i[k]}/>)}</figure>)}</div></div></>}
const CarCard=({c,sub,teamLogo,teamName})=><div className="card">{c.image_url&&<img src={c.image_url}/>}<h3>{c.model} <small>{c.year}</small></h3><p className="car-sub">{teamLogo&&<img className="car-team-logo" src={teamLogo} alt={`${teamName||'Team'} logo`} />}{sub}</p>{CAR.map(k=><Bar key={k} l={k} v={c[k]}/>)}</div>;
export function Cars(){const c=useQ(()=>sb.from('cars').select('*,teams(name,logo_normal)').order('year',{ascending:false}));
 return <><h2>Cars</h2><QueryStatus query={c} empty="No cars yet."/><div className="grid">{c.data?.map(x=><CarCard key={x.id} c={x} teamLogo={x.teams?.logo_normal} teamName={x.teams?.name} sub={x.engine||''}/>)}</div></>}
export function Teams(){const t=useQ(()=>sb.from('teams').select('*').order('name'));
 return <><h2>Teams</h2><QueryStatus query={t} empty="No teams yet."/><div className="grid">{t.data?.map(x=><Link key={x.id} to={'/teams/'+x.id} className="card team-card" style={{borderTop:'6px solid '+x.color}}><h3>{x.name}</h3>{x.logo_normal&&<img src={x.logo_normal} alt={`${x.name} logo`}/>}</Link>)}</div></>}
export function Team(){const {id}=useParams();const t=useQ(()=>sb.from('teams').select('*,cars(*)').eq('id',id).single(),[id]);if(t.loading||t.error||!t.data)return <><h2>Team</h2><QueryStatus query={t}/></>;
 const team=t.data;return <><h2 style={{borderLeft:'8px solid '+team.color,paddingLeft:12}}>{team.name}</h2>{team.logo_detailed&&<img height="80" src={team.logo_detailed}/>}
 <QueryStatus query={{...t,data:team.cars||[]}} empty="No cars registered for this team."/><div className="grid">{[...(team.cars||[])].sort((a,b)=>b.year-a.year).map(c=><CarCard key={c.id} c={c} sub={c.engine}/>)}</div></>}
export function Races(){const r=useQ(()=>sb.from('races').select('*').order('year',{ascending:false}).order('round'));
 return <><h2>Races</h2><QueryStatus query={r} empty="No races yet."/><table><tbody>{r.data?.map(x=><tr key={x.id}><td>{x.year}</td><td>R{x.round}</td><td>{x.name}</td><td>{x.circuit}</td><td>{x.date}</td><td>{x.is_sprint&&'Sprint'}</td></tr>)}</tbody></table></>}
export function Grids(){const [tick,setT]=useState(0);const g=useQ(()=>sb.from('grids').select('*,grid_entries(*,drivers(name),teams(name))').order('year',{ascending:false}),[tick]);
 const teams=useQ(()=>sb.from('teams').select('*,cars(*)').order('name'));const drivers=useQ(()=>sb.from('drivers').select('id,name').order('name'));const [f,setF]=useState({});
 const teamRows=teams.data||[];const driverRows=drivers.data||[];
 const add=async gid=>{if(!f.driver||!f.car)return;const car=teamRows.flatMap(t=>t.cars||[]).find(c=>c.id==f.car);
  if(!car)return alert('Choose a valid car.');
  const {error}=await sb.from('grid_entries').insert({grid_id:gid,driver_id:f.driver,car_id:car.id,team_id:car.team_id});if(error)alert(error.message+' (sign in via /admin first)');setT(t=>t+1)};
 const del=async id=>{await sb.from('grid_entries').delete().eq('id',id);setT(t=>t+1)};
 return <><h2>Grids</h2><p className="muted">A grid is a set of driver and car pairings. Create grids in Admin, then fill them here (sign-in required to edit).</p>
 <QueryStatus query={g} empty="No grids yet."/><QueryStatus query={teams} empty="No teams or cars available."/><QueryStatus query={drivers} empty="No drivers available."/>
 {(g.data||[]).map(x=><div key={x.id} className="card wide"><h3>{x.name} <small>{x.year}</small></h3>
 <ul>{(x.grid_entries||[]).map(e=><li key={e.id}>{e.drivers?.name}: {e.teams?.name} <button onClick={()=>del(e.id)}>remove</button></li>)}</ul>
 <div className="row"><select onChange={e=>setF({...f,driver:e.target.value})}><option value="">Driver</option>{driverRows.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
 <select onChange={e=>setF({...f,car:e.target.value})}><option value="">Car</option>{teamRows.flatMap(t=>(t.cars||[]).map(c=><option key={c.id} value={c.id}>{t.name} {c.model} ({c.year})</option>))}</select>
 <button className="btn" onClick={()=>add(x.id)}>Add to grid</button></div></div>)}</>}
const clamp=(value,min=0,max=100)=>Math.min(max,Math.max(min,value));
const DEFAULT_SETUP={aero:50,suspension:50,tyreCare:50};
const DEFAULT_STRATEGY={tyre:'medium',stops:1};
const PHASE_LABELS={practice:'Practice',qualifying:'Qualifying',sprint:'Sprint',race:'Grand Prix'};
export function Simulate(){
 const grids=useQ(()=>sb.from('grids').select('id,name,year').order('year',{ascending:false}));
 const [gid,setG]=useState('');const [rid,setR]=useState('');const [phaseIndex,setPhaseIndex]=useState(0);
 const [weekendStarted,setWeekendStarted]=useState(false);const [weekendComplete,setWeekendComplete]=useState(false);
 const [results,setResults]=useState({});const [setups,setSetups]=useState({});const [strategies,setStrategies]=useState({});
 const grid=grids.data?.find(g=>String(g.id)===gid);
 const races=useQ(()=>grid?sb.from('races').select('*').eq('year',grid.year).order('round'):Promise.resolve({data:[],error:null}),[grid?.year]);
 const selectedRace=races.data?.find(r=>String(r.id)===rid);
 const entriesQuery=useQ(()=>gid?sb.from('grid_entries').select('*,drivers(*,driver_ratings(*)),teams(*),cars(*)').eq('grid_id',gid):Promise.resolve({data:[],error:null}),[gid]);
 const entries=(entriesQuery.data||[]).filter(e=>e.drivers&&e.teams&&e.cars).map(e=>({
  driver:e.drivers,team:e.teams,d:one(e.drivers.driver_ratings)||{},c:e.cars
 }));
 const phases=selectedRace?.is_sprint?['practice','qualifying','sprint','race']:['practice','qualifying','race'];
 const phase=phases[Math.min(phaseIndex,phases.length-1)];
 const phaseResult=results[phase];
 const teams=[...new Map(entries.map(e=>[e.team.id,e.team])).values()];
 const preparedEntries=entries.map(e=>{
  const setup={...DEFAULT_SETUP,...setups[e.team.id]};
  return {...e,c:{
   ...e.c,
   speed:clamp((e.c.speed??50)+(50-setup.aero)*.12),
   qualifying:clamp((e.c.qualifying??50)+(setup.aero-50)*.1+(setup.suspension-50)*.08),
   race:clamp((e.c.race??50)+(setup.suspension-50)*.1),
   performance:clamp((e.c.performance??50)+(50-setup.tyreCare)*.05),
   reliability:clamp((e.c.reliability??50)+(setup.tyreCare-50)*.12)
  }};
 });
 useEffect(()=>{setR('');setWeekendStarted(false);setWeekendComplete(false);setPhaseIndex(0);setResults({})},[gid]);
 const updateTeam=(setter,id,key,value)=>setter(current=>({...current,[id]:{...current[id],[key]:value}}));
 const startWeekend=()=>{setWeekendStarted(true);setWeekendComplete(false);setPhaseIndex(0);setResults({})};
 const runPhase=()=>{
  if(preparedEntries.length<2)return alert('Add at least 2 complete driver and car entries to this grid.');
  let rows;
  if(phase==='practice')rows=practice(preparedEntries);
  if(phase==='qualifying')rows=qualify(preparedEntries);
  if(phase==='sprint'){
   const qualifying=results.qualifying||[];
   rows=race(qualifying,{sprint:true,strategies});
  }
  if(phase==='race'){
   const startRows=selectedRace?.is_sprint?(results.sprint||[]).map(e=>({...e,grid:e.pos})):results.qualifying||[];
   rows=race(startRows,{strategies});
  }
  setResults(current=>{
   const next={...current,[phase]:rows};
   phases.slice(phaseIndex+1).forEach(name=>delete next[name]);
   return next;
  });
  setWeekendComplete(false);
 };
 const advance=()=>{if(phaseIndex<phases.length-1)setPhaseIndex(i=>i+1);else setWeekendComplete(true)};
 const setSetup=(id,key,value)=>updateTeam(setSetups,id,key,value);
 const setStrategy=(id,key,value)=>updateTeam(setStrategies,id,key,value);
 const isQualifying=phase==='qualifying';const isPractice=phase==='practice';
 const getPosition=(entry,index)=>isPractice?entry.practicePos:isQualifying?entry.grid:entry.dnf?'DNF':entry.pos;
 return <section className="weekend">
  <div className="weekend-heading"><div><p className="eyebrow">RACE OPERATIONS</p><h2>Race Weekend</h2>
   <p className="muted">Build your setup, qualify the grid, then call the race strategy.</p></div>
   {selectedRace&&<div className="race-round">ROUND <strong>{selectedRace.round||'—'}</strong></div>}
  </div>
  <div className="weekend-select">
   <label>Race grid<select value={gid} onChange={e=>{setG(e.target.value);setR('')}}><option value="">Choose a grid</option>{grids.data?.map(g=><option key={g.id} value={g.id}>{g.name} · {g.year}</option>)}</select></label>
   <label>Grand Prix<select value={rid} onChange={e=>{setR(e.target.value);setWeekendStarted(false);setWeekendComplete(false);setResults({});setPhaseIndex(0)}} disabled={!grid||races.loading}><option value="">Choose a race</option>{races.data?.map(r=><option key={r.id} value={r.id}>R{r.round} · {r.name}</option>)}</select></label>
   <button className="btn weekend-start" disabled={!grid||!selectedRace||entries.length<2} onClick={startWeekend}>
    {weekendStarted?'Restart weekend':'Start race weekend'}
   </button>
  </div>
  <QueryStatus query={grids} empty="Create a grid before starting a race weekend."/>
  {grid&&<QueryStatus query={races} empty="No races found for this grid's season. Add the calendar in Admin."/>}
  {grid&&selectedRace&&<QueryStatus query={entriesQuery} empty="Add at least two complete driver and car entries to this grid."/>}
  {selectedRace&&<div className="circuit-panel">
   <svg className="circuit-map" viewBox="0 0 180 110" role="img" aria-label="Circuit illustration">
    <path d="M22 72 33 32 68 20 92 35 127 21 155 38 148 66 164 82 133 94 105 81 77 94 49 81 22 72Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round"/>
    <path d="M22 72 33 32 68 20" fill="none" stroke="var(--red)" strokeWidth="5" strokeLinecap="round"/>
   </svg>
   <div><p className="eyebrow">CIRCUIT</p><h3>{selectedRace.circuit||selectedRace.name}</h3>
    <p>{selectedRace.country||'Race weekend'}{selectedRace.date?` · ${selectedRace.date}`:''}</p></div>
   <div className="circuit-facts"><span>{selectedRace.laps||57}<small> LAPS</small></span><span>{selectedRace.is_sprint?'SPRINT FORMAT':'GRAND PRIX'}</span></div>
  </div>}
  {!weekendStarted&&<div className="weekend-empty">
   <h3>Prepare for lights out</h3>
   <p>Choose a race grid and event to open the garage and begin the weekend.</p>
   {grid&&entries.length>0&&entries.length<2&&<p className="muted">This grid needs at least two entries with a driver, team, and car.</p>}
  </div>}
  {weekendStarted&&<>
   <div className="session-timeline">{phases.map((name,index)=><button key={name}
    className={`session-step ${phaseIndex===index?'current':''} ${results[name]?'complete':''}`}
    onClick={()=>{if(index<=phaseIndex&&!weekendComplete)setPhaseIndex(index)}}
    disabled={weekendComplete||index>phaseIndex}>
    <span className="session-number">{results[name]?'✓':`0${index+1}`}</span><span>{PHASE_LABELS[name]}</span>
   </button>)}</div>
   {weekendComplete?<div className="weekend-empty finish-banner"><p className="eyebrow">CHEQUERED FLAG</p>
    <h3>{selectedRace.name} complete</h3><p>Weekend results are ready. Start another weekend to run a new event.</p>
    <button className="btn" onClick={()=>{setWeekendStarted(false);setWeekendComplete(false);setResults({})}}>Return to race selection</button>
   </div>:<>
    <div className="session-header"><div><p className="eyebrow">SESSION {String(phaseIndex+1).padStart(2,'0')}</p>
     <h3>{PHASE_LABELS[phase]}</h3><p>{phase==='practice'?'Dial in the car before qualifying.':phase==='qualifying'?'Set the starting order for the weekend.':phase==='sprint'?'A short-format race for extra points.':'Choose your race strategy and go racing.'}</p>
    </div>
     {phaseResult&&<button className="btn" onClick={advance}>{phaseIndex===phases.length-1?'Finish weekend':'Continue to '+PHASE_LABELS[phases[phaseIndex+1]]}</button>}
    </div>
    {isPractice&&<div className="team-garage"><div className="section-title"><h3>Garage setup</h3><p>Adjust each team’s car before practice.</p></div>
     {teams.map(team=>{const setup={...DEFAULT_SETUP,...setups[team.id]};return <article className="team-panel" key={team.id} style={{'--team-color':team.color||'#d3202f'}}>
      <h4>{team.name}</h4>
      <div className="setup-controls">
       {[[ 'aero','Aero balance','Low drag ↔ Downforce'],['suspension','Mechanical grip','Stable ↔ Responsive'],['tyreCare','Tyre management','Attack ↔ Preserve']].map(([key,label,help])=>
        <label key={key}>{label}<span className="range-value">{setup[key]}</span><input type="range" min="0" max="100" value={setup[key]} onChange={e=>setSetup(team.id,key,+e.target.value)}/><small>{help}</small></label>)}
      </div>
     </article>})}
    </div>}
    {(phase==='sprint'||phase==='race')&&<div className="strategy-panel"><div className="section-title"><h3>Race strategy</h3><p>Choose a tyre and pit plan for every team.</p></div>
     <div className="strategy-grid">{teams.map(team=>{const strategy={...DEFAULT_STRATEGY,...strategies[team.id]};return <article className="strategy-card" key={team.id} style={{'--team-color':team.color||'#d3202f'}}>
      <strong>{team.name}</strong><label>Tyre compound<select value={strategy.tyre} onChange={e=>setStrategy(team.id,'tyre',e.target.value)}><option value="soft">Soft · fastest</option><option value="medium">Medium · balanced</option><option value="hard">Hard · durable</option></select></label>
      <label>Pit stops<select value={strategy.stops} onChange={e=>setStrategy(team.id,'stops',Number(e.target.value))}><option value={0}>No stop · high wear</option><option value={1}>One stop</option><option value={2}>Two stops</option></select></label>
     </article>})}</div>
    </div>}
    {!phaseResult&&<button className="btn run-session" onClick={runPhase}>{isPractice?'Run practice':phase==='qualifying'?'Start qualifying':phase==='sprint'?'Start sprint':'Start Grand Prix'}</button>}
    {phaseResult&&<div className="results-panel"><div className="section-title"><h3>{PHASE_LABELS[phase]} classification</h3><p>{phase==='practice'?'Practice pace':isQualifying?'Starting grid':'Session results'}</p></div>
     <div className="scroll"><table className="race-table"><thead><tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>CAR</th>{phase==='race'||phase==='sprint'?<th>PTS</th>:null}</tr></thead>
      <tbody>{phaseResult.map((entry,index)=><tr key={`${entry.driver.id}-${index}`} className={index===0?'leader':''}>
       <td className="position-cell">{getPosition(entry,index)}</td><td><strong>{entry.driver.name}</strong>{entry.driver.code&&<small> · {entry.driver.code}</small>}</td>
       <td><span className="team-chip" style={{'--team-color':entry.team.color||'#d3202f'}}>{entry.team.name}</span></td>
       <td>{entry.cars?.model||entry.c.model||'—'}</td>{phase==='race'||phase==='sprint'?<td>{entry.pts}</td>:null}
      </tr>)}</tbody></table></div>
    </div>}
   </>}
  </>}
 </section>
}
