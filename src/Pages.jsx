import {useEffect,useState} from 'react';import {Link,useParams} from 'react-router-dom';
import {sb} from './supabase.js';import {weekend,championship} from './sim.js';
function useQ(fn,deps=[]){const [d,setD]=useState(null);useEffect(()=>{fn().then(({data,error})=>{if(error){console.error('Supabase query failed:',error);setD(null);return}setD(data)}).catch(error=>{console.error('Supabase query failed:',error);setD(null)})},deps);return d}
const Bar=({l,v})=><div className="bar"><span>{l}</span><i><b style={{width:(v??0)+'%'}}/></i><em>{v??'–'}</em></div>;
const latestImg=(d,k)=>[...(d.driver_images||[])].sort((a,b)=>b.year-a.year)[0]?.[k];
const CAR=['speed','race','overtaking','defence','performance','qualifying','reliability'];
const one=x=>Array.isArray(x)?x[0]:x;
export function Home(){const n=useQ(async()=>{const c=async t=>(await sb.from(t).select('*',{count:'exact',head:true})).count;return {drivers:await c('drivers'),teams:await c('teams'),races:await c('races')}});
 return <section className="hero"><h1>Build the grid. Run the season.</h1><p>Put any driver in any car, then simulate qualifying, sprints and races from the ratings.</p>
 <div className="row"><Link className="btn" to="/simulate">Start a simulation</Link><Link className="btn ghost" to="/grids">Build a grid</Link></div>
 {n&&<p className="muted">{n.drivers} drivers, {n.teams} teams, {n.races} races loaded</p>}</section>}
