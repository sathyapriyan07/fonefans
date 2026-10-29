import {useEffect,useRef,useState} from 'react';import {Link,useParams} from 'react-router-dom';
import {sb} from './supabase.js';import {activateDriverBoost,advanceRaceIfRunning,advanceRaceLap,applyPracticeSubstitutions,applyTeamPerformanceBoosts,calculateStandings,calculateTeammateHeadToHead,createRaceState,getBestCareerPositions,getClassification,getWeekendAwards,getWeekendPhases,practice,qualify,setPitInstruction,setTeamRaceAdjustments} from './sim.js';
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
const PHASE_LABELS={practice1:'Practice 1',practice2:'Practice 2',practice3:'Practice 3',sprintQualifying:'Sprint Qualifying',sprint:'Sprint',qualifying:'Qualifying',race:'Grand Prix'};
const sessionLabel=session=>PHASE_LABELS[session]||session;
async function loadTeammateResultRows(driverIds){
 const rows=[];
 for(let offset=0;;offset+=1000){
  const {data,error}=await sb.from('race_results')
   .select('grid_id,race_id,driver_id,team_id,session_type,position,points,races(year),grids(year)')
   .in('driver_id',driverIds)
   .order('grid_id').order('race_id').order('session_type').order('driver_id')
   .range(offset,offset+999);
  if(error)throw error;
  rows.push(...(data||[]));
  if(!data||data.length<1000)return rows;
 }
}
async function loadSavedRaceResults(){
 const rows=[];
 for(let offset=0;;offset+=1000){
  const {data,error}=await sb.from('race_results')
   .select('grid_id,race_id,driver_id,team_id,session_type,position,points,status,laps_completed,total_time,best_lap,pole_position,sprint_pole,race_win,sprint_win,fastest_lap,grand_slam,retired,result,races(year,round,name,circuit),grids(year),drivers(id,name,code,number),teams(id,name,logo_normal,color)')
   .order('race_id',{ascending:false}).order('grid_id').order('session_type').order('position').order('driver_id')
   .range(offset,offset+999);
  if(error)throw error;
  rows.push(...(data||[]));
  if(!data||data.length<1000)return rows;
 }
}
function buildResultRecords(grid,race,sessionType,rows,awards){
 return rows.map(row=>{
  const position=Number(row.practicePos??row.position??row.grid??row.pos);
  const retired=Boolean(row.retired||row.status==='Retired');
  const fastestLap=String(row.driver.id)===String(sessionType==='sprint'?awards.sprintFastestLapDriverId:awards.fastestLapDriverId);
  const achievement={
   pole_position:sessionType==='qualifying'&&String(row.driver.id)===String(awards.poleDriverId),
   sprint_pole:sessionType==='sprintQualifying'&&String(row.driver.id)===String(awards.sprintPoleDriverId),
   race_win:sessionType==='race'&&String(row.driver.id)===String(awards.raceWinnerId),
   sprint_win:sessionType==='sprint'&&String(row.driver.id)===String(awards.sprintWinnerId),
   fastest_lap:(sessionType==='race'||sessionType==='sprint')&&fastestLap,
   grand_slam:sessionType==='race'&&String(row.driver.id)===String(awards.grandSlamDriverId),
   retired
  };
  const status=row.status||(retired?'Retired':row.sessionStatus||'Complete');
  return {
   grid_id:grid.id,race_id:race.id,driver_id:row.driver.id,team_id:row.team.id,
   session_type:sessionType,position,points:row.pts||0,status,
   laps_completed:row.lapsCompleted||row.lapCount||0,
   total_time:Number.isFinite(row.totalTime)?row.totalTime:null,
   best_lap:Number.isFinite(row.bestLap)?row.bestLap:null,
   ...achievement,updated_at:new Date().toISOString(),
   result:{
    sessionType,sessionLabel:sessionLabel(sessionType),
    driver:{id:row.driver.id,name:row.driver.name,code:row.driver.code,number:row.driver.number},
    team:{id:row.team.id,name:row.team.name,logo_normal:row.team.logo_normal,color:row.team.color},
    car:{model:row.cars?.model||row.c?.model||''},position,gridPosition:row.gridPosition??row.grid,
    points:row.pts||0,status,retired,lapsCompleted:row.lapsCompleted||row.lapCount||0,
    totalTime:Number.isFinite(row.totalTime)?row.totalTime:null,bestLap:Number.isFinite(row.bestLap)?row.bestLap:null,
    lastLap:Number.isFinite(row.lastLap)?row.lastLap:null,sectors:row.sectors||[],pitStops:row.pitStops||0,pitHistory:row.pitHistory||[],
    lapHistory:row.lapHistory||[],penalties:row.penalties||[],events:row.events||[],substituteFor:row.substituteFor||null,
    awards:achievement
   }
  };
 });
}
const resultAwards=row=>[
 row.pole_position&&'Pole',
 row.sprint_pole&&'Sprint pole',
 row.race_win&&'Win',
 row.sprint_win&&'Sprint win',
 row.fastest_lap&&'Fastest lap',
 row.grand_slam&&'Grand Slam'
].filter(Boolean);
const latestImg=(d,k)=>[...(d.driver_images||[])].sort((a,b)=>b.year-a.year)[0]?.[k];
const driverSeasonImage=(driver,year)=>{
 const images=driver.driver_images||[];
 const image=images.find(item=>Number(item.year)===Number(year))||[...images].sort((a,b)=>b.year-a.year)[0];
 return image?.card_url||image?.pole_url||image?.grid_url;
};
function SessionPodium({entries,race,phaseLabel,fastestLap=Infinity,raceResult=false}){
 const podium=raceResult?entries.filter(entry=>!entry.retired).slice(0,3):entries.slice(0,3);
 const leader=podium[0];
 if(!podium.length)return null;
 return <section className="practice-podium" aria-label={`${phaseLabel} top three`}>
  <div className="practice-podium-heading"><h4>{race?.name||'Race'} · {phaseLabel} top three</h4></div>
  <div className="practice-podium-grid">{podium.map((entry,index)=>{
   let gap;
   if(raceResult)gap=index===0?'WINNER':entry.lapsCompleted<leader.lapsCompleted?`+${leader.lapsCompleted-entry.lapsCompleted} LAP`:`+${(entry.totalTime-leader.totalTime).toFixed(3)}`;
   else gap=Number.isFinite(entry.bestLap)&&Number.isFinite(fastestLap)?`+${(entry.bestLap-fastestLap).toFixed(3)}`:'—';
   const portrait=driverSeasonImage(entry.driver,race?.year);
   return <article className={`practice-podium-card practice-podium-${index+1}`} key={entry.driver.id} style={{'--team-color':entry.team.color||'#d3202f'}}>
    <div className="practice-podium-portrait">{portrait?<img src={portrait} alt={`${entry.driver.name} portrait`}/>:<span>{entry.driver.code||entry.driver.name.trim().split(/\s+/).pop()?.slice(0,1)}</span>}<strong className="practice-podium-position">P{index+1}</strong></div>
    <div className="practice-podium-details"><span className="practice-podium-team">{entry.team.logo_normal&&<img src={entry.team.logo_normal} alt=""/>}{entry.team.name}</span><strong className="practice-podium-driver">{entry.driver.name.toUpperCase()}</strong><span className="practice-podium-gap">{gap}</span></div>
   </article>;
  })}</div>
 </section>;
}
const CAR=['speed','race','overtaking','defence','performance','qualifying','reliability'];
const one=x=>Array.isArray(x)?x[0]:x;
const FALLBACK_TRACK='M22 72 33 32 68 20 92 35 127 21 155 38 148 66 164 82 133 94 105 81 77 94 49 81 22 72Z';
function LiveTrack({state,selectedDriverId,onSelect}){
 const pathRef=useRef(null),pitPathRef=useRef(null),displayedRef=useRef([]),frameRef=useRef(null);
 const [points,setPoints]=useState([]),[filter,setFilter]=useState('all');
 const path=state.circuit.trackPath||FALLBACK_TRACK;
 useEffect(()=>{
  const element=pathRef.current;
  const pitPath=pitPathRef.current;
  if(!element||!pitPath)return;
  try{
   const length=element.getTotalLength();
   const pitLength=pitPath.getTotalLength();
   const targets=length>0?state.cars.map(car=>{
    const retired=car.retired,progress=retired?(car.retiredProgress??car.trackProgress):car.trackProgress;
    const inPit=Boolean(car.pitState?.complete&&car.pitState.entryLap===state.lap);
    const point=inPit?pitPath.getPointAtLength(pitLength*car.pitState.progress):element.getPointAtLength(length*progress);
    return {id:car.driverId,x:point.x,y:point.y,color:car.entry.team?.color||'#d3202f',name:car.entry.driver?.name||'Driver',retired,inPit,pitProgress:inPit?car.pitState.progress:0,progress,position:car.position,lap:car.lapsCompleted,pitState:car.pitState,pitStatus:car.pitStatus,retirementReason:car.retirementReason};
   }):[];
   const from=displayedRef.current.length?displayedRef.current:targets.map(point=>({...point}));
   if(frameRef.current)cancelAnimationFrame(frameRef.current);
   const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
   const duration=reducedMotion?0:260,start=performance.now();
   const byId=new Map(from.map(point=>[String(point.id),point]));
   const animate=now=>{
    const amount=duration?Math.min(1,(now-start)/duration):1;
    const next=targets.map(target=>{
     const previous=byId.get(String(target.id))||target;
     if(target.inPit){
      const pitProgress=amount*target.pitProgress;
      const location=pitPath.getPointAtLength(pitLength*pitProgress);
      return {...target,x:location.x,y:location.y,pitProgress};
     }
     return {...target,x:previous.x+(target.x-previous.x)*amount,y:previous.y+(target.y-previous.y)*amount};
    });
    displayedRef.current=next;setPoints(next);
    if(amount<1)frameRef.current=requestAnimationFrame(animate);
   };
   frameRef.current=requestAnimationFrame(animate);
  }catch(error){console.error('Could not render circuit geometry:',error);setPoints([])}
  return()=>{if(frameRef.current)cancelAnimationFrame(frameRef.current)};
 },[path,state.cars,state.lap]);
 const visible=points.filter(point=>filter==='all'||(filter==='retired'?point.retired:!point.retired));
 const selected=points.find(point=>String(point.id)===String(selectedDriverId));
 return <div className="live-track-panel"><div className="section-title"><div><h3>Live track</h3><p>{state.circuit.trackPath?'Admin-defined layout':'Illustrative schematic — not geographic'}</p></div>
  <div className="track-controls" role="group" aria-label="Track marker filter">{[['all','All'],['active','Racing'],['retired','Retired']].map(([key,label])=><button key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</div></div>
  <svg className="live-track" viewBox="0 0 180 110" role="img" aria-label="Live track position display">
   <path ref={pathRef} d={path} fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round"/>
   <path ref={pitPathRef} d="M 18 105 L 162 105" fill="none" stroke="#777" strokeWidth="2" strokeDasharray="4 3"/>
   <text x="18" y="101" fontSize="4" fill="currentColor">PIT LANE</text>
   {visible.map(point=><circle key={point.id} cx={point.x} cy={point.y} r={String(point.id)===String(selectedDriverId)?4.5:3.2} fill={point.retired?'#777':point.color} stroke="white" strokeWidth="1.5" role="button" tabIndex="0" aria-label={`${point.name}${point.retired?` retired at lap ${point.lap}`:point.inPit?' in pit lane':''}`} onClick={()=>onSelect(point.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' ')onSelect(point.id)}}><title>{point.name}{point.retired?` · retired at lap ${point.lap} · ${point.retirementReason}`:point.inPit?` · pit lane ${point.pitState.phase}`:''}</title></circle>)}
  </svg>
  {selected&&<div className="track-selected" aria-live="polite"><strong>{selected.name}</strong><span>P{selected.position} · Lap {selected.lap}</span><span>{selected.retired?`Retired: ${selected.retirementReason} (lap ${selected.lap})`:selected.inPit?`Pit lane · ${selected.pitState.phase} ${Math.round(selected.pitState.progress*100)}%`:selected.pitStatus}</span><span>{Math.round(selected.progress*100)}% track progress</span></div>}
 </div>
}
export function Home(){const n=useQ(async()=>{const c=async t=>{const {count,error}=await sb.from(t).select('*',{count:'exact',head:true});if(error)throw error;return count};const [drivers,teams,races]=await Promise.all([c('drivers'),c('teams'),c('races')]);return {drivers,teams,races}});
 return <section className="hero"><h1>Build the grid. Run the season.</h1><p>Set up your cars, manage race strategy, and take your custom grid through a full race weekend.</p>
 <div className="row"><Link className="btn" to="/simulate">Start a race weekend</Link><Link className="btn ghost" to="/grids">Build a grid</Link></div>
 {n.data&&<p className="muted">{n.data.drivers} drivers, {n.data.teams} teams, {n.data.races} races loaded</p>}<QueryStatus query={n}/></section>}
export function Drivers(){const d=useQ(()=>sb.from('drivers').select('*,driver_images(*)').order('name'));
 return <><h2>Drivers</h2><QueryStatus query={d} empty="No drivers yet."/><div className="grid">{d.data?.map(x=><Link key={x.id} to={'/drivers/'+x.id} className="card driver-card">{latestImg(x,'pole_url')&&<img className="driver-pole-image" src={latestImg(x,'pole_url')} alt="" aria-hidden="true"/>}<div className="driver-card-copy"><h3>{x.name}</h3><p>{x.code} #{x.number}</p></div></Link>)}</div></>}
export function Driver(){const {id}=useParams();const d=useQ(()=>sb.from('drivers').select('*,driver_images(*),driver_ratings(*)').eq('id',id).single(),[id]);
 const lineups=useQ(()=>sb.from('team_driver_lineups').select('*,teams(id,name,logo_normal,color)').or(`driver_1_id.eq.${id},driver_2_id.eq.${id},reserve_driver_id.eq.${id}`).order('year',{ascending:false}),[id]);
 const raceResults=useQ(()=>sb.from('race_results').select('grid_id,race_id,session_type,position,points,status,laps_completed,total_time,best_lap,result,pole_position,sprint_pole,race_win,sprint_win,fastest_lap,grand_slam,retired,races(year,round,name),grids(year),teams(id,name,logo_normal,color)').eq('driver_id',id),[id]);
 const teammateIds=[...new Set((lineups.data||[]).flatMap(lineup=>['driver_1_id','driver_2_id','reserve_driver_id'].map(slot=>lineup[slot]).filter(teammateId=>teammateId!==null&&teammateId!==undefined&&String(teammateId)!==String(id))).map(String))];
 const teammateKey=teammateIds.slice().sort().join(',');
 const headToHeadResults=useQ(()=>teammateIds.length?loadTeammateResultRows([id,...teammateIds]):Promise.resolve([]),[id,teammateKey]);
 const rosterDrivers=useQ(()=>sb.from('drivers').select('id,name,code,number,driver_images(pole_url,year)').order('name'));
 if(d.loading||d.error||!d.data)return <><h2>Driver</h2><QueryStatus query={d}/></>;
 const driver=d.data;const r=one(driver.driver_ratings)||{};
 const images=[...(driver.driver_images||[])].sort((a,b)=>b.year-a.year);
 const heroImage=latestImg(driver,'card_url')||latestImg(driver,'pole_url');
 const years=[...new Set(images.map(image=>image.year))];
 const driverById=new Map((rosterDrivers.data||[]).map(rosterDriver=>[String(rosterDriver.id),rosterDriver]));
 const teammateHeadToHead=calculateTeammateHeadToHead(id,lineups.data||[],headToHeadResults.data||[]);
 const lineupSlots=[['driver_1_id','Race driver 1'],['driver_2_id','Race driver 2'],['reserve_driver_id','Reserve driver']];
 const history=[...(raceResults.data||[])].sort(resultOrder);
 const weekendHistory=groupRaceWeekends(history);
 const careerPoints=history.reduce((sum,row)=>sum+Number(row.points||0),0);
 const raceFinishes=history.filter(row=>row.session_type==='race');
 const bestCareerPositions=getBestCareerPositions(history);
 const careerWins=raceFinishes.filter(row=>row.race_win).length;
 const careerPodiums=raceFinishes.filter(row=>row.position<=3).length;
 const careerP2s=raceFinishes.filter(row=>Number(row.position)===2&&!row.retired&&row.status!=='Retired').length;
 const careerP3s=raceFinishes.filter(row=>Number(row.position)===3&&!row.retired&&row.status!=='Retired').length;
 const careerSprintWins=history.filter(row=>row.sprint_win).length;
 const careerPoles=history.filter(row=>row.pole_position).length;
 const careerSprintPoles=history.filter(row=>row.sprint_pole).length;
 const careerFastestLaps=history.filter(row=>row.session_type==='race'&&row.fastest_lap).length;
 const careerSprintFastestLaps=history.filter(row=>row.session_type==='sprint'&&row.fastest_lap).length;
 const careerRetirements=history.filter(row=>row.retired).length;
 const careerGrandSlams=history.filter(row=>row.grand_slam).length;
 const imageLabels={pole_url:'Pole portrait',grid_url:'Grid portrait',card_url:'Driver card'};
 return <><div className="driver-profile-top"><h2>{driver.name} <small>#{driver.number} {driver.code}</small></h2>
 {heroImage&&<div className="driver-profile-hero"><img src={heroImage} alt={`${driver.name} portrait`}/></div>}</div>
 <p>{driver.nationality_logo&&<img height="16" src={driver.nationality_logo} alt=""/>} {driver.nationality}</p><p>{driver.bio}</p>
 <div className="split"><div>{['race','overtaking','speed','experience','qualifying','defence'].map(k=><Bar key={k} l={k} v={r[k]}/>)}</div>
 <div className="driver-detail-content"><section className="driver-team-history"><h3>Teams &amp; teammates</h3><QueryStatus query={lineups} empty="No team history recorded."/><QueryStatus query={rosterDrivers}/>
 {lineups.data?.map(lineup=>{const assigned=lineupSlots.map(([key,label])=>({id:lineup[key],label})).filter(slot=>slot.id);const role=assigned.find(slot=>String(slot.id)===String(driver.id))?.label;
  return <article className="driver-team-season" key={`${lineup.team_id}-${lineup.year}`}><div className="driver-team-season-head"><Link className="driver-team-link" to={`/teams/${lineup.team_id}`}>{lineup.teams?.logo_normal&&<img src={lineup.teams.logo_normal} alt=""/>}<strong>{lineup.teams?.name||'Team'}</strong></Link><span>{lineup.year===new Date().getFullYear()?'Current season':lineup.year}</span>{role&&<small>{role}</small>}</div>
   <div className="driver-teammates">{assigned.filter(slot=>String(slot.id)!==String(driver.id)).map(slot=>{const teammate=driverById.get(String(slot.id));return <Link key={`${lineup.year}-${slot.id}`} to={`/drivers/${slot.id}`} className="card driver-card driver-teammate-card">{teammate&&latestImg(teammate,'pole_url')&&<img className="driver-pole-image" src={latestImg(teammate,'pole_url')} alt="" aria-hidden="true"/>}<div className="driver-card-copy"><small>{slot.label}</small><h4>{teammate?.name||`Driver #${slot.id}`}</h4></div></Link>})}</div>
  </article>})}</section>
  <section className="teammate-head-to-head"><div className="section-title"><div><h3>Teammate head-to-head</h3><p>Session results from weekends where you shared a team</p></div></div><QueryStatus query={headToHeadResults}/>
   {!headToHeadResults.loading&&!headToHeadResults.error&&!teammateHeadToHead.length&&<p className="muted">No shared teammate results saved yet.</p>}
   {!!teammateHeadToHead.length&&<div className="teammate-head-to-head-grid">{teammateHeadToHead.map(record=>{const teammate=driverById.get(String(record.teammateId));return <article className="teammate-h2h-card" key={record.key} style={{'--team-color':record.teamColor||'#d3202f'}}>
    <header className="teammate-h2h-header"><div><small>{record.teamName} · {record.years.join(', ')}</small><h4>{teammate?.name||`Driver #${record.teammateId}`}</h4></div>{teammate&&<Link to={`/drivers/${teammate.id}`} aria-label={`View ${teammate.name}`} className="teammate-h2h-link">Profile ↗</Link>}</header>
    <div className="teammate-h2h-stats">
     {[['Grand Prix qualifying',record.qualifying],['Grand Prix races',record.race],['Sprint qualifying',record.sprintQualifying],['Sprint races',record.sprint]].map(([label,score])=><div className="teammate-h2h-stat" key={label}><span>{label}</span><strong>{score.wins}–{score.losses}{score.ties?`–${score.ties}`:''}</strong></div>)}
    </div>
    <footer className="teammate-h2h-points"><span>Shared Grand Prix starts <strong>{record.sharedRaces}</strong></span><span>Points <strong>{record.driverPoints}–{record.teammatePoints}</strong></span></footer>
   </article>})}</div>}
  </section>
  <section className="race-history"><div className="section-title"><div><h3>Career achievements</h3><p>{careerPoints} points · {raceFinishes.length} Grand Prix starts</p></div></div><div className="career-achievements">
  {[['GP wins',careerWins],['P2 finishes',careerP2s],['P3 finishes',careerP3s],['Sprint wins',careerSprintWins],['Podiums',careerPodiums],['Poles',careerPoles],['Sprint poles',careerSprintPoles],['Fastest laps',careerFastestLaps],['Sprint fastest laps',careerSprintFastestLaps],['Retirements',careerRetirements],['Grand Slams',careerGrandSlams],['Best starting position',bestCareerPositions.bestStartingPosition?`P${bestCareerPositions.bestStartingPosition}`:'—'],['Best finish',Number.isFinite(bestCareerPositions.bestFinish)?`P${bestCareerPositions.bestFinish}`:'—'],['Best qualifying',Number.isFinite(bestCareerPositions.bestQualifying)?`P${bestCareerPositions.bestQualifying}`:'—']].map(([label,count])=><div className="career-achievement" key={label}><strong>{count}</strong><span>{label}</span></div>)}
 </div><div className="section-title"><div><h3>Race history</h3><p>All saved sessions and session awards</p></div></div><QueryStatus query={raceResults} empty="No saved race results yet."/>
  {!!weekendHistory.length&&<div className="weekend-history">{weekendHistory.map(weekend=><details className="weekend-history-item" key={weekend.key}>
   <summary className="weekend-history-summary"><span className="weekend-history-year">{weekend.year||'—'}</span><span className="weekend-history-name"><small>ROUND {weekend.round||'—'}</small><strong>{weekend.raceName}</strong></span><span className="weekend-history-count">{weekend.sessions.length} sessions</span><strong className="weekend-history-points">{weekend.pointsTotal} pts</strong></summary>
   <div className="weekend-history-details"><div className="weekend-history-columns driver-weekend-columns"><span>SESSION</span><span>TEAM</span><span>POS</span><span>PTS</span><span>AWARDS</span><span>TIME</span></div>
    {weekend.sessions.map(session=>session.rows.map(row=><div className="weekend-history-row driver-weekend-row" key={`${session.session_type}-${row.driver_id}`}><span data-label="Session">{sessionLabel(session.session_type)}</span><span data-label="Team"><Link to={`/teams/${row.teams?.id}`}>{row.teams?.name||'Team'}</Link></span><span data-label="Position">{row.position===1?'P1':`P${row.position}`}{row.retired?' · DNF':''}</span><span data-label="Points">{row.points}</span><span data-label="Awards">{resultAwards(row).join(' · ')||'—'}</span><span data-label="Time">{row.total_time!==null&&Number.isFinite(Number(row.total_time))?formatTime(Number(row.total_time)):'—'}</span></div>))}
   </div>
  </details>)}</div>}
 </section>
 <div className="driver-gallery">{years.map(year=><section className="driver-gallery-year" key={year}><h3>{year}</h3><div className="driver-gallery-grid">{images.filter(image=>image.year===year).flatMap(image=>['pole_url','grid_url','card_url'].filter(key=>image[key]).map(key=><figure key={`${image.id}-${key}`}><img src={image[key]} alt={`${driver.name} ${imageLabels[key]}, ${year}`}/><figcaption>{imageLabels[key]}</figcaption></figure>))}</div></section>)}</div></div></div></>}
const CarCard=({c,sub,teamLogo,teamName})=><div className="card">{c.image_url&&<img src={c.image_url}/>}<h3>{c.model} <small>{c.year}</small></h3><p className="car-sub">{teamLogo&&<img className="car-team-logo" src={teamLogo} alt={`${teamName||'Team'} logo`} />}{sub}</p>{CAR.map(k=><Bar key={k} l={k} v={c[k]}/>)}</div>;
export function Cars(){const c=useQ(()=>sb.from('cars').select('*,teams(name,logo_normal)').order('year',{ascending:false}));
 return <><h2>Cars</h2><QueryStatus query={c} empty="No cars yet."/><div className="grid">{c.data?.map(x=><CarCard key={x.id} c={x} teamLogo={x.teams?.logo_normal} teamName={x.teams?.name} sub={x.engine||''}/>)}</div></>}
export function Teams(){const t=useQ(()=>sb.from('teams').select('*').order('name'));
 return <><h2>Teams</h2><QueryStatus query={t} empty="No teams yet."/><div className="grid">{t.data?.map(x=><Link key={x.id} to={'/teams/'+x.id} className="card team-card" style={{borderTop:'6px solid '+x.color}}><h3>{x.name}</h3>{x.logo_normal&&<img src={x.logo_normal} alt={`${x.name} logo`}/>}</Link>)}</div></>}
export function Team(){const {id}=useParams();const t=useQ(()=>sb.from('teams').select('*,cars(*)').eq('id',id).single(),[id]);
 const lineups=useQ(()=>sb.from('team_driver_lineups').select('*').eq('team_id',id).order('year',{ascending:false}),[id]);
 const raceResults=useQ(()=>sb.from('race_results').select('grid_id,race_id,session_type,driver_id,position,points,status,laps_completed,total_time,pole_position,sprint_pole,race_win,sprint_win,fastest_lap,grand_slam,retired,races(year,round,name),grids(year),drivers(id,name,code)').eq('team_id',id),[id]);
 const drivers=useQ(()=>sb.from('drivers').select('id,name,code,number,driver_images(pole_url,year)').order('name'));
 if(t.loading||t.error||!t.data)return <><h2>Team</h2><QueryStatus query={t}/></>;
 const team=t.data,driverById=new Map((drivers.data||[]).map(driver=>[String(driver.id),driver]));
 const teamRaceResults=new Map();
 for(const row of raceResults.data||[]){
  const key=`${row.grid_id}:${row.race_id}:${row.session_type}`;
  const event=teamRaceResults.get(key)||{...row,pointsTotal:0,bestPosition:Infinity,drivers:[]};
  event.pointsTotal+=Number(row.points)||0;event.bestPosition=Math.min(event.bestPosition,Number(row.position)||Infinity);
  event.drivers.push(row);teamRaceResults.set(key,event);
 }
 const teamHistory=[...teamRaceResults.values()].sort(resultOrder);
 const weekendHistory=groupRaceWeekends(raceResults.data||[]);
 const teamCareerPoints=teamHistory.reduce((sum,event)=>sum+event.pointsTotal,0);
 const teamWins=teamHistory.filter(event=>event.session_type==='race'&&event.drivers.some(row=>row.race_win)).length;
 const teamSprintWins=teamHistory.filter(event=>event.session_type==='sprint'&&event.drivers.some(row=>row.sprint_win)).length;
 const teamPodiums=teamHistory.filter(event=>event.session_type==='race').reduce((sum,event)=>sum+event.drivers.filter(row=>row.position<=3).length,0);
 const teamPoles=(raceResults.data||[]).filter(row=>row.pole_position).length;
 const teamSprintPoles=(raceResults.data||[]).filter(row=>row.sprint_pole).length;
 const teamFastestLaps=(raceResults.data||[]).filter(row=>row.session_type==='race'&&row.fastest_lap).length;
 const teamSprintFastestLaps=(raceResults.data||[]).filter(row=>row.session_type==='sprint'&&row.fastest_lap).length;
 const teamRetirements=(raceResults.data||[]).filter(row=>row.retired).length;
 const teamGrandSlams=(raceResults.data||[]).filter(row=>row.grand_slam).length;
 const lineupSlots=[['driver_1_id','Race driver 1'],['driver_2_id','Race driver 2'],['reserve_driver_id','Reserve driver']];
 return <><h2 style={{borderLeft:'8px solid '+team.color,paddingLeft:12}}>{team.name}</h2>{team.logo_detailed&&<img height="80" src={team.logo_detailed}/>}
 <section className="team-lineup-history"><h3>Driver lineups</h3><QueryStatus query={lineups} empty="No driver lineups recorded."/><QueryStatus query={drivers}/>
 {lineups.data?.map(lineup=><section className="team-lineup-season" key={lineup.year}><h4>{lineup.year}</h4><div className="grid team-lineup-cards">{lineupSlots.map(([key,label])=>{const driver=lineup[key]?driverById.get(String(lineup[key])):null;return driver?<Link key={key} to={`/drivers/${driver.id}`} className="card driver-card lineup-driver-card">{latestImg(driver,'pole_url')&&<img className="driver-pole-image" src={latestImg(driver,'pole_url')} alt="" aria-hidden="true"/>}<div className="driver-card-copy"><small>{label}</small><h3>{driver.name}</h3><p>{driver.code} #{driver.number}</p></div></Link>:<div key={key} className="card lineup-driver-card lineup-driver-empty"><small>{label}</small><p>Not assigned</p></div>})}</div></section>)}</section>
 <section className="race-history"><div className="section-title"><div><h3>Team achievements</h3><p>{teamCareerPoints} points · {teamWins} Grand Prix wins · {teamPodiums} driver podiums</p></div></div><div className="career-achievements">
  {[['GP wins',teamWins],['Sprint wins',teamSprintWins],['Podiums',teamPodiums],['Poles',teamPoles],['Sprint poles',teamSprintPoles],['Fastest laps',teamFastestLaps],['Sprint fastest laps',teamSprintFastestLaps],['Retirements',teamRetirements],['Grand Slams',teamGrandSlams]].map(([label,count])=><div className="career-achievement" key={label}><strong>{count}</strong><span>{label}</span></div>)}
 </div><div className="section-title"><div><h3>Race history</h3><p>All saved sessions and driver awards</p></div></div><QueryStatus query={raceResults} empty="No saved race results yet."/>
  {!!weekendHistory.length&&<div className="weekend-history">{weekendHistory.map(weekend=><details className="weekend-history-item" key={weekend.key}>
   <summary className="weekend-history-summary"><span className="weekend-history-year">{weekend.year||'—'}</span><span className="weekend-history-name"><small>ROUND {weekend.round||'—'}</small><strong>{weekend.raceName}</strong></span><span className="weekend-history-count">{weekend.sessions.length} sessions</span><strong className="weekend-history-points">{weekend.pointsTotal} pts</strong></summary>
   <div className="weekend-history-details"><div className="weekend-history-columns team-weekend-columns"><span>SESSION</span><span>DRIVER RESULTS</span><span>TEAM PTS</span></div>
    {weekend.sessions.map(session=><div className="weekend-history-row team-weekend-row" key={session.session_type}><span data-label="Session">{sessionLabel(session.session_type)}</span><span data-label="Driver results" className="weekend-driver-results">{[...session.rows].sort((a,b)=>a.position-b.position).map(row=><span className="team-result-driver" key={row.driver_id}><Link to={`/drivers/${row.drivers?.id}`}>{row.drivers?.code||row.drivers?.name||'Driver'}</Link> P{row.position}{row.retired?' DNF':''}{resultAwards(row).length>0&&<small> ({resultAwards(row).join(', ')})</small>}</span>)}</span><span data-label="Team points">{session.rows.reduce((sum,row)=>sum+(Number(row.points)||0),0)}</span></div>)}
   </div>
  </details>)}</div>}
 </section>
 <QueryStatus query={{...t,data:team.cars||[]}} empty="No cars registered for this team."/><div className="grid">{[...(team.cars||[])].sort((a,b)=>b.year-a.year).map(c=><CarCard key={c.id} c={c} sub={c.engine}/>)}</div></>}
export function Races(){const r=useQ(()=>sb.from('races').select('*').order('year',{ascending:false}).order('round'));
 return <><h2>Races</h2><QueryStatus query={r} empty="No races yet."/><table><tbody>{r.data?.map(x=><tr key={x.id}><td>{x.year}</td><td>R{x.round}</td><td>{x.name}</td><td>{x.circuit}</td><td>{x.date}</td><td>{x.is_sprint&&'Sprint'}</td></tr>)}</tbody></table></>}
export function Results(){
 const results=useQ(loadSavedRaceResults);
 const [selectedYear,setSelectedYear]=useState('');
 const [selectedRaceId,setSelectedRaceId]=useState('');
 const [selectedSession,setSelectedSession]=useState('');
 const weekends=groupRaceWeekends(results.data||[]);
 const years=[...new Set(weekends.map(weekend=>weekend.year).filter(Boolean))].sort((a,b)=>b-a);
 const activeYear=years.includes(Number(selectedYear))?Number(selectedYear):years[0];
 const yearWeekends=weekends.filter(weekend=>weekend.year===activeYear);
 const activeWeekend=yearWeekends.find(weekend=>String(weekend.raceId)===String(selectedRaceId))||yearWeekends[0];
 const defaultSession=activeWeekend?.sessions.find(session=>session.session_type==='race')
  ||activeWeekend?.sessions.find(session=>session.session_type==='qualifying')
  ||activeWeekend?.sessions.find(session=>session.session_type==='sprint')
  ||activeWeekend?.sessions[activeWeekend.sessions.length-1];
 const activeSession=activeWeekend?.sessions.find(session=>session.session_type===selectedSession)||defaultSession;
 const classification=[...(activeSession?.rows||[])].sort((a,b)=>a.position-b.position);
 const changeYear=year=>{setSelectedYear(year);setSelectedRaceId('');setSelectedSession('')};
 const changeRace=raceId=>{setSelectedRaceId(raceId);setSelectedSession('')};
 return <section className="results-page">
  <div className="results-page-heading"><div><p className="eyebrow">OFFICIAL CLASSIFICATION</p><h2>Race results</h2><p>Browse saved results by season, Grand Prix, and session.</p></div></div>
  <QueryStatus query={results} empty="No saved race results yet. Simulate a race weekend to see the classifications here."/>
  {weekends.length>0&&<><nav className="results-year-nav" aria-label="Results season pages">{years.map(year=><button type="button" key={year} className={year===activeYear?'active':''} aria-current={year===activeYear?'page':undefined} onClick={()=>changeYear(year)}>{year}</button>)}</nav>
  <section className="results-season-page" aria-label={`${activeYear} race results`}>
   <header className="results-season-heading"><div><small>SEASON</small><h3>{activeYear}</h3></div><span>{yearWeekends.length} race{yearWeekends.length===1?'':'s'}</span></header>
   <nav className="results-race-nav" aria-label={`${activeYear} races`}>{yearWeekends.map(weekend=><button type="button" key={weekend.key} className={String(weekend.raceId)===String(activeWeekend?.raceId)?'active':''} aria-current={String(weekend.raceId)===String(activeWeekend?.raceId)?'true':undefined} onClick={()=>changeRace(weekend.raceId)}><span>R{weekend.round||'—'}</span><strong>{weekend.raceName}</strong></button>)}</nav>
  {activeWeekend&&activeSession&&<div className="results-classification">
   <header className="results-classification-heading"><div><small>{activeWeekend.year} · ROUND {activeWeekend.round||'—'}</small><h3>{activeWeekend.raceName}</h3><span>{sessionLabel(activeSession.session_type)} classification</span></div>{activeWeekend.sessions.some(session=>session.session_type==='sprint')&&<strong className="results-sprint-tag">SPRINT WEEKEND</strong>}</header>
   <nav className="results-session-nav" aria-label={`${activeWeekend.raceName} sessions`}>{activeWeekend.sessions.map(session=><button type="button" key={session.session_type} className={session.session_type===activeSession.session_type?'active':''} aria-current={session.session_type===activeSession.session_type?'true':undefined} onClick={()=>setSelectedSession(session.session_type)}>{sessionLabel(session.session_type)}</button>)}</nav>
   <div className="scroll results-table-scroll"><table className="race-table results-table"><thead><tr><th>POS</th><th>DRIVER</th><th>GRID</th><th>STATUS</th><th>LAPS</th><th>TIME</th><th>BEST</th><th>PTS</th><th>AWARDS</th></tr></thead><tbody>
    {classification.map((row,index)=>{const saved=row.result||{};const driver=saved.driver||row.drivers||{};const team=saved.team||row.teams||{};const gridPosition=saved.gridPosition??saved.grid??'—';const gridNumber=Number(gridPosition);const positionChange=Number.isFinite(gridNumber)?gridNumber-Number(row.position):0;const time=saved.totalTime??row.total_time;const bestLap=saved.bestLap??row.best_lap;return <tr key={`${row.driver_id}-${index}`} className={index===0?'leader':''} style={{'--team-color':team.color||'#d3202f'}}>
     <td className="position-cell"><span className="position-number">{row.position===1?'P1':row.position}</span>{Number.isFinite(gridNumber)&&<span className={`position-change ${positionChange>0?'up':positionChange<0?'down':'same'}`} title={positionChange>0?`${positionChange} place${positionChange===1?'':'s'} gained`:positionChange<0?`${Math.abs(positionChange)} place${positionChange===-1?'':'s'} lost`:'No position change'}>{positionChange>0?'▲':positionChange<0?'▼':'→'}</span>}</td>
     <td><Link className="results-driver-link" to={`/drivers/${driver.id||row.driver_id}`}><span className="driver-result"><span className="team-logo" title={team.name||'Team'}>{team.logo_normal&&<img src={team.logo_normal} alt=""/>}</span><strong>{driver.code||driver.name||'Driver'}</strong></span><small>{driver.name||`Driver #${row.driver_id}`}{saved.substituteFor?` · SUB for ${saved.substituteFor.code||saved.substituteFor.name}`:''}</small></Link></td>
     <td>{gridPosition==='—'?'—':`P${gridPosition}`}</td><td><span className={`results-status ${row.retired?'is-retired':''}`}>{row.retired?'RETIRED':row.status||'FINISHED'}</span></td>
     <td>{row.laps_completed||saved.lapsCompleted||'—'}</td>
     <td>{time!==null&&time!==undefined&&Number.isFinite(Number(time))?formatTime(Number(time)):'—'}</td>
     <td>{bestLap!==null&&bestLap!==undefined&&Number.isFinite(Number(bestLap))?formatTime(Number(bestLap)):row.fastest_lap?'FASTEST LAP':'—'}</td>
     <td className="results-points">{Number(row.points)||0}</td>
     <td>{resultAwards(row).map(award=><span className="results-award" key={award}>{award}</span>)}</td>
    </tr>})}
   </tbody></table></div>
   {!classification.length&&<p className="muted results-no-classification">No drivers are saved for this session.</p>}
  </div>}
  </section>
  </>}
 </section>;
}
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
const DEFAULT_SETUP={aero:50,suspension:50,tyreCare:50};
const DEFAULT_STRATEGY={tyre:'auto',stops:'auto'};
const newSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
const formatTime=seconds=>Number.isFinite(seconds)?`${Math.floor(seconds/60)}:${(seconds%60).toFixed(3).padStart(6,'0')}`:'—';
function seasonSnapshots(rows=[]){
 const events=new Map();
 for(const row of rows){
  const key=String(row.race_id),race=events.get(key)||{
   raceId:row.race_id,round:row.races?.round||0,raceName:row.races?.name||'Race',
   raceResults:[],sprintResults:[]
  };
  const saved=row.result||{};
  const record={
   driver:saved.driver||row.drivers,
   team:saved.team||row.teams,
   position:row.position,
   points:Number(row.points)||0
  };
  if(row.session_type==='sprint')race.sprintResults.push(record);
  if(row.session_type==='race')race.raceResults.push(record);
  events.set(key,race);
 }
 return [...events.values()];
}
const resultOrder=(a,b)=>(Number(b.races?.year||b.grids?.year)||0)-(Number(a.races?.year||a.grids?.year)||0)||(Number(b.races?.round)||0)-(Number(a.races?.round)||0)-Number(a.session_type==='race')+Number(b.session_type==='race');
const SESSION_ORDER=['practice1','practice2','practice3','sprintQualifying','sprint','qualifying','race'];
function groupRaceWeekends(rows=[]){
 const weekends=new Map();
 for(const row of rows){
  const key=`${row.grid_id}:${row.race_id}`;
  let weekend=weekends.get(key);
  if(!weekend){
   weekend={key,year:Number(row.races?.year||row.grids?.year)||0,round:Number(row.races?.round)||0,raceName:row.races?.name||'Race',sessions:new Map(),pointsTotal:0};
   weekends.set(key,weekend);
  }
  const session=weekend.sessions.get(row.session_type)||[];
  session.push(row);
  weekend.sessions.set(row.session_type,session);
  weekend.pointsTotal+=Number(row.points)||0;
 }
 return [...weekends.values()].map(weekend=>({
  ...weekend,
  sessions:[...weekend.sessions].sort(([a],[b])=>(SESSION_ORDER.indexOf(a)<0?Infinity:SESSION_ORDER.indexOf(a))-(SESSION_ORDER.indexOf(b)<0?Infinity:SESSION_ORDER.indexOf(b))).map(([session_type,rows])=>({session_type,rows}))
 })).sort((a,b)=>b.year-a.year||b.round-a.round);
}
export function Simulate(){
 const grids=useQ(()=>sb.from('grids').select('id,name,year').order('year',{ascending:false}));
 const [gid,setG]=useState('');const [rid,setR]=useState('');const [phaseIndex,setPhaseIndex]=useState(0);
 const [simulationTab,setSimulationTab]=useState('weekend');
 const [weekendStarted,setWeekendStarted]=useState(false);const [weekendComplete,setWeekendComplete]=useState(false);
 const [results,setResults]=useState({});const [setups,setSetups]=useState({});const [strategies,setStrategies]=useState({});const [performanceBoosts,setPerformanceBoosts]=useState({});const [strategyEnabled,setStrategyEnabled]=useState(false);const [garageSetupEnabled,setGarageSetupEnabled]=useState(false);
 const [practiceSubstitutions,setPracticeSubstitutions]=useState({});
 const [resultSaveError,setResultSaveError]=useState('');const [resultSaveFailed,setResultSaveFailed]=useState(false);const [resultSaveSaving,setResultSaveSaving]=useState(false);
 const [raceState,setRaceState]=useState(null);const [isRunning,setIsRunning]=useState(false);const [raceViewTab,setRaceViewTab]=useState('timing');const [raceTeamAdjustments,setRaceTeamAdjustments]=useState({});const [simulationSpeed,setSimulationSpeed]=useState(1);const [seed,setSeed]=useState(newSeed);const [weatherMode,setWeatherMode]=useState('dry');const [selectedDriverId,setSelectedDriverId]=useState(null);const [pitCompound,setPitCompound]=useState('medium');const [pitLap,setPitLap]=useState(1);const [pitFeedback,setPitFeedback]=useState('');const [boostFeedback,setBoostFeedback]=useState('');
 const [nextRaceNotice,setNextRaceNotice]=useState('');
 const completedRaceRef=useRef(null);
 const resultSaveQueueRef=useRef([]);
 const resultSaveInFlightRef=useRef(false);
 const activeSetups=garageSetupEnabled?setups:{};
 const tyreImagesQuery=useQ(()=>sb.from('tyre_images').select('compound,image_url'));
 const tyreImages=Object.fromEntries((tyreImagesQuery.data||[]).map(item=>[item.compound,item.image_url]));
 const grid=grids.data?.find(g=>String(g.id)===gid);
 const races=useQ(()=>grid?sb.from('races').select('*').eq('year',grid.year).order('round'):Promise.resolve({data:[],error:null}),[grid?.year]);
 const practiceLineups=useQ(()=>grid?sb.from('team_driver_lineups').select('team_id,reserve_driver_id').eq('year',grid.year):Promise.resolve({data:[],error:null}),[grid?.year]);
 const reserveDriverIds=[...new Set((practiceLineups.data||[]).map(lineup=>lineup.reserve_driver_id).filter(Boolean).map(String))].sort();
 const reserveDriverKey=reserveDriverIds.join(',');
 const reserveDriversQuery=useQ(()=>reserveDriverIds.length?sb.from('drivers').select('*,driver_ratings(*)').in('id',reserveDriverIds):Promise.resolve([]),[reserveDriverKey]);
 const seasonResultsQuery=useQ(()=>grid?sb.from('race_results').select('grid_id,race_id,session_type,position,points,drivers(id,name,code),teams(id,name,logo_normal,color),races(round,name)').eq('grid_id',grid.id):Promise.resolve({data:[],error:null}),[grid?.id]);
 const selectedRace=races.data?.find(r=>String(r.id)===rid);
 const entriesQuery=useQ(()=>gid?sb.from('grid_entries').select('*,drivers(*,driver_ratings(*),driver_images(*)),teams(*),cars(*)').eq('grid_id',gid):Promise.resolve({data:[],error:null}),[gid]);
 const entries=(entriesQuery.data||[]).filter(e=>e.drivers&&e.teams&&e.cars).map(e=>({
  driver:e.drivers,team:e.teams,d:one(e.drivers.driver_ratings)||{},c:e.cars
 }));
 const performanceEntries=applyTeamPerformanceBoosts(entries,performanceBoosts);
 const practiceEntries=applyPracticeSubstitutions(performanceEntries,practiceLineups.data||[],reserveDriversQuery.data||[],practiceSubstitutions);
 const phases=getWeekendPhases(selectedRace||{});
 const seasonKey=grid?`${grid.id}:${grid.year}`:'';
 const savedSeason=seasonSnapshots(seasonResultsQuery.data||[]);
 const seasonRacesCompleted=Boolean(grid&&races.data?.length&&races.data.every(race=>savedSeason.some(result=>String(result.raceId)===String(race.id)&&result.raceResults.length>0)));
 const seasonStandings=calculateStandings(savedSeason,entries);
 const phase=phases[Math.min(phaseIndex,phases.length-1)];
 const racePhase=phase==='sprint'?'sprint':phase==='race'?'race':null;
 const phaseResult=results[phase]||((racePhase&&raceState?.format===racePhase)?getClassification(raceState):null);
 const fastestSessionLap=phaseResult?Math.min(...phaseResult.map(entry=>entry.bestLap).filter(Number.isFinite)):Infinity;
 const selectedCar=raceState?.cars.find(car=>String(car.driverId)===String(selectedDriverId));
 const teams=[...new Map(entries.map(e=>[e.team.id,e.team])).values()];
 const practiceSubstitutionOptions=teams.map(team=>{
  const lineup=practiceLineups.data?.find(item=>String(item.team_id)===String(team.id));
  const reserve=(reserveDriversQuery.data||[]).find(driver=>String(driver.id)===String(lineup?.reserve_driver_id));
  const targetId=practiceSubstitutions[team.id]||'';
  const reserveAlreadyEntered=Boolean(reserve&&entries.some(entry=>String(entry.driver.id)===String(reserve.id)));
  return {team,lineup,reserve,targetId,reserveAlreadyEntered,drivers:entries.filter(entry=>String(entry.team.id)===String(team.id))};
 });
 const saveResults=async()=>{
  if(resultSaveInFlightRef.current||!resultSaveQueueRef.current.length)return;
  resultSaveInFlightRef.current=true;
  setResultSaveSaving(true);
  try{
   while(resultSaveQueueRef.current.length){
    const pending=resultSaveQueueRef.current[0];
    const {data,error}=await sb.from('race_results')
     .upsert(pending.records,{onConflict:'grid_id,race_id,session_type,driver_id'})
     .select('driver_id');
    if(error)throw error;
    if((data||[]).length!==pending.records.length){
     throw new Error(`Supabase confirmed ${data?.length||0} of ${pending.records.length} session results. The batch was kept for retry.`);
    }
    resultSaveQueueRef.current.shift();
    if(String(grid?.id)===String(pending.gridId))seasonResultsQuery.retry();
    if(String(grid?.id)===String(pending.gridId)&&pending.sessionType==='race'){
     const raceIndex=races.data?.findIndex(race=>String(race.id)===String(pending.raceId))??-1;
     const nextRace=raceIndex>=0?races.data[raceIndex+1]:null;
     setNextRaceNotice(nextRace?`Round ${pending.round} complete. Round ${nextRace.round}: ${nextRace.name} is ready.`:'Season complete. Final standings are shown above.');
    }
   }
   setResultSaveError('');setResultSaveFailed(false);
  }catch(error){
   console.error('Could not save race results to Supabase:',error);
   setResultSaveFailed(true);
   const pending=resultSaveQueueRef.current[0];
   setResultSaveError(`Could not save ${pending?.sessionLabel||'session'} results to Supabase: ${error.message||String(error)}${resultSaveQueueRef.current.length>1?` ${resultSaveQueueRef.current.length} session save(s) remain queued.`:''}`);
  }finally{
   resultSaveInFlightRef.current=false;
   setResultSaveSaving(false);
  }
 };
 const enqueueResults=(pending)=>{
  resultSaveQueueRef.current.push(pending);
  setResultSaveFailed(false);
  setResultSaveError('');
  void saveResults();
 };
 useEffect(()=>{setR('');setWeekendStarted(false);setWeekendComplete(false);setPhaseIndex(0);setResults({});setRaceState(null);setIsRunning(false);setPracticeSubstitutions({})},[gid]);
 useEffect(()=>{
  if(!isRunning||!raceState||raceState.done)return;
  const timer=window.setInterval(()=>setRaceState(current=>current?advanceRaceIfRunning(current,true):current),Math.max(100,1000/simulationSpeed));
  return()=>window.clearInterval(timer);
 },[isRunning,raceState?.done,simulationSpeed]);
 useEffect(()=>{
  if(!raceState?.done)return;
  const resultKey=raceState.format==='sprint'?'sprint':'race';
  const classification=getClassification(raceState);
  setIsRunning(false);
  const completedSessions={...results,[resultKey]:classification};
  setResults(completedSessions);
  if(!selectedRace||!grid)return;
  const completionKey=`${grid.id}:${selectedRace.id}:${resultKey}`;
  if(completedRaceRef.current===completionKey)return;
  completedRaceRef.current=completionKey;
  const awards=getWeekendAwards(phases,completedSessions,resultKey==='race'?classification:[]);
  enqueueResults({
   gridId:grid.id,sessionType:resultKey,sessionLabel:sessionLabel(resultKey),raceId:selectedRace.id,round:selectedRace.round,
   records:buildResultRecords(grid,selectedRace,resultKey,classification,awards)
  });
 },[raceState?.done]);
 useEffect(()=>{if(selectedDriverId!==null){setPitLap(current=>current<=raceState?.lap?((raceState?.lap||0)+1):current);setPitFeedback('')}},[selectedDriverId]);
 const updateTeam=(setter,id,key,value)=>setter(current=>({...current,[id]:{...current[id],[key]:value}}));
 const startWeekend=()=>{setNextRaceNotice('');setResultSaveError('');setResultSaveFailed(false);setBoostFeedback('');setWeekendStarted(true);setWeekendComplete(false);setPhaseIndex(0);setResults({});setRaceState(null);setSeed(newSeed())};
 const resetSeasonStandings=async()=>{
  if(!grid||!window.confirm(`Delete all saved simulated results for ${grid.name} (${grid.year}) from Supabase? This cannot be undone.`))return;
  try{
   const {data,error}=await sb.from('race_results').delete().eq('grid_id',grid.id).select('race_id');
   if(error)throw error;
   if(seasonResultsQuery.data?.length&&!data?.length)throw new Error('No rows were deleted. Sign in with an authorized Supabase account and try again.');
  }catch(error){console.error('Could not reset saved season results:',error);setResultSaveFailed(false);setResultSaveError(`Season results could not be reset: ${error.message||String(error)}`);return}
  setResultSaveError('');setResultSaveFailed(false);seasonResultsQuery.retry();
  completedRaceRef.current=null;setWeekendStarted(false);setWeekendComplete(false);setPhaseIndex(0);setResults({});setRaceState(null);setIsRunning(false);setSelectedDriverId(null);
  setNextRaceNotice(`${grid.year} standings reset. Select any race in this season to simulate it again.`);
 };
 const runPhase=()=>{
  if(entries.length<2)return alert('Add at least 2 complete driver and car entries to this grid.');
  if(phase==='race'||phase==='sprint'){
  completedRaceRef.current=null;
  const gridKey=phase==='sprint'?'sprintQualifying':'qualifying';
   const useSprintGrid=phase==='race'&&selectedRace?.sprint_affects_grand_prix_grid;
   const sourceKey=useSprintGrid?'sprint':gridKey;
   const startRows=results[sourceKey]?.map((entry,index)=>({
    ...entry,
    grid:sourceKey==='sprint'?(entry.position||entry.pos||index+1):entry.grid
   }));
   if(!startRows?.length)return alert(`Complete ${PHASE_LABELS[sourceKey]||sourceKey} before starting this session.`);
   if(phase==='race')completedRaceRef.current=null;
   const isSprint=phase==='sprint';
   const raceLaps=Number(selectedRace.laps)||57;
   const state=createRaceState({
    entries:applyTeamPerformanceBoosts(startRows,performanceBoosts),race:selectedRace,seed,format:isSprint?'sprint':'race',
    strategies:strategyEnabled?strategies:{},setups:activeSetups,weather:weatherMode,laps:isSprint?Math.max(1,Math.round(raceLaps*0.32)):raceLaps
   });
   setRaceState(state);setRaceViewTab('timing');setRaceTeamAdjustments({});setBoostFeedback('');setIsRunning(true);setWeekendComplete(false);
   return;
  }
  let rows;
  if(phase.startsWith('practice'))rows=practice(practiceEntries,{seed:seed+phaseIndex,race:selectedRace,setups:activeSetups,weather:weatherMode});
  if(phase==='qualifying'||phase==='sprintQualifying')rows=qualify(performanceEntries,{seed:seed+phaseIndex,race:selectedRace,setups:activeSetups,weather:weatherMode==='wet'?{wetness:0.75}:undefined});
  const completedSessions={...results,[phase]:rows};
  phases.slice(phaseIndex+1).forEach(name=>delete completedSessions[name]);
  setResults(completedSessions);
  if(selectedRace&&grid){
   const awards=getWeekendAwards(phases,completedSessions,[]);
   enqueueResults({
    gridId:grid.id,sessionType:phase,sessionLabel:sessionLabel(phase),raceId:selectedRace.id,round:selectedRace.round,
    records:buildResultRecords(grid,selectedRace,phase,rows,awards)
   });
  }
  setRaceState(null);setIsRunning(false);
  setWeekendComplete(false);
 };
 const advance=()=>{if(phaseIndex<phases.length-1)setPhaseIndex(i=>i+1);else setWeekendComplete(true)};
 const issuePitCommand=(command)=>{
  if(!raceState||!selectedCar)return;
  try{
   const next=setPitInstruction(raceState,selectedCar.driverId,command,{compound:pitCompound,targetLap:Math.max(pitLap,raceState.lap+1)});
   setRaceState(next);setPitFeedback(next.cars.find(car=>String(car.driverId)===String(selectedCar.driverId)).pitStatus);
  }catch(error){setPitFeedback(error instanceof Error?error.message:String(error))}
 };
 const issueDriverBoost=(driverId)=>{
  if(!raceState)return;
  try{
   const next=activateDriverBoost(raceState,driverId);
   setRaceState(next);
   const driver=next.cars.find(car=>String(car.driverId)===String(driverId))?.entry.driver.name||'Driver';
   setBoostFeedback(`${driver} boost armed for lap ${next.lap+1}. Stronger pace for one lap; one-lap cooldown afterward.`);
  }catch(error){setBoostFeedback(error instanceof Error?error.message:String(error))}
 };
 const adjustLiveTeam=(teamId,key,rawValue)=>{
  const adjustments={...raceTeamAdjustments[String(teamId)],[key]:Number(rawValue)};
  setRaceTeamAdjustments(current=>({...current,[String(teamId)]:adjustments}));
  setRaceState(current=>current&&!current.done?setTeamRaceAdjustments(current,teamId,adjustments):current);
 };
 const setSetup=(id,key,value)=>updateTeam(setSetups,id,key,value);
 const setStrategy=(id,key,value)=>updateTeam(setStrategies,id,key,value);
 const setPerformanceBoost=(id,value)=>setPerformanceBoosts(current=>({...current,[String(id)]:Math.max(0,Math.min(20,Number(value)||0))}));
 const isQualifying=phase==='qualifying'||phase==='sprintQualifying';const isPractice=phase.startsWith('practice');
 const getPosition=(entry,index)=>isPractice?entry.practicePos:isQualifying?entry.grid:entry.dnf?'DNF':entry.pos;
 return <section className="weekend">
  <div className="weekend-heading"><div><p className="eyebrow">RACE OPERATIONS</p><h2>Simulation</h2>
   <p className="muted">Build your setup, qualify the grid, then call the race strategy.</p></div>
   {selectedRace&&<div className="race-round">ROUND <strong>{selectedRace.round||'—'}</strong></div>}
  </div>
  <div className="simulation-navigation">
   <label>Season grid<select value={gid} onChange={e=>{setNextRaceNotice('');setG(e.target.value);setR('')}}><option value="">Choose a grid</option>{grids.data?.map(g=><option key={g.id} value={g.id}>{g.name} · {g.year}</option>)}</select></label>
   <div className="tabs" role="tablist" aria-label="Simulation sections">
    <button type="button" role="tab" aria-selected={simulationTab==='weekend'} className={simulationTab==='weekend'?'on':''} onClick={()=>setSimulationTab('weekend')}>Race weekend</button>
    <button type="button" role="tab" aria-selected={simulationTab==='standings'} className={simulationTab==='standings'?'on':''} onClick={()=>setSimulationTab('standings')}>Standings</button>
    <button type="button" role="tab" aria-selected={simulationTab==='performance'} className={simulationTab==='performance'?'on':''} onClick={()=>setSimulationTab('performance')}>Performance</button>
   </div>
  </div>
  <QueryStatus query={grids} empty="Create a grid before viewing the simulation."/>
  {resultSaveSaving&&<p className="query-status" role="status">Saving {resultSaveQueueRef.current[0]?.sessionLabel||'session'} results to Supabase…</p>}
  {resultSaveError&&<div className="query-status query-error" role="alert"><span>{resultSaveError}</span>{resultSaveFailed&&<button type="button" onClick={()=>void saveResults()}>Retry save</button>}</div>}
  {simulationTab==='standings'?grid?<section className="standings-panel">
   <div className="section-title"><div><h3>{grid.year} season standings</h3><p>Race and sprint points · wins and podiums count Grand Prix results</p></div>{seasonRacesCompleted&&<button type="button" onClick={resetSeasonStandings} disabled={resultSaveSaving||resultSaveQueueRef.current.length>0}>Reset standings</button>}</div>
   <div className="standings-grid">
    {[['Drivers',seasonStandings.drivers],['Constructors',seasonStandings.teams]].map(([title,rows])=><div key={title}>
     <h4>{title}</h4><div className="scroll"><table><thead><tr><th>POS</th><th>{title==='Drivers'?'DRIVER':'TEAM'}</th><th>PTS</th><th>W</th><th>POD</th></tr></thead>
      <tbody>{rows.map((row,index)=><tr key={row.id}><td>{index+1}</td><td>{title==='Drivers'?<span className="standing-driver"><span className="team-logo">{row.team?.logo_normal&&<img src={row.team.logo_normal} alt=""/>}</span><strong>{row.code||'—'}</strong></span>:row.name}</td><td><strong>{row.points}</strong></td><td>{row.wins}</td><td>{row.podiums}</td></tr>)}</tbody>
     </table></div>
    </div>)}
   </div>
   <QueryStatus query={seasonResultsQuery} empty="No race results have been saved for this season yet."/>
  </section>:<div className="weekend-empty"><h3>Choose a season grid</h3><p>Select a grid above to view its standings.</p></div>:simulationTab==='performance'?grid?<section className="performance-panel">
   <div className="section-title"><div><h3>{grid.year} team performance</h3><p>Boost a team to improve the car ratings of all its drivers in upcoming sessions.</p></div></div>
   <div className="performance-team-grid">{teams.map(team=>{
    const boost=performanceBoosts[String(team.id)]||0;
    const teamDrivers=entries.filter(entry=>String(entry.team.id)===String(team.id));
    return <article className="performance-team-card" key={team.id} style={{'--team-color':team.color||'#d3202f'}}>
     <div className="performance-team-heading">{team.logo_normal&&<img src={team.logo_normal} alt=""/>}<div><h4>{team.name}</h4><p>{teamDrivers.map(entry=>entry.driver.code||entry.driver.name).join(' · ')}</p></div></div>
     <label className="performance-boost-control"><span>Car performance <strong>+{boost} pts</strong></span><input type="range" min="0" max="20" step="1" value={boost} onChange={event=>setPerformanceBoost(team.id,event.target.value)}/><small>Improves speed, aero, grip, race and qualifying ratings for this team.</small></label>
     <button type="button" className="performance-reset" onClick={()=>setPerformanceBoost(team.id,0)} disabled={boost===0}>Reset boost</button>
    </article>;
   })}</div>
   {!teams.length&&<p className="muted">No complete teams are assigned to this grid.</p>}
   <div className="team-garage performance-garage"><div className="section-title"><div><h3>Garage setup</h3><p>Off by default: teams use their standard setup. Enabled setups apply to upcoming sessions.</p></div></div>
    <label className="strategy-toggle"><input type="checkbox" checked={garageSetupEnabled} onChange={event=>setGarageSetupEnabled(event.target.checked)}/><span>Enable custom garage setup</span></label>
    {garageSetupEnabled&&teams.map(team=>{const setup={...DEFAULT_SETUP,...setups[team.id]};return <details className="team-panel" key={team.id} style={{'--team-color':team.color||'#d3202f'}}>
     <summary><strong>{team.name}</strong><span>Adjust setup</span></summary>
     <div className="setup-controls">
      {[[ 'aero','Aero balance','Low drag ↔ Downforce'],['suspension','Mechanical grip','Stable ↔ Responsive'],['tyreCare','Tyre management','Attack ↔ Preserve']].map(([key,label,help])=>
       <label key={key}>{label}<span className="range-value">{setup[key]}</span><input type="range" min="0" max="100" value={setup[key]} onChange={e=>setSetup(team.id,key,+e.target.value)}/><small>{help}</small></label>)}
     </div>
    </details>})}
   </div>
  </section>:<div className="weekend-empty"><h3>Choose a season grid</h3><p>Select a grid above to manage team performance.</p></div>:<>
  <div className="weekend-select">
   <label>Grand Prix<select value={rid} onChange={e=>{setNextRaceNotice('');setR(e.target.value);setWeekendStarted(false);setWeekendComplete(false);setResults({});setRaceState(null);setIsRunning(false);setPhaseIndex(0);setPracticeSubstitutions({})}} disabled={!grid||races.loading}><option value="">Choose a race</option>{races.data?.map(r=><option key={r.id} value={r.id}>R{r.round} · {r.name}</option>)}</select></label>
   <label>Weather<select value={weatherMode} onChange={e=>setWeatherMode(e.target.value)}><option value="dry">Dry</option><option value="variable">Changeable</option><option value="wet">Wet</option></select></label>
   <button className="btn weekend-start" disabled={!grid||!selectedRace||entries.length<2} onClick={startWeekend}>
    {weekendStarted?'Restart weekend':'Start race weekend'}
   </button>
  </div>
  {nextRaceNotice&&<p className="query-status" role="status">{nextRaceNotice}</p>}
  {grid&&<QueryStatus query={races} empty="No races found for this grid's season. Add the calendar in Admin."/>}
  {grid&&selectedRace&&<QueryStatus query={entriesQuery} empty="Add at least two complete driver and car entries to this grid."/>}
  {selectedRace&&<div className="circuit-panel">
   {selectedRace.circuit_image_url?<img className="circuit-map-image" src={selectedRace.circuit_image_url} alt={`${selectedRace.circuit||selectedRace.name} circuit layout`}/>:<svg className="circuit-map" viewBox="0 0 180 110" role="img" aria-label="Circuit illustration">
    <path d="M22 72 33 32 68 20 92 35 127 21 155 38 148 66 164 82 133 94 105 81 77 94 49 81 22 72Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round"/>
    <path d="M22 72 33 32 68 20" fill="none" stroke="var(--red)" strokeWidth="5" strokeLinecap="round"/>
   </svg>}
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
   <div className="session-timeline">{phases.map((name,index)=>{
    const complete=Boolean(results[name])||((name==='race'||name==='sprint')&&phase===name&&raceState?.done);
    return <button key={name}
    className={`session-step ${phaseIndex===index?'current':''} ${complete?'complete':''}`}
    onClick={()=>{if(index<=phaseIndex&&!weekendComplete&&!isRunning)setPhaseIndex(index)}}
    disabled={weekendComplete||isRunning||index>phaseIndex}>
    <span className="session-number">{complete?'✓':`0${index+1}`}</span><span>{PHASE_LABELS[name]}</span>
   </button>})}</div>
   {weekendComplete?<div className="weekend-empty finish-banner"><p className="eyebrow">CHEQUERED FLAG</p>
    <h3>{selectedRace.name} complete</h3><p>Weekend results are ready. Start another weekend to run a new event.</p>
    <button className="btn" onClick={()=>{setWeekendStarted(false);setWeekendComplete(false);setResults({})}}>Return to race selection</button>
   </div>:<>
    <div className="session-header"><div><p className="eyebrow">SESSION {String(phaseIndex+1).padStart(2,'0')}</p>
     <h3>{PHASE_LABELS[phase]}</h3><p>{phase==='practice'?'Dial in the car before qualifying.':phase==='qualifying'?'Set the starting order for the weekend.':phase==='sprint'?'A short-format race for extra points.':'Choose your race strategy and go racing.'}</p>
    </div>
     {phaseResult&&(phase!=='race'&&phase!=='sprint'||raceState?.done)&&<button className="btn" onClick={advance}>{phaseIndex===phases.length-1?'Finish weekend':'Continue to '+PHASE_LABELS[phases[phaseIndex+1]]}</button>}
    </div>
    {isPractice&&<section className="practice-substitution"><div><h4>Practice-only reserve substitutions</h4><p>Choose which team driver the assigned reserve replaces for practice sessions. Qualifying and races use the original grid.</p></div>
     <QueryStatus query={practiceLineups} empty="No season lineups found. Assign reserve drivers in Admin to enable substitutions."/>
     {practiceLineups.data?.length>0&&<QueryStatus query={reserveDriversQuery} empty="No assigned reserve drivers are available."/>}
     {!practiceLineups.loading&&!practiceLineups.error&&<div className="practice-substitution-grid">{practiceSubstitutionOptions.map(({team,lineup,reserve,targetId,reserveAlreadyEntered,drivers:teamDrivers})=><label className="practice-substitution-card" key={team.id} style={{'--team-color':team.color||'#d3202f'}}>
      <strong>{team.name}</strong>
      {!lineup?.reserve_driver_id?<span className="practice-substitution-note">No reserve assigned</span>
       :reserveDriversQuery.loading?<span className="practice-substitution-note">Loading reserve driver…</span>
       :!reserve?<span className="practice-substitution-note">Reserve driver details unavailable</span>
       :reserveAlreadyEntered?<span className="practice-substitution-note">{reserve.name} is already entered in this grid</span>
       :<><span className="practice-substitution-note">Reserve: {reserve.name}</span><select aria-label={`${team.name} practice substitution`} value={targetId} onChange={event=>setPracticeSubstitutions(current=>({...current,[team.id]:event.target.value}))}><option value="">No substitution</option>{teamDrivers.map(entry=><option key={entry.driver.id} value={entry.driver.id}>{entry.driver.name}</option>)}</select></>}
     </label>)}</div>}
    </section>}
    {(phase==='sprint'||phase==='race')&&<div className="strategy-panel"><div className="section-title"><h3>Race strategy</h3><p>Off by default: the simulator selects each team’s tyre and pit plan automatically.</p></div>
     <label className="strategy-toggle"><input type="checkbox" checked={strategyEnabled} onChange={e=>setStrategyEnabled(e.target.checked)}/><span>Enable custom race strategy</span></label>
     {strategyEnabled&&<div className="strategy-grid">{teams.map(team=>{const strategy={...DEFAULT_STRATEGY,...strategies[team.id]};return <article className="strategy-card" key={team.id} style={{'--team-color':team.color||'#d3202f'}}>
      <strong>{team.name}</strong><label>Tyre compound<select value={strategy.tyre} onChange={e=>setStrategy(team.id,'tyre',e.target.value)}><option value="auto">Automatic strategy</option><option value="soft">Soft · fastest</option><option value="medium">Medium · balanced</option><option value="hard">Hard · durable</option></select></label>
      <label>Pit stops<select value={strategy.stops} onChange={e=>setStrategy(team.id,'stops',e.target.value==='auto'?'auto':Number(e.target.value))}><option value="auto">Automatic plan</option><option value={0}>No stop · high wear</option><option value={1}>One stop</option><option value={2}>Two stops</option></select></label>
     </article>})}</div>}
    </div>}
    {!phaseResult&&<button className="btn run-session" onClick={runPhase}>{isPractice?`Run ${PHASE_LABELS[phase]}`:phase==='sprintQualifying'?'Start sprint qualifying':phase==='qualifying'?'Start qualifying':phase==='sprint'?'Start sprint':'Start Grand Prix'}</button>}
    {phaseResult&&(phase==='race'||phase==='sprint')&&raceState&&<div className="race-live">
     <div className="race-status">
      <div><span className="eyebrow">{raceState.format==='sprint'?'SPRINT':'GRAND PRIX'}</span><strong>LAP {raceState.lap} / {raceState.totalLaps}</strong></div>
      <div className={`control-state ${raceState.raceControl==='safety_car'?'yellow':''}`}>{raceState.raceControl==='safety_car'?'SAFETY CAR':'GREEN FLAG'}</div>
      <div><span className="eyebrow">TRACK</span><strong>{raceState.weather.wetness>=0.65?'WET':raceState.weather.wetness>=0.3?'DAMP':'DRY'}</strong></div>
     </div>
     <div className="race-controls">
      {!raceState.done&&<button onClick={()=>setIsRunning(value=>!value)}>{isRunning?'Pause':'Resume'}</button>}
      <button onClick={()=>{setIsRunning(false);setRaceState(current=>current&&!current.done?advanceRaceLap(current):current)}} disabled={isRunning||raceState.done}>Advance one lap</button>
      <label>Speed<select value={simulationSpeed} onChange={e=>setSimulationSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option><option value={10}>10×</option></select></label>
      <button onClick={()=>{const restartSource=phase==='sprint'?'sprintQualifying':phase==='race'&&selectedRace?.sprint_affects_grand_prix_grid?'sprint':'qualifying';const restartEntries=results[restartSource]?.map((entry,index)=>({...entry,grid:restartSource==='sprint'?(entry.position||entry.pos||index+1):entry.grid}));if(!restartEntries?.length)return alert(`Complete ${PHASE_LABELS[restartSource]||restartSource} before restarting.`);setIsRunning(false);let restarted=createRaceState({entries:applyTeamPerformanceBoosts(restartEntries,performanceBoosts),race:selectedRace,seed,format:phase==='sprint'?'sprint':'race',strategies:strategyEnabled?strategies:{},setups:activeSetups,weather:weatherMode,laps:phase==='sprint'?Math.max(1,Math.round((Number(selectedRace.laps)||57)*0.32)):Number(selectedRace.laps)||57});Object.entries(raceTeamAdjustments).forEach(([teamId,adjustments])=>{restarted=setTeamRaceAdjustments(restarted,teamId,adjustments)});setRaceState(restarted);setRaceViewTab('timing');setIsRunning(true)}}>Restart same seed</button>
      <button onClick={()=>{setSeed(newSeed());setIsRunning(false);setRaceState(null);setSelectedDriverId(null);setPitFeedback('');setResults(current=>{const next={...current};delete next[phase];return next})}}>New seed / reset</button>
     </div>
      <div className="race-view-tabs" role="tablist" aria-label="Race views">
       <button type="button" role="tab" aria-selected={raceViewTab==='timing'} className={raceViewTab==='timing'?'on':''} onClick={()=>setRaceViewTab('timing')}>Live timing</button>
       <button type="button" role="tab" aria-selected={raceViewTab==='performance'} className={raceViewTab==='performance'?'on':''} onClick={()=>setRaceViewTab('performance')}>Team performance</button>
      </div>
      {raceViewTab==='performance'?<section className="race-performance-panel">
       <div className="section-title"><div><h3>Live team performance</h3><p>Changes affect each team’s next lap and remain in effect for the rest of this race.</p></div></div>
       <div className="performance-team-grid">{teams.map(team=>{
        const adjustments=raceTeamAdjustments[String(team.id)]||{};
        const teamDrivers=entries.filter(entry=>String(entry.team.id)===String(team.id));
        return <article className="performance-team-card" key={team.id} style={{'--team-color':team.color||'#d3202f'}}>
         <div className="performance-team-heading">{team.logo_normal&&<img src={team.logo_normal} alt=""/>}<div><h4>{team.name}</h4><p>{teamDrivers.map(entry=>entry.driver.code||entry.driver.name).join(' · ')}</p></div></div>
         <div className="race-performance-controls">{[['performance','Performance'],['pace','Pace'],['overtake','Overtaking'],['defense','Defense']].map(([key,label])=>{
          const value=adjustments[key]||0;
          return <label className="performance-boost-control" key={key}><span>{label}<strong>{value>0?'+':''}{value}</strong></span><input type="range" min="-20" max="20" step="1" value={value} disabled={raceState.done} onChange={event=>adjustLiveTeam(team.id,key,event.target.value)}/><small>{value>0?'Boost':value<0?'Reduce':'No change'} this team’s {label.toLowerCase()} rating.</small></label>;
         })}</div>
         <button type="button" className="performance-reset" onClick={()=>{setRaceTeamAdjustments(current=>({...current,[String(team.id)]:{performance:0,pace:0,overtake:0,defense:0}}));setRaceState(current=>current&&!current.done?setTeamRaceAdjustments(current,team.id,{}):current)}} disabled={raceState.done||!Object.values(adjustments).some(value=>value!==0)}>Reset live adjustments</button>
        </article>;
       })}</div>
      </section>:<>
     <LiveTrack state={raceState} selectedDriverId={selectedDriverId} onSelect={setSelectedDriverId}/>
     {raceState.done&&<SessionPodium entries={phaseResult} race={selectedRace} phaseLabel={PHASE_LABELS[phase]} raceResult fastestLap={fastestSessionLap}/>}
     <QueryStatus query={tyreImagesQuery}/>
     <div className="results-panel"><div className="section-title"><h3>Live timing</h3><p>Seed {raceState.seed} · {raceState.done?'Chequered flag':'Simulation in progress'}</p></div>
      {boostFeedback&&<p className="boost-feedback" role="status">{boostFeedback}</p>}
      <div className="scroll"><table className="race-table"><thead><tr><th>POS</th><th>DRIVER</th><th>GAP</th><th>INT</th><th>LAST</th><th>BEST</th><th>TYRE</th><th>AGE</th><th>WEAR</th><th>GRIP</th><th>PITS</th><th>FUEL</th><th>PIT COMMAND</th><th>STATUS</th><th>BOOST</th></tr></thead>
       <tbody>{phaseResult.map((entry,index)=>{
        const leader=phaseResult[0],ahead=phaseResult[index-1];
        const gap=entry.lapsCompleted<leader.lapsCompleted?`+${leader.lapsCompleted-entry.lapsCompleted} LAP`:index===0?'—':`+${(entry.totalTime-leader.totalTime).toFixed(3)}`;
        const interval=index===0?'—':entry.lapsCompleted<ahead.lapsCompleted?`+${ahead.lapsCompleted-entry.lapsCompleted} LAP`:`+${(entry.totalTime-ahead.totalTime).toFixed(3)}`;
        return <tr key={`${entry.driver.id}-${index}`} className={index===0?'leader':''}>
         <td className="position-cell"><span className="position-number">{entry.retired?'RET':index+1}</span>{(()=>{
          const change=(entry.gridPosition??entry.grid??index+1)-(index+1);
          const direction=change>0?'up':change<0?'down':'same';
          const symbol=change>0?'▲':change<0?'▼':'→';
          const description=change>0?`${change} place${change===1?'':'s'} gained`:change<0?`${Math.abs(change)} place${change===-1?'':'s'} lost`:'no position change';
          return <span className={`position-change ${direction}`} aria-label={description} title={description}>{symbol}</span>;
         })()}</td>
         <td><button className="driver-select" onClick={()=>setSelectedDriverId(entry.driver.id)}><span className="driver-result"><span className="team-logo">{entry.team.logo_normal&&<img src={entry.team.logo_normal} alt={`${entry.team.name} logo`}/>}</span><strong>{entry.driver.code||entry.driver.name.trim().split(/\s+/).pop()?.toUpperCase()}</strong></span></button></td>
         <td>{gap}</td><td>{interval}</td><td>{formatTime(entry.lastLap)}</td><td>{formatTime(entry.bestLap)}</td>
         <td className="tyre-compound-cell">{entry.tyre?.compound&&tyreImages[entry.tyre.compound]?<img className="tyre-compound-image" src={tyreImages[entry.tyre.compound]} alt={entry.tyre.compound} title={entry.tyre.compound}/>:entry.tyre?.compound?.toUpperCase()||'—'}</td><td>{entry.tyre?.age??'—'}</td><td>{entry.tyre?.wear?.toFixed(0)??'—'}%</td><td>{entry.tyre?.state?.toUpperCase()||'—'}</td><td>{entry.pitStops}</td><td>{entry.retired?'—':`${entry.fuelRemaining.toFixed(1)} kg`}</td><td>{entry.pitInstruction?`${entry.pitInstruction.mode.toUpperCase()} · LAP ${entry.pitInstruction.targetLap}`:entry.pitStatus}</td><td>{entry.retired?`RETIRED · L${entry.retirementLap}`:entry.status}</td>
         <td><button className={`driver-boost ${entry.boostLap!=null?'armed':''}`} onClick={()=>issueDriverBoost(entry.driver.id)} disabled={raceState.done||entry.retired||entry.completed||entry.boostLap!=null||entry.boostCooldownLaps>0} title={entry.boostLap!=null?`Boost armed for lap ${entry.boostLap}`:entry.boostCooldownLaps>0?`Available in ${entry.boostCooldownLaps} laps`:'Boost pace for the next lap'}>{entry.boostLap!=null?'ARMED':entry.boostCooldownLaps>0?`${entry.boostCooldownLaps}L`:'BOOST'}</button></td>
        </tr>})}</tbody></table></div>
     </div>
     {!!raceState.events.length&&<div className="race-events"><h3>Race control</h3>{raceState.events.slice(-6).reverse().map((event,index)=><p key={`${event.type}-${event.lap}-${index}`}><strong>L{event.lap}</strong> · {event.type.replaceAll('_',' ')}{event.reason?` — ${event.reason}`:''}</p>)}</div>}
     {selectedCar&&<div className="driver-telemetry">
      <div className="section-title"><h3>{selectedCar.entry.driver.name} · Car telemetry</h3><button onClick={()=>setSelectedDriverId(null)}>Close</button></div>
      <div className="telemetry-facts"><span>Fuel <strong>{selectedCar.fuelRemaining.toFixed(1)} kg</strong></span><span>Damage <strong>{(selectedCar.damage*100).toFixed(0)}%</strong></span><span>Tyre <strong>{selectedCar.tyre.compound.toUpperCase()} · {selectedCar.tyre.age} laps</strong></span><span>Wear / grip <strong>{selectedCar.tyre.wear.toFixed(1)}% · {(selectedCar.tyre.grip*100).toFixed(0)}%</strong></span><span>Tyre status <strong>{selectedCar.tyre.state.toUpperCase()} · {selectedCar.tyre.remainingCompetitiveLaps?.toFixed(1)??'—'} laps to limit</strong></span><span>Pit stops <strong>{selectedCar.pitStops}</strong></span><span>Position <strong>P{selectedCar.position} ({selectedCar.positionHistory[0]>=selectedCar.position?'+'+ (selectedCar.positionHistory[0]-selectedCar.position):selectedCar.position-selectedCar.positionHistory[0]} places)</strong></span><span>Command <strong>{selectedCar.pitStatus}</strong></span>{selectedCar.mechanicalFault&&<span>Vehicle fault <strong>{selectedCar.mechanicalFault.replaceAll('_',' ')}</strong></span>}{selectedCar.retired&&<span>Retirement <strong>Lap {selectedCar.retirementLap} · {selectedCar.retirementReason}</strong></span>}</div>
      <div className="pit-command">
       <strong>Driver-specific pit command</strong>
       <small>Manual pit plans suppress automatic stops until executed. “Stay out” defers a planned stop one lap; weather and puncture emergencies can force an earlier stop.</small>
       <label>Next-stop compound<select value={pitCompound} onChange={event=>setPitCompound(event.target.value)}>{['soft','medium','hard','intermediate','wet'].map(compound=><option key={compound} value={compound}>{compound.toUpperCase()}</option>)}</select></label>
       <label>Planned pit lap<input type="number" min={raceState.lap+1} max={raceState.totalLaps-1} value={pitLap} onChange={event=>setPitLap(Number(event.target.value))}/></label>
       <button onClick={()=>issuePitCommand('pit_this_lap')} disabled={selectedCar.retired||selectedCar.completed||raceState.done}>Pit this lap</button>
       <button onClick={()=>issuePitCommand('pit_next_lap')} disabled={selectedCar.retired||selectedCar.completed||raceState.done}>Pit next lap</button>
       <button onClick={()=>issuePitCommand('planned_stop')} disabled={selectedCar.retired||selectedCar.completed||raceState.done}>Schedule lap {Math.max(pitLap,raceState.lap+1)}</button>
       <button onClick={()=>issuePitCommand('set_compound')} disabled={selectedCar.retired||selectedCar.completed||raceState.done}>Set next-stop tyre</button>
       <button onClick={()=>issuePitCommand('stay_out')} disabled={selectedCar.retired||selectedCar.completed||raceState.done}>Stay out</button>
       <button onClick={()=>issuePitCommand('auto')} disabled={selectedCar.retired||selectedCar.completed||raceState.done}>Automatic strategy</button>
       <button onClick={()=>issuePitCommand('cancel')} disabled={selectedCar.retired||selectedCar.completed||raceState.done}>Cancel queued instruction</button>
       {pitFeedback&&<span role="status">{pitFeedback}</span>}
      </div>
      <div className="telemetry-columns"><div><h4>Recent laps</h4>{selectedCar.lapHistory.slice(-8).reverse().map(lap=><p key={lap.lap}>Lap {lap.lap}: {formatTime(lap.time)} · {lap.tyre.toUpperCase()} ({lap.tyreAge}) · {lap.fuel.toFixed(1)} kg</p>)}</div>
       <div><h4>Pit history</h4>{selectedCar.pitHistory.length?selectedCar.pitHistory.map((pit,index)=><p key={`${pit.lap}-${index}`}>Lap {pit.lap}: {pit.from.toUpperCase()} → {pit.to.toUpperCase()} · +{pit.timeLoss.toFixed(1)} sec ({pit.stages.map(stage=>`${stage.phase.replaceAll('_',' ')} ${stage.seconds.toFixed(1)}s`).join(' → ')})</p>):<p>No pit stops recorded.</p>}
        <h4>Incidents</h4>{selectedCar.events.filter(event=>event.type!=='overtake'&&event.type!=='attack_defended').length?selectedCar.events.filter(event=>event.type!=='overtake'&&event.type!=='attack_defended').map((event,index)=><p key={`${event.type}-${index}`}>Lap {event.lap}: {event.type.replaceAll('_',' ')}</p>):<p>No incidents recorded.</p>}</div>
      </div>
     </div>}
     </>}
    </div>}
    {phaseResult&&phase!=='race'&&phase!=='sprint'&&<div className="results-panel"><div className="section-title"><h3>{PHASE_LABELS[phase]} classification</h3><p>{isPractice?'Practice pace':isQualifying?'Starting grid':'Session results'}</p></div>
     {(isPractice||isQualifying)&&<SessionPodium entries={phaseResult} race={selectedRace} phaseLabel={PHASE_LABELS[phase]} fastestLap={fastestSessionLap}/>}
     <div className={`scroll ${isPractice?'practice-classification-scroll':''}`}><table className={`race-table ${isPractice?'practice-classification-table':''}`}><thead><tr><th>POS</th><th>DRIVER</th><th>GAP</th><th>BEST LAP</th>{!isPractice&&<th>CAR</th>}</tr></thead>
      <tbody>{phaseResult.map((entry,index)=>{
       const gap=Number.isFinite(entry.bestLap)&&Number.isFinite(fastestSessionLap)&&entry.bestLap>fastestSessionLap?`+${(entry.bestLap-fastestSessionLap).toFixed(3)}`:'—';
       return <tr key={`${entry.driver.id}-${index}`} className={index===0?'leader':''}>
       <td className="position-cell">{getPosition(entry,index)}</td><td><span className="driver-result"><span className="team-logo">{entry.team.logo_normal&&<img src={entry.team.logo_normal} alt={`${entry.team.name} logo`}/>}</span><strong>{isPractice?(entry.driver.code||entry.driver.name.trim().split(/\s+/).pop()?.toUpperCase()):entry.driver.name.trim().split(/\s+/).pop()?.toUpperCase()}</strong></span></td>
       <td>{gap}</td><td>{formatTime(entry.bestLap)}</td>{!isPractice&&<td>{entry.cars?.model||entry.c.model||'—'}</td>}
      </tr>})}</tbody></table></div>
    </div>}
   </>}
  </>}
  </>}
 </section>
}
