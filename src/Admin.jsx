import {useEffect,useState} from 'react';import {sb} from './supabase.js';
const RAT=['race','overtaking','speed','experience','qualifying','defence','overall','consistency','tyre_management','wet_weather','starts','braking','error_resistance','adaptability','racecraft'],CAR=['speed','race','overtaking','defence','performance','qualifying','reliability','straight_line_speed','aerodynamic_efficiency','high_speed_cornering','medium_speed_cornering','low_speed_cornering','downforce','mechanical_grip','traction','braking','tyre_preservation','fuel_efficiency','wet_performance','drs_effectiveness'];
const n=k=>({k,t:'number'}),t=k=>({k,t:'text'}),img=k=>({k,t:'image'}),select=(k,options)=>({k,t:'select',options}),ref=(k,table,label='name')=>({k,t:'ref',table,label});
const T={
 drivers:[t('name'),t('code'),n('number'),{k:'bio',t:'area'},t('nationality'),img('nationality_logo'),t('jolpica_id')],
 driver_images:[ref('driver_id','drivers'),n('year'),img('pole_url'),img('grid_url'),img('card_url')],
 driver_ratings:[ref('driver_id','drivers'),...RAT.map(n)],
 teams:[t('name'),img('logo_detailed'),img('logo_normal'),t('color'),n('pit_crew_execution'),n('strategy_quality'),n('reliability_management'),n('operational_consistency'),n('damage_repair_efficiency'),t('jolpica_id')],
 cars:[ref('team_id','teams'),n('year'),t('model'),img('image_url'),t('engine'),...CAR.map(n)],
 tyre_images:[select('compound',['soft','medium','hard','intermediate','wet']),img('image_url')],
 grids:[t('name'),n('year')],
 grid_entries:[ref('grid_id','grids'),ref('team_id','teams'),ref('car_id','cars','model'),ref('driver_id','drivers')],
 races:[n('year'),n('round'),t('name'),t('circuit'),t('country'),img('circuit_image_url'),{k:'date',t:'date'},{k:'is_sprint',t:'bool'},n('laps'),n('circuit_length_km'),n('straight_line_importance'),n('high_speed_corner_share'),n('medium_speed_corner_share'),n('low_speed_corner_share'),n('braking_demand'),n('traction_demand'),n('downforce_requirement'),n('tyre_energy'),n('overtaking_difficulty'),n('pit_lane_loss_seconds'),n('baseline_lap_seconds'),n('drs_zones'),n('tyre_wear_multiplier'),n('puncture_risk_multiplier'),n('tyre_overheating_threshold'),{k:'circuit_path',t:'area'},t('weekend_format'),{k:'sprint_affects_grand_prix_grid',t:'bool'}]};