export function Drivers(){const d=useQ(()=>sb.from('drivers').select('*,driver_images(*)').order('name'));
 return <><h2>Drivers</h2><div className="grid">{d?.map(x=><Link key={x.id} to={'/drivers/'+x.id} className="card">{latestImg(x,'card_url')&&<img src={latestImg(x,'card_url')}/>}<h3>{x.name}</h3><p>{x.code} #{x.number}</p></Link>)}</div></>}
export function Driver(){const {id}=useParams();const d=useQ(()=>sb.from('drivers').select('*,driver_images(*),driver_ratings(*)').eq('id',id).single(),[id]);
 if(!d)return null;const r=one(d.driver_ratings)||{};
 return <><h2>{d.name} <small>#{d.number} {d.code}</small></h2><p>{d.nationality_logo&&<img height="16" src={d.nationality_logo}/>} {d.nationality}</p><p>{d.bio}</p>
 <div className="split"><div>{['race','overtaking','speed','experience','qualifying','defence'].map(k=><Bar key={k} l={k} v={r[k]}/>)}</div>
 <div className="grid">{[...d.driver_images].sort((a,b)=>b.year-a.year).map(i=><figure key={i.id}><figcaption>{i.year}</figcaption>{['pole_url','grid_url','card_url'].map(k=>i[k]&&<img key={k} src={i[k]}/>)}</figure>)}</div></div></>}
const CarCard=({c,sub})=><div className="card">{c.image_url&&<img src={c.image_url}/>}<h3>{c.model} <small>{c.year}</small></h3><p>{sub}</p>{CAR.map(k=><Bar key={k} l={k} v={c[k]}/>)}</div>;
export function Cars(){const c=useQ(()=>sb.from('cars').select('*,teams(name)').order('year',{ascending:false}));
 return <><h2>Cars</h2><div className="grid">{c?.map(x=><CarCard key={x.id} c={x} sub={x.teams?.name+' · '+(x.engine||'')}/>)}</div></>}
export function Teams(){const t=useQ(()=>sb.from('teams').select('*').order('name'));
 return <><h2>Teams</h2><div className="grid">{t?.map(x=><Link key={x.id} to={'/teams/'+x.id} className="card" style={{borderTop:'6px solid '+x.color}}>{x.logo_normal&&<img src={x.logo_normal}/>}<h3>{x.name}</h3></Link>)}</div></>}
export function Team(){const {id}=useParams();const t=useQ(()=>sb.from('teams').select('*,cars(*)').eq('id',id).single(),[id]);if(!t)return null;
 return <><h2 style={{borderLeft:'8px solid '+t.color,paddingLeft:12}}>{t.name}</h2>{t.logo_detailed&&<img height="80" src={t.logo_detailed}/>}
 <div className="grid">{[...t.cars].sort((a,b)=>b.year-a.year).map(c=><CarCard key={c.id} c={c} sub={c.engine}/>)}</div></>}
export function Races(){const r=useQ(()=>sb.from('races').select('*').order('year',{ascending:false}).order('round'));
 return <><h2>Races</h2><table><tbody>{r?.map(x=><tr key={x.id}><td>{x.year}</td><td>R{x.round}</td><td>{x.name}</td><td>{x.circuit}</td><td>{x.date}</td><td>{x.is_sprint&&'Sprint'}</td></tr>)}</tbody></table></>}
export function Grids(){const [tick,setT]=useState(0);const g=useQ(()=>sb.from('grids').select('*,grid_entries(*,drivers(name),teams(name))').order('year',{ascending:false}),[tick]);
 const teams=useQ(()=>sb.from('teams').select('*,cars(*)').order('name'));const drivers=useQ(()=>sb.from('drivers').select('id,name').order('name'));const [f,setF]=useState({});
 const add=async gid=>{if(!f.driver||!f.car)return;const car=teams.flatMap(t=>t.cars).find(c=>c.id==f.car);
  const {error}=await sb.from('grid_entries').insert({grid_id:gid,driver_id:f.driver,car_id:car.id,team_id:car.team_id});if(error)alert(error.message+' (sign in via /admin first)');setT(t=>t+1)};
 const del=async id=>{await sb.from('grid_entries').delete().eq('id',id);setT(t=>t+1)};
 return <><h2>Grids</h2><p className="muted">A grid is a set of driver and car pairings. Create grids in Admin, then fill them here (sign-in required to edit).</p>
 {g?.map(x=><div key={x.id} className="card wide"><h3>{x.name} <small>{x.year}</small></h3>
 <ul>{x.grid_entries.map(e=><li key={e.id}>{e.drivers?.name}: {e.teams?.name} <button onClick={()=>del(e.id)}>remove</button></li>)}</ul>
 <div className="row"><select onChange={e=>setF({...f,driver:e.target.value})}><option value="">Driver</option>{drivers?.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
 <select onChange={e=>setF({...f,car:e.target.value})}><option value="">Car</option>{teams?.flatMap(t=>t.cars.map(c=><option key={c.id} value={c.id}>{t.name} {c.model} ({c.year})</option>))}</select>
 <button className="btn" onClick={()=>add(x.id)}>Add to grid</button></div></div>)}</>}
export function Simulate(){const grids=useQ(()=>sb.from('grids').select('id,name,year'));const [gid,setG]=useState('');const [mode,setMode]=useState('race');const [rid,setR]=useState('');const [res,setRes]=useState(null);const [races,setRaces]=useState([]);
 useEffect(()=>{const g=grids?.find(x=>x.id==gid);if(g)sb.from('races').select('*').eq('year',g.year).order('round').then(r=>setRaces(r.data||[]))},[gid]);
 const load=async()=>{const {data,error}=await sb.from('grid_entries').select('*,drivers(*,driver_ratings(*)),teams(*),cars(*)').eq('grid_id',gid);
  if(error)throw error;
  return (data||[]).map(e=>({driver:e.drivers,team:e.teams,d:one(e.drivers.driver_ratings)||{},c:e.cars||{}}))};
 const run=async()=>{const es=await load();if(es.length<2)return alert('Add at least 2 entries to this grid');
  if(mode==='championship')return setRes({type:'champ',rows:championship(es,races)});
  const r=races.find(x=>x.id==rid)||{};const w=weekend(es,{...r,is_sprint:mode==='sprint'||r.is_sprint});
  setRes({type:mode,rows:mode==='quali'?w.q:mode==='sprint'?w.sprint:w.race})};
 const ch=res?.type==='champ',q=res?.type==='quali';
 return <><h2>Simulate</h2><div className="row"><select value={gid} onChange={e=>setG(e.target.value)}><option value="">Choose grid</option>{grids?.map(g=><option key={g.id} value={g.id}>{g.name} ({g.year})</option>)}</select>
 <select value={mode} onChange={e=>setMode(e.target.value)}>{['quali','sprint','race','championship'].map(m=><option key={m}>{m}</option>)}</select>
 {mode!=='championship'&&<select value={rid} onChange={e=>setR(e.target.value)}><option value="">Any circuit</option>{races.map(r=><option key={r.id} value={r.id}>R{r.round} {r.name}</option>)}</select>}
 <button className="btn" disabled={!gid} onClick={run}>Run</button></div>
 {res&&<table><thead><tr><th>Pos</th><th>Driver</th><th>Team</th>{ch&&<th>Wins</th>}{!q&&<th>Pts</th>}</tr></thead><tbody>
 {res.rows.map((e,i)=><tr key={i}><td>{q?e.grid:ch?i+1:(e.dnf?'DNF':e.pos)}</td><td>{e.driver.name}</td><td style={{borderLeft:'4px solid '+e.team.color}}>{e.team.name}</td>{ch&&<td>{e.wins}</td>}{!q&&<td>{e.pts}</td>}</tr>)}</tbody></table>}</>}
