// Rating-based simulation. d = driver ratings, c = car ratings (0-100).
const gauss=()=>{let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
const R=(x)=>x??50;
export const RACE_PTS=[25,18,15,12,10,8,6,4,2,1],SPRINT_PTS=[8,7,6,5,4,3,2,1];
export function qualify(es,noise=6){return es.map(e=>({...e,q:.45*R(e.d.qualifying)+.3*R(e.c.qualifying)+.15*R(e.c.speed)+.1*R(e.d.speed)+gauss()*noise}))
 .sort((a,b)=>b.q-a.q).map((e,i)=>({...e,grid:i+1}))}
export function race(es,{sprint=false,noise=7}={}){
 const k=sprint?.4:1;
 const out=es.map(e=>{const dnf=Math.random()<(100-R(e.c.reliability))/100*.12*k;
  const pace=.3*R(e.d.race)+.25*R(e.c.race)+.2*R(e.c.performance)+.1*R(e.d.speed)+.05*R(e.d.experience)+.1*R(e.c.speed);
  const gridBonus=(es.length-e.grid)*.35*(1-.006*R(e.d.overtaking)-.002*R(e.c.overtaking));
  return {...e,dnf,score:dnf?-1e9:pace+gridBonus+gauss()*noise}}).sort((a,b)=>b.score-a.score);
 return out.map((e,i)=>({...e,pos:i+1,pts:e.dnf?0:(sprint?SPRINT_PTS:RACE_PTS)[i]||0}))}
export function weekend(es,r){const q=qualify(es);return {q,sprint:r.is_sprint?race(q,{sprint:true}):null,race:race(q)}}
export function championship(es,races){const tally={};
 for(const r of races){const w=weekend(es,r);for(const s of [w.sprint,w.race].filter(Boolean))for(const e of s){
  const t=(tally[e.driver.id]??={driver:e.driver,team:e.team,pts:0,wins:0});t.pts+=e.pts;if(e.pos===1&&s!==w.sprint)t.wins++}}
 return Object.values(tally).sort((a,b)=>b.pts-a.pts)}