const IMAGE_TYPES=['image/png','image/jpeg','image/webp','image/gif','image/svg+xml','image/avif','image/x-icon'];
const MAX_IMAGE_SIZE=10*1024*1024;
function Crud({table}){const F=T[table];const [rows,setRows]=useState([]);const [opts,setOpts]=useState({});const [form,setForm]=useState({});const [saving,setSaving]=useState(false);
 const load=async()=>{setRows((await sb.from(table).select('*').order('id',{ascending:false}).limit(200)).data||[]);
  const o={};for(const f of F.filter(f=>f.t==='ref'))o[f.k]=(await sb.from(f.table).select('*')).data||[];setOpts(o)};
 useEffect(()=>{setForm({});load()},[table]);
 const set=(k,v)=>setForm({...form,[k]:v});
 const save=async()=>{setSaving(true);try{const p={...form};
  for(const f of F.filter(f=>f.t==='image'))if(p[f.k] instanceof File){const file=p[f.k];
   if(!IMAGE_TYPES.includes(file.type))return alert('Choose a supported image file.');
   if(file.size>MAX_IMAGE_SIZE)return alert('Images must be 10 MB or smaller.');
   const name=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
   const path=`${table}/${f.k}/${crypto.randomUUID()}-${name}`;
   const {error}=await sb.storage.from('f1-assets').upload(path,file,{cacheControl:'3600',contentType:file.type,upsert:false});
   if(error)return alert(`Image upload failed: ${error.message}`);
   p[f.k]=sb.storage.from('f1-assets').getPublicUrl(path).data.publicUrl;
  }
  Object.keys(p).forEach(k=>{if(p[k]==='')delete p[k]});
  const {error}=p.id?await sb.from(table).update(p).eq('id',p.id):await sb.from(table).insert(p);
  if(error)return alert(error.message);setForm({});load();
 }catch(error){alert(`Save failed: ${error instanceof Error?error.message:String(error)}`)}finally{setSaving(false)}};
 const del=async id=>{if(confirm('Delete this row?')){const {error}=await sb.from(table).delete().eq('id',id);if(error)alert(error.message);load()}};
 const show=(r,f)=>f.t==='ref'?(opts[f.k]?.find(o=>o.id===r[f.k])?.[f.label]??r[f.k]):String(r[f.k]??'');
 return <><div className="form">{F.map(f=><label key={f.k}>{f.k}{f.t==='ref'?<select value={form[f.k]||''} onChange={e=>set(f.k,e.target.value)}><option value="">none</option>{opts[f.k]?.map(o=><option key={o.id} value={o.id}>{o[f.label]}</option>)}</select>
  :f.t==='area'?<textarea value={form[f.k]||''} onChange={e=>set(f.k,e.target.value)}/>
  :f.t==='bool'?<input type="checkbox" checked={!!form[f.k]} onChange={e=>set(f.k,e.target.checked)}/>
  :f.t==='select'?<select value={form[f.k]||''} onChange={e=>set(f.k,e.target.value)}><option value="">Choose…</option>{f.options.map(option=><option key={option} value={option}>{option}</option>)}</select>
  :f.t==='image'?<><input type="text" placeholder="Image URL or upload a file" value={typeof form[f.k]==='string'?form[f.k]:''} onChange={e=>set(f.k,e.target.value)}/>
   <input type="file" accept={IMAGE_TYPES.join(',')} onChange={e=>{const file=e.target.files?.[0];if(!file)return;
   if(!IMAGE_TYPES.includes(file.type)){alert('Choose a supported image file.');e.target.value='';return}
   if(file.size>MAX_IMAGE_SIZE){alert('Images must be 10 MB or smaller.');e.target.value='';return}
   set(f.k,file)}}/>
   {typeof form[f.k]==='string'&&form[f.k]&&<img className="image-preview" src={form[f.k]} alt={`${f.k} preview`}/>}
   {form[f.k] instanceof File&&<span className="muted">{form[f.k].name}</span>}
   {form[f.k]&&<button type="button" onClick={()=>set(f.k,null)}>Remove image</button>}</>
  :<input type={f.t==='number'?'number':f.t==='date'?'date':'text'} value={form[f.k]??''} onChange={e=>set(f.k,e.target.value)}/>}</label>)}
  <div className="row"><button className="btn" onClick={save} disabled={saving}>{saving?'Saving…':form.id?'Update':'Create'}</button>{form.id&&<button onClick={()=>setForm({})}>Cancel</button>}</div></div>
  <div className="scroll"><table><thead><tr>{F.map(f=><th key={f.k}>{f.k}</th>)}<th/></tr></thead><tbody>{rows.map(r=><tr key={r.id}>{F.map(f=><td key={f.k}>{show(r,f)}</td>)}<td><button onClick={()=>setForm(r)}>edit</button> <button onClick={()=>del(r.id)}>delete</button></td></tr>)}</tbody></table></div></>}
