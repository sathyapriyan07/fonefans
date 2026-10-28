import {useEffect,useState} from 'react';import {sb} from './supabase.js';
const RAT=['race','overtaking','speed','experience','qualifying','defence'],CAR=['speed','race','overtaking','defence','performance','qualifying','reliability'];
const n=k=>({k,t:'number'}),t=k=>({k,t:'text'}),img=k=>({k,t:'image'}),ref=(k,table,label='name')=>({k,t:'ref',table,label});
const T={
 drivers:[t('name'),t('code'),n('number'),{k:'bio',t:'area'},t('nationality'),img('nationality_logo'),t('jolpica_id')],
 driver_images:[ref('driver_id','drivers'),n('year'),img('pole_url'),img('grid_url'),img('card_url')],
 driver_ratings:[ref('driver_id','drivers'),...RAT.map(n)],
 teams:[t('name'),img('logo_detailed'),img('logo_normal'),t('color'),t('jolpica_id')],
 cars:[ref('team_id','teams'),n('year'),t('model'),img('image_url'),t('engine'),...CAR.map(n)],
 grids:[t('name'),n('year')],
 grid_entries:[ref('grid_id','grids'),ref('team_id','teams'),ref('car_id','cars','model'),ref('driver_id','drivers')],
 races:[n('year'),n('round'),t('name'),t('circuit'),t('country'),{k:'date',t:'date'},{k:'is_sprint',t:'bool'},n('laps')]};
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
export default function Admin(){const [s,setS]=useState(null);const [tab,setTab]=useState('import');const [e,setE]=useState({});
 useEffect(()=>{sb.auth.getSession().then(r=>setS(r.data.session));const {data}=sb.auth.onAuthStateChange((_,x)=>setS(x));return()=>data.subscription.unsubscribe()},[]);
 if(!s)return <div className="form"><h2>Admin sign in</h2><label>email<input onChange={x=>setE({...e,email:x.target.value})}/></label><label>password<input type="password" onChange={x=>setE({...e,password:x.target.value})}/></label>
  <button className="btn" onClick={async()=>{const {error}=await sb.auth.signInWithPassword(e);if(error)alert(error.message)}}>Sign in</button></div>;
 return <><div className="row"><h2>Admin</h2><button onClick={()=>sb.auth.signOut()}>Sign out</button></div>
 <div className="tabs">{['import',...Object.keys(T)].map(k=><button key={k} className={k===tab?'on':''} onClick={()=>setTab(k)}>{k.replace('_',' ')}</button>)}</div>{tab==='import'?<Import/>:<Crud table={tab}/>}</>}