const J='https://api.jolpi.ca/ergast/f1/';
function Import(){const [year,setY]=useState(new Date().getFullYear());const [log,setLog]=useState([]);const L=m=>setLog(l=>[...l,m]);
 const get=async p=>(await fetch(J+year+p+'.json?limit=100')).json();
 const drivers=async()=>{const ds=(await get('/drivers')).MRData.DriverTable.Drivers;
  const {data,error}=await sb.from('drivers').upsert(ds.map(d=>({jolpica_id:d.driverId,name:d.givenName+' '+d.familyName,code:d.code,number:d.permanentNumber?+d.permanentNumber:null,nationality:d.nationality})),{onConflict:'jolpica_id'}).select('id');
  if(error)return L(error.message);await sb.from('driver_ratings').upsert(data.map(d=>({driver_id:d.id})),{onConflict:'driver_id',ignoreDuplicates:true});L(`Drivers: ${data.length} imported, default ratings of 50 added`)};
 const teams=async()=>{const cs=(await get('/constructors')).MRData.ConstructorTable.Constructors;
  const {error}=await sb.from('teams').upsert(cs.map(c=>({jolpica_id:c.constructorId,name:c.name})),{onConflict:'jolpica_id'});L(error?error.message:`Teams: ${cs.length} imported`)};
 const races=async()=>{const rs=(await get('')).MRData.RaceTable.Races;
  const {error}=await sb.from('races').upsert(rs.map(r=>({year:+r.season,round:+r.round,name:r.raceName,circuit:r.Circuit.circuitName,country:r.Circuit.Location.country,date:r.date,is_sprint:!!r.Sprint})),{onConflict:'year,round'});L(error?error.message:`Races: ${rs.length} imported`)};
 return <div className="form"><label>season<input type="number" value={year} onChange={e=>setY(e.target.value)}/></label>
 <div className="row"><button className="btn" onClick={drivers}>Import drivers</button><button className="btn" onClick={teams}>Import teams</button><button className="btn" onClick={races}>Import races</button></div><pre>{log.join('\n')}</pre>
 <p className="muted">Data comes from the Jolpica F1 API. Images, logos, ratings and cars are added by hand in the other tabs.</p></div>}
function Lineups(){const [year,setYear]=useState(new Date().getFullYear());const [teams,setTeams]=useState([]);const [drivers,setDrivers]=useState([]);const [lineups,setLineups]=useState({});
 const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [message,setMessage]=useState('');const [savingTeam,setSavingTeam]=useState(null);
 useEffect(()=>{let active=true;setError('');setMessage('');
  if(!Number.isInteger(Number(year))||Number(year)<1950||Number(year)>2200){setLoading(false);setError('Enter a season from 1950 through 2200.');return()=>{active=false}}
  setLoading(true);
  Promise.all([sb.from('teams').select('id,name').order('name'),sb.from('drivers').select('id,name').order('name'),sb.from('team_driver_lineups').select('*').eq('year',year)])
   .then(([teamResult,driverResult,lineupResult])=>{for(const result of [teamResult,driverResult,lineupResult])if(result.error)throw result.error;
    if(!active)return;setTeams(teamResult.data||[]);setDrivers(driverResult.data||[]);
    const saved=Object.fromEntries((lineupResult.data||[]).map(row=>[String(row.team_id),row]));
    setLineups(Object.fromEntries((teamResult.data||[]).map(team=>{const row=saved[String(team.id)]||{};return [String(team.id),{driver_1_id:row.driver_1_id?String(row.driver_1_id):'',driver_2_id:row.driver_2_id?String(row.driver_2_id):'',reserve_driver_id:row.reserve_driver_id?String(row.reserve_driver_id):''}]})));
   }).catch(loadError=>{console.error('Could not load team lineups:',loadError);if(active)setError(loadError instanceof Error?loadError.message:String(loadError))})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[year]);
 const setSlot=(teamId,key,value)=>setLineups(current=>({...current,[String(teamId)]:{...current[String(teamId)],[key]:value}}));
 const save=async team=>{if(!Number.isInteger(Number(year))||Number(year)<1950||Number(year)>2200){setMessage('Enter a valid season from 1950 through 2200.');return}
  const lineup=lineups[String(team.id)]||{};const selected=[lineup.driver_1_id,lineup.driver_2_id,lineup.reserve_driver_id].filter(Boolean);
  if(new Set(selected).size!==selected.length){setMessage(`${team.name}: choose a different driver for each slot.`);return}
  setSavingTeam(team.id);setMessage('');
  try{const {error:saveError}=await sb.from('team_driver_lineups').upsert({team_id:team.id,year:Number(year),driver_1_id:lineup.driver_1_id?Number(lineup.driver_1_id):null,driver_2_id:lineup.driver_2_id?Number(lineup.driver_2_id):null,reserve_driver_id:lineup.reserve_driver_id?Number(lineup.reserve_driver_id):null},{onConflict:'team_id,year'});
   if(saveError)throw saveError;setMessage(`${team.name} lineup saved for ${year}.`);
  }catch(saveError){console.error('Could not save team lineup:',saveError);setMessage(`Could not save ${team.name}: ${saveError instanceof Error?saveError.message:String(saveError)}`)}
  finally{setSavingTeam(null)}
 };
 const slots=[['driver_1_id','Race driver 1'],['driver_2_id','Race driver 2'],['reserve_driver_id','Reserve driver']];
 return <section className="lineup-manager"><div className="lineup-season"><label>Season<input type="number" min="1950" max="2200" value={year} onChange={event=>setYear(event.target.value)}/></label><p className="muted">Set two race drivers and one reserve per team. Choose a past year to manage historical lineups.</p></div>
  {loading&&<p className="query-status" role="status">Loading teams and drivers…</p>}{error&&<p className="query-status query-error" role="alert">Could not load lineups: {error}</p>}
  {!loading&&!error&&teams.length===0&&<p className="query-status">Add teams before assigning lineups.</p>}
  {teams.map(team=><article className="lineup-team" key={team.id}><h3>{team.name} <small>{year}</small></h3><div className="lineup-slots">{slots.map(([key,label])=><label key={key}>{label}<select disabled={Boolean(error)||savingTeam!==null} value={lineups[String(team.id)]?.[key]||''} onChange={event=>setSlot(team.id,key,event.target.value)}><option value="">Not assigned</option>{drivers.map(driver=><option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label>)}</div><div className="row"><button className="btn" disabled={loading||Boolean(error)||savingTeam!==null} onClick={()=>save(team)}>{savingTeam===team.id?'Saving…':'Save lineup'}</button></div></article>)}
  {message&&<p role="status" className={message.startsWith('Could not')||message.includes('choose a different')||message.startsWith('Enter a valid')?'query-status query-error':'query-status'}>{message}</p>}
 </section>}
export default function Admin(){const [s,setS]=useState(null);const [tab,setTab]=useState('import');const [e,setE]=useState({});
 useEffect(()=>{sb.auth.getSession().then(r=>setS(r.data.session));const {data}=sb.auth.onAuthStateChange((_,x)=>setS(x));return()=>data.subscription.unsubscribe()},[]);
 if(!s)return <div className="form"><h2>Admin sign in</h2><label>email<input onChange={x=>setE({...e,email:x.target.value})}/></label><label>password<input type="password" onChange={x=>setE({...e,password:x.target.value})}/></label>
  <button className="btn" onClick={async()=>{const {error}=await sb.auth.signInWithPassword(e);if(error)alert(error.message)}}>Sign in</button></div>;
 return <><div className="row"><h2>Admin</h2><button onClick={()=>sb.auth.signOut()}>Sign out</button></div>
 <div className="tabs">{['import','lineups',...Object.keys(T)].map(k=><button key={k} className={k===tab?'on':''} onClick={()=>setTab(k)}>{k.replace('_',' ')}</button>)}</div>{tab==='import'?<Import/>:tab==='lineups'?<Lineups/>:<Crud table={tab}/>}</>}
