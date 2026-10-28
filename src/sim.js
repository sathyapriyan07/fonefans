// Deterministic lap-based race simulation. Times and gaps are measured in seconds.
export const RACE_PTS=[25,18,15,12,10,8,6,4,2,1];
export const SPRINT_PTS=[8,7,6,5,4,3,2,1];
export const ENGINE_VERSION='2.0.0';
const DEFAULT_LAPS=57;
const DEFAULT_BASE_LAP=90;
const TYRES={
 soft:{pace:-0.18,degradation:0.018,warmup:0.02},
 medium:{pace:0,degradation:0.011,warmup:0.01},
 hard:{pace:0.24,degradation:0.007,warmup:0.04},
 intermediate:{pace:0.4,degradation:0.012,warmup:0.05},
 wet:{pace:0.65,degradation:0.01,warmup:0.08}
};
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const value=(source,key,fallback=50)=>source?.[key]!==null&&source?.[key]!==undefined&&source?.[key]!==''&&Number.isFinite(Number(source[key]))?clamp(Number(source[key]),0,100):fallback;
const average=(items)=>items.reduce((sum,item)=>sum+item,0)/(items.length||1);
const stableId=(entry)=>String(entry.driver?.id??entry.driver?.name??entry.id??'');

function hashSeed(seed){
 let hash=2166136261;
 for(const char of String(seed)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
 return hash>>>0;
}
function makeRandom(seed){
 let state=typeof seed==='number'?seed>>>0:hashSeed(seed);
 return {
  next(){state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296},
  getState(){return state}
 };
}
function stream(state,name){
 const rng=makeRandom(state.randomStreams[name]);
 return {next(){const result=rng.next();state.randomStreams[name]=rng.getState();return result}};
}
function normal(rng){
 const u=Math.max(Number.EPSILON,rng.next()),v=rng.next();
 return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}
function createStreams(seed){
 return Object.fromEntries(['pace','mistakes','mechanical','weather','racecraft'].map(name=>[name,hashSeed(`${seed}:${name}`)]));
}
function makeCircuit(race={}){
 const lengthKm=Number(race.circuit_length_km)||5.2;
 return {
  lengthKm,
  straightImportance:clamp(Number(race.straight_line_importance??0.5),0,1),
  highSpeed:clamp(Number(race.high_speed_corner_share??0.33),0,1),
  mediumSpeed:clamp(Number(race.medium_speed_corner_share??0.34),0,1),
  lowSpeed:clamp(Number(race.low_speed_corner_share??0.33),0,1),
  braking:clamp(Number(race.braking_demand??0.5),0,1),
  traction:clamp(Number(race.traction_demand??0.5),0,1),
  downforce:clamp(Number(race.downforce_requirement??0.5),0,1),
  tyreEnergy:clamp(Number(race.tyre_energy??0.5),0,1),
  overtakingDifficulty:clamp(Number(race.overtaking_difficulty??0.5),0,1),
  pitLaneLoss:Number(race.pit_lane_loss_seconds)>0?Number(race.pit_lane_loss_seconds):19.5,
  baselineLap:Number(race.baseline_lap_seconds)>0?Number(race.baseline_lap_seconds):DEFAULT_BASE_LAP*lengthKm/5.2,
  drsZones:Math.max(0,Number(race.drs_zones??2))
 };
}
function driverRating(driver,key,defaults=[]){
 if(driver?.[key]!==null&&driver?.[key]!==undefined&&driver?.[key]!==''&&Number.isFinite(Number(driver[key])))return value(driver,key);
 for(const fallback of defaults)if(driver?.[fallback]!==null&&driver?.[fallback]!==undefined&&driver?.[fallback]!==''&&Number.isFinite(Number(driver[fallback])))return value(driver,fallback);
 return 50;
}
function carRating(car,key,defaults=[]){
 if(car?.[key]!==null&&car?.[key]!==undefined&&car?.[key]!==''&&Number.isFinite(Number(car[key])))return value(car,key);
 for(const fallback of defaults)if(car?.[fallback]!==null&&car?.[fallback]!==undefined&&car?.[fallback]!==''&&Number.isFinite(Number(car[fallback])))return value(car,fallback);
 return 50;
}
function ratings(entry,circuit){
 const d=entry.d||entry.driver?.driver_ratings?.[0]||{};
 const c=entry.c||entry.car||{};
 const straight=carRating(c,'straight_line_speed',['speed']);
 const high=carRating(c,'high_speed_cornering',['downforce','performance']);
 const medium=carRating(c,'medium_speed_cornering',['performance','race']);
 const low=carRating(c,'low_speed_cornering',['mechanical_grip','race']);
 const carPace=average([
  straight*(0.2+circuit.straightImportance*0.8),
  high*(0.2+circuit.highSpeed),
  medium*(0.2+circuit.mediumSpeed),
  low*(0.2+circuit.lowSpeed),
  carRating(c,'traction',['race'])*(0.2+circuit.traction*0.5),
  carRating(c,'braking',['race'])*(0.2+circuit.braking*0.5)
 ]);
 const driverPace=average([
  driverRating(d,'speed',['race']),
  driverRating(d,'race',['speed']),
  driverRating(d,'consistency',['experience']),
  driverRating(d,'experience'),
  driverRating(d,'adaptability',['experience'])
 ]);
 return {
  d,c,
  driverPace,
  driverQualifying:average([driverRating(d,'qualifying',['speed']),driverRating(d,'speed',['qualifying'])]),
  driverConsistency:driverRating(d,'consistency',['experience']),
  overtaking:driverRating(d,'overtaking',['speed']),
  defence:driverRating(d,'defence',['race']),
  tyreManagement:driverRating(d,'tyre_management',['experience']),
  wetAbility:driverRating(d,'wet_weather',['adaptability','race']),
  starts:driverRating(d,'starts',['speed']),
  braking:driverRating(d,'braking',['speed']),
  errorResistance:driverRating(d,'error_resistance',['consistency','experience']),
  carPace,
  carQualifying:carRating(c,'qualifying',['performance']),
  carRace:carRating(c,'race',['performance']),
  carSpeed:straight,
  carPerformance:carRating(c,'performance',['race']),
  reliability:carRating(c,'reliability'),
  carTyrePreservation:carRating(c,'tyre_preservation',['race']),
  tyrePreservation:carRating(c,'tyre_preservation',['race']),
  fuelEfficiency:carRating(c,'fuel_efficiency',['performance']),
  wetPerformance:carRating(c,'wet_performance',['performance']),
  drs:carRating(c,'drs_effectiveness',['speed'])
 };
}
function setupAdjustedCar(car,setup={},circuit){
 const aero=clamp(Number(setup.aero??50),0,100);
 const suspension=clamp(Number(setup.suspension??50),0,100);
 const tyreCare=clamp(Number(setup.tyreCare??50),0,100);
 const downforceEffect=(aero-50)*(circuit.downforce*0.12-circuit.straightImportance*0.08);
 return {
  ...car,
  speed:clamp(value(car,'speed')-downforceEffect+(suspension-50)*0.025,0,100),
  qualifying:clamp(value(car,'qualifying')+downforceEffect+(suspension-50)*0.04,0,100),
  race:clamp(value(car,'race')+(suspension-50)*0.035,0,100),
  performance:clamp(value(car,'performance')+(50-tyreCare)*0.02,0,100),
  reliability:clamp(value(car,'reliability')+(tyreCare-50)*0.04,0,100),
  tyre_preservation:clamp(carRating(car,'tyre_preservation',['race'])+(tyreCare-50)*0.35,0,100)
 };
}
function paceDelta(rating,secondsPerPoint){return (50-rating)*secondsPerPoint}
function tyreForWeather(weather,requested){
 if(weather.wetness>=0.78)return 'wet';
 if(weather.wetness>=0.42&&requested!=='wet')return 'intermediate';
 if(weather.wetness<0.24&&(requested==='intermediate'||requested==='wet'))return 'medium';
 return TYRES[requested]?requested:'medium';
}
function tyreState(compound='medium'){
 return {compound,age:0,condition:1,temperature:90,graining:0,overheating:0};
}
function strategyFor(entry,strategies,circuit,totalLaps){
 const strategy=strategies?.[entry.team?.id]||{};
 const rating=ratings(entry,circuit);
 const fixedStops=Number.isFinite(Number(strategy.stops))&&strategy.stops!==''?clamp(Math.round(Number(strategy.stops)),0,3):null;
 const fixedTyre=TYRES[strategy.tyre]?strategy.tyre:null;
 if(fixedStops!==null&&fixedTyre)return {...strategy,stops:fixedStops,tyre:fixedTyre};
 let best={stops:fixedStops??1,tyre:fixedTyre??'medium',time:Infinity};
 for(const tyre of fixedTyre?[fixedTyre]:['soft','medium','hard'])for(const stops of fixedStops===null?[0,1,2]:[fixedStops]){
  const stint=totalLaps/(stops+1),model=TYRES[tyre];
  const degradation=(100-carRating(rating.c,'tyre_preservation',['race']))/180+0.25;
  const tyreTime=totalLaps*(model.pace+model.warmup)+totalLaps*Math.pow(stint,1.18)*model.degradation*degradation*0.5;
  const estimated=tyreTime+stops*(circuit.pitLaneLoss+2.5);
  if(estimated<best.time)best={stops,tyre,time:estimated};
 }
 return best;
}
function rankCars(cars){
 return [...cars].sort((a,b)=>b.lapsCompleted-a.lapsCompleted||a.totalTime+a.penaltyTime-b.totalTime-b.penaltyTime||stableId(a.entry).localeCompare(stableId(b.entry)))
  .map((car,index)=>({...car,position:index+1}));
}
function selectPoints(position,format){
 const points=format==='sprint'?SPRINT_PTS:RACE_PTS;
 return points[position-1]||0;
}

export function createRaceState({
 entries,race={},seed=1,format='race',strategies={},setups={},weather='dry',laps
}={}){
 if(!Array.isArray(entries)||entries.length<2)throw new Error('A race requires at least two driver entries.');
 const circuit=makeCircuit(race);
 const totalLaps=Math.max(1,Math.floor(Number(laps||race.laps)||DEFAULT_LAPS));
 const initialWeather={mode:weather,intensity:weather==='wet'?0.75:0,wetness:weather==='wet'?0.8:0,trackTemperature:32,ambientTemperature:22,wind:0};
 const sorted=[...entries].sort((a,b)=>(Number(a.grid)||Infinity)-(Number(b.grid)||Infinity)||stableId(a).localeCompare(stableId(b)));
 const cars=sorted.map((entry,index)=>{
  const setup=setups[entry.team?.id]||{};
  const sourceCar=entry.c||entry.car||{};
  const prepared={...entry,c:setupAdjustedCar(sourceCar,setup,circuit)};
  const rating=ratings(prepared,circuit);
  const strategy=strategyFor(prepared,strategies,circuit,totalLaps);
  const startingTyre=tyreForWeather(initialWeather,strategy.tyre);
  strategy.tyre=startingTyre;
  return {
   entry:prepared,driverId:entry.driver?.id??null,teamId:entry.team?.id??null,
   position:index+1,gridPosition:index+1,lap:0,lapsCompleted:0,totalTime:0,
   lastLap:null,bestLap:null,lastSectors:null,fuelRemaining:Math.max(1,totalLaps*1.72),
   tyre:tyreState(startingTyre),damage:0,pitStops:0,pitHistory:[],penalties:[],
   penaltyTime:0,retired:false,retirementReason:null,events:[],strategy,
   ratings:rating,positionHistory:[index+1],lapHistory:[],completed:false
  };
 });
 return {
  engineVersion:ENGINE_VERSION,seed,totalLaps,lap:0,format,done:false,
  circuit,weather:initialWeather,raceControl:'green',cars,events:[],
  randomStreams:createStreams(seed),rules:{sprintAffectsGrandPrixGrid:false},
  createdAt:null
 };
}

function weatherForLap(state){
 const weather={...state.weather};
 if(weather.mode==='variable'){
  const rng=stream(state,'weather');
  if(rng.next()<0.12)weather.intensity=clamp(weather.intensity+(rng.next()-0.45)*0.38,0,1);
 }else if(weather.mode==='wet')weather.intensity=clamp(weather.intensity+0.015,0,1);
 else weather.intensity=clamp(weather.intensity-0.01,0,1);
 weather.wetness=clamp(weather.wetness+weather.intensity*0.12-0.035,0,1);
 weather.trackTemperature=clamp(weather.trackTemperature+weather.intensity*0.5-0.3,10,60);
 return weather;
}
function calculateLap(car,state,lapNumber,weather,trafficSeconds=0){
 const {circuit}=state,rating=car.ratings,compound=car.tyre.compound;
 const tyreModel=TYRES[compound]||TYRES.medium;
 const fuelPerLap=1.72*(1+(circuit.lengthKm-5.2)*0.035)*(1-(rating.fuelEfficiency-50)*0.001);
 const fuelDelta=car.fuelRemaining*0.03;
 const age=car.tyre.age;
 const driverCare=(rating.tyreManagement-50)*0.004+(rating.carTyrePreservation-50)*0.004;
 const circuitDeg=0.65+circuit.tyreEnergy*0.7;
 const temperatureFactor=1+Math.abs(weather.trackTemperature-30)*0.006;
 const wetFactor=weather.wetness>0.35?0.78:1;
 const degradation=tyreModel.degradation*circuitDeg*temperatureFactor*wetFactor*(1-driverCare);
 const tyreDelta=tyreModel.pace+tyreModel.warmup/(age+1)+Math.pow(age,1.16)*degradation+(1-car.tyre.condition)*2.2+car.tyre.overheating*0.8+car.tyre.graining*0.5;
 const wetPenalty=Math.abs(weather.wetness-(compound==='wet'?0.95:compound==='intermediate'?0.55:0.05))*2.2;
 const wetAbility=(rating.wetAbility-50)*weather.wetness*0.012;
 const carDelta=paceDelta(rating.carPace,0.035)+paceDelta(rating.carRace,0.012);
 const driverDelta=paceDelta(rating.driverPace,0.018);
 const damageDelta=car.damage*(0.18+circuit.highSpeed*0.08);
 const weatherDelta=weather.intensity*0.7+wetPenalty-wetAbility-paceDelta(rating.wetPerformance,0.006)*weather.wetness;
 const mechanicalRng=stream(state,'mechanical');
 let mechanicalEvent=null,retire=false;
 if(mechanicalRng.next()<(101-rating.reliability)*0.000018){
  mechanicalEvent=mechanicalRng.next()<0.18?'mechanical_failure':'mechanical_problem';
  if(mechanicalEvent==='mechanical_failure')retire=true;
 }
 const mistakeRng=stream(state,'mistakes');
 const mistakeRisk=(0.004+(weather.wetness*0.014)+(car.tyre.overheating*0.008)+car.damage*0.002)*(1-(rating.errorResistance/150));
 const mistake=mistakeRng.next()<mistakeRisk;
 const mistakeLoss=mistake?(2+mistakeRng.next()*5):0;
 const paceRng=stream(state,'pace');
 const consistency=Math.max(0.35,(101-rating.driverConsistency)/50);
 const variation=normal(paceRng)*0.12*consistency;
 const startDelta=lapNumber===1?(50-rating.starts)*0.012+(50-carRating(rating.c,'traction',['race']))*0.006:0;
 const baseLap=circuit.baselineLap+carDelta+driverDelta+tyreDelta+fuelDelta+trafficSeconds+weatherDelta+damageDelta+mistakeLoss+variation+startDelta;
 const controlDelta=state.raceControl==='safety_car'?circuit.baselineLap*0.22:0;
 const lapTime=Math.max(35,baseLap+controlDelta);
 const weights=[0.31,0.34,0.35];
 const sectors=[lapTime*weights[0],lapTime*weights[1],lapTime*weights[2]];
 sectors[2]=lapTime-sectors[0]-sectors[1];
 return {
  lapTime,sectors,fuelPerLap,tyreDegradation:degradation,retire,mechanicalEvent,
  mistake,damageIncrease:mistake?0.03:0,tyreHeat:clamp(0.08+circuit.tyreEnergy*0.18+(100-rating.tyreManagement)*0.0008,0,0.5)
 };
}
function plannedPitThisLap(car,lapNumber,totalLaps){
 if(car.retired)return false;
 if(car.weatherPitNeeded)return true;
 if(car.pitStops>=car.strategy.stops)return false;
 const stopNumber=car.pitStops+1;
 const target=Math.round(totalLaps*stopNumber/(car.strategy.stops+1));
 return lapNumber>=target;
}
function recordEvent(state,type,lap,car,details={}){
 const event={type,lap,driverId:car?.driverId??null,teamId:car?.teamId??null,...details};
 state.events.push(event);
 if(car)car.events.push(event);
}
function attemptPasses(state,cars,lapNumber){
 if(state.raceControl==='safety_car')return;
 const oldOrder=[...state.cars].sort((a,b)=>a.position-b.position);
 const carById=new Map(cars.map(car=>[stableId(car.entry),car]));
 const rng=stream(state,'racecraft');
 for(let index=1;index<oldOrder.length;index++){
  const follower=carById.get(stableId(oldOrder[index].entry));
  const leader=carById.get(stableId(oldOrder[index-1].entry));
  if(!follower||!leader||follower.retired||leader.retired||follower.lapsCompleted!==leader.lapsCompleted)continue;
  const gap=follower.totalTime-leader.totalTime;
  const previousGap=oldOrder[index].totalTime-oldOrder[index-1].totalTime;
  if(gap>0||previousGap>1.8)continue;
  const advantage=leader.lastLap-follower.lastLap;
  if(advantage<=0)continue;
  const rating=follower.ratings;
  const drs=state.circuit.drsZones>0&&previousGap<=1?0.18:0;
  const chance=clamp(0.08+advantage*0.13+drs+(rating.overtaking-leader.ratings.defence)*0.002-state.circuit.overtakingDifficulty*0.12,0.03,0.72);
  if(rng.next()<chance){
   recordEvent(state,'overtake',lapNumber,follower,{passedDriverId:leader.driverId});
  }else{
   const delay=Math.max(-gap+0.05,Math.min(1.2,0.25+state.circuit.overtakingDifficulty*0.8));
   follower.totalTime+=delay;
   follower.lastLap+=delay;
   if(follower.lastSectors?.length){follower.lastSectors=[...follower.lastSectors];follower.lastSectors[2]+=delay}
   const lastRecord=follower.lapHistory[follower.lapHistory.length-1];
   if(lastRecord){lastRecord.time+=delay;if(lastRecord.sectors?.length){lastRecord.sectors=[...lastRecord.sectors];lastRecord.sectors[2]+=delay}}
   recordEvent(state,'attack_defended',lapNumber,follower,{defendingDriverId:leader.driverId,timeLoss:delay});
  }
 }
}
function updateTyre(car,lapResult,weather){
 car.tyre.age+=1;
 car.tyre.condition=clamp(car.tyre.condition-lapResult.tyreDegradation,0,1);
 car.tyre.temperature=clamp(car.tyre.temperature+lapResult.tyreHeat*10-weather.wetness*5,45,145);
 car.tyre.overheating=clamp((car.tyre.temperature-105)/40,0,1);
 car.tyre.graining=clamp(car.tyre.graining+(car.tyre.temperature>115?0.03:0)-0.005,0,1);
}
function handlePit(car,state,lapNumber,teamStops){
 const extra=teamStops.has(car.teamId)?2.5:0;
 const service=2.4+normal(stream(state,'mechanical'))*0.18;
 const lane=state.circuit.pitLaneLoss*(state.raceControl==='safety_car'?0.68:1);
 const loss=Math.max(1,lane+service+extra);
 const oldCompound=car.tyre.compound;
 car.totalTime+=loss;
 car.pitStops+=1;
 car.pitHistory.push({lap:lapNumber,from:oldCompound,to:car.strategy.tyre,timeLoss:loss,serviceTime:service,teamStackDelay:extra});
 car.tyre=tyreState(tyreForWeather(state.weather,car.strategy.tyre));
 car.weatherPitNeeded=false;
 teamStops.add(car.teamId);
 recordEvent(state,'pit_stop',lapNumber,car,{timeLoss:loss,compound:car.tyre.compound});
}
export function advanceRaceLap(previous){
 if(previous.done)return previous;
 const state={
  ...previous,lap:previous.lap+1,events:[],randomStreams:{...previous.randomStreams},
  weather:{...previous.weather},cars:previous.cars.map(car=>({...car,tyre:{...car.tyre},pitHistory:[...car.pitHistory],penalties:[...car.penalties],events:[...car.events],positionHistory:[...car.positionHistory],lapHistory:[...car.lapHistory]}))
 };
 const lapNumber=state.lap,weather=weatherForLap(state);
 state.weather=weather;
 const underSafetyCar=previous.raceControl==='safety_car';
 state.raceControl=underSafetyCar?'safety_car':'green';
 const active=state.cars.filter(car=>!car.retired&&!car.completed);
 const results=new Map();
 for(const car of [...active].sort((a,b)=>stableId(a.entry).localeCompare(stableId(b.entry)))){
  const leader=state.cars.find(other=>other.position===car.position-1);
  let traffic=0;
  if(leader&&!leader.retired&&car.lapsCompleted===leader.lapsCompleted){
   const gap=car.totalTime-leader.totalTime;
   if(gap>0&&gap<1.5)traffic=0.15+(1.5-gap)*0.4;
  }
  const tyre=tyreForWeather(weather,car.tyre.compound);
  if(tyre!==car.tyre.compound){car.strategy={...car.strategy,tyre};car.weatherPitNeeded=true;recordEvent(state,'weather_tyre_change_required',lapNumber,car,{compound:tyre})}
  const lapResult=calculateLap(car,state,lapNumber,weather,traffic);
  car.lap=lapNumber;car.lapsCompleted+=1;car.lastLap=lapResult.lapTime;car.lastSectors=lapResult.sectors;
  car.bestLap=car.bestLap===null?lapResult.lapTime:Math.min(car.bestLap,lapResult.lapTime);
  car.totalTime+=lapResult.lapTime;car.fuelRemaining=Math.max(0,car.fuelRemaining-lapResult.fuelPerLap);
  car.damage=clamp(car.damage+lapResult.damageIncrease,0,1);updateTyre(car,lapResult,weather);
  car.lapHistory.push({lap:lapNumber,time:lapResult.lapTime,sectors:lapResult.sectors,tyre:car.tyre.compound,tyreAge:car.tyre.age,fuel:car.fuelRemaining});
  if(lapResult.mechanicalEvent){recordEvent(state,lapResult.mechanicalEvent,lapNumber,car);if(lapResult.retire){car.retired=true;car.retirementReason='Mechanical failure';recordEvent(state,'retirement',lapNumber,car,{reason:car.retirementReason})}}
  if(lapResult.mistake){recordEvent(state,'driver_mistake',lapNumber,car,{timeLoss:lapResult.lapTime})}
  results.set(stableId(car.entry),lapResult);
 }
 const teamStops=new Set();
 for(const car of [...state.cars].sort((a,b)=>a.position-b.position)){
  if(!car.retired&&plannedPitThisLap(car,lapNumber,state.totalLaps))handlePit(car,state,lapNumber,teamStops);
 }
 const incident=state.events.some(event=>['retirement','driver_mistake','mechanical_problem'].includes(event.type));
 const deployed=incident&&stream(state,'racecraft').next()<0.22;
 if(deployed){state.raceControl='safety_car';recordEvent(state,'safety_car',lapNumber,null,{cause:'track incident'})}
 else if(underSafetyCar){state.raceControl='green';recordEvent(state,'safety_car_ended',lapNumber,null)}
 attemptPasses(state,state.cars,lapNumber);
 const ranked=rankCars(state.cars);
 state.cars=ranked.map(car=>{
  if(car.lapsCompleted>=state.totalLaps&&!car.retired)car.completed=true;
  car.positionHistory.push(car.position);
  if(car.retired)car.status='Retired';
  else if(car.completed)car.status='Finished';
  else car.status=state.raceControl==='safety_car'?'Safety Car':'Running';
  return car;
 });
 state.done=state.cars.every(car=>car.completed||car.retired);
 return state;
}
export function getClassification(state){
 return rankCars(state.cars).map((car,index)=>({
  ...car.entry,position:index+1,pos:index+1,grid:car.gridPosition,gridPosition:car.gridPosition,
  dnf:car.retired,retired:car.retired,status:car.status,
  lapsCompleted:car.lapsCompleted,totalTime:car.totalTime,
  bestLap:car.bestLap,lastLap:car.lastLap,lastSectors:car.lastSectors,
  fuelRemaining:car.fuelRemaining,damage:car.damage,tyre:car.tyre,pitStops:car.pitStops,pitHistory:car.pitHistory,
  lapHistory:car.lapHistory,positionHistory:car.positionHistory,strategy:car.strategy,retirementReason:car.retirementReason,
  penalties:car.penalties,pts:car.retired?0:selectPoints(index+1,state.format),
  events:car.events
 }));
}
export function simulateRace(options){
 let state=createRaceState(options);
 while(!state.done)state=advanceRaceLap(state);
 return {state,classification:getClassification(state)};
}

// Practice runs provide pace feedback; their order is never used as a qualifying bonus.
export function practice(entries,noise=0.16,options={}){
 if(typeof noise==='object'){options=noise;noise=options.noise??0.16}
 const seed=typeof options==='number'?options:options.seed??1;
 const circuit=makeCircuit(options.race||{});
 const rng=makeRandom(`${seed}:practice`);
 const rows=entries.map(entry=>{
  const car=setupAdjustedCar(entry.c||{},options.setups?.[entry.team?.id],circuit);
  const rating=ratings({...entry,c:car},circuit);
  const weather=options.weather==='wet'?{wetness:0.75,intensity:0.5}:{wetness:0,intensity:0};
  const laps=[];
  let tyreAge=0,compound='soft';
  for(let index=0;index<5;index++){
   if(index===2){compound='medium';tyreAge=0}
   const tyre=TYRES[compound];
   const fuelLoad=index<2?8:52;
   const degradation=Math.pow(tyreAge,1.16)*tyre.degradation*(0.65+circuit.tyreEnergy*0.7);
   const fuelDelta=fuelLoad*0.03;
   const weatherDelta=weather.intensity*0.7+Math.abs(weather.wetness-(compound==='wet'?0.95:0.05))*weather.wetness;
   const trackEvolution=index*0.018;
   const execution=normal(rng)*noise*(101-rating.driverConsistency)/50;
   const traffic=rng.next()<0.08?0.25+rng.next()*0.7:0;
   const lapTime=circuit.baselineLap+paceDelta(rating.driverPace,0.025)+paceDelta(rating.carPace,0.035)+tyre.pace+degradation+fuelDelta+weatherDelta-trackEvolution+execution+traffic;
   laps.push({time:Math.max(35,lapTime),compound,tyreAge,fuelLoad});
   tyreAge+=1;
  }
  const bestLap=Math.min(...laps.map(lap=>lap.time));
  const best=laps.find(lap=>lap.time===bestLap);
  const longRun=laps.slice(2);
  const sectors=[bestLap*0.31,bestLap*0.34,bestLap*0.35];
  sectors[2]=bestLap-sectors[0]-sectors[1];
  return {...entry,practiceScore:-bestLap,bestLap,sectors,lapCount:laps.length,
   longRunAverage:average(longRun.map(lap=>lap.time)),tyreCompound:best.compound,tyreAge:best.tyreAge+1,
   fuelLoad:best.fuelLoad,lapHistory:laps,setupFeedback:'Baseline setup run completed',sessionStatus:'Complete'};
 }).sort((a,b)=>b.practiceScore-a.practiceScore);
 return rows.map((entry,index)=>({...entry,practicePos:index+1}));
}

// Session qualifying with optional Q1/Q2/Q3 knockout rounds and grid penalties.
export function qualify(entries,noise=0.22,options={}){
 if(typeof noise==='object'){options=noise;noise=options.noise??0.22}
 const circuit=makeCircuit(options.race||{});
 const rng=makeRandom(`${options.seed??1}:qualifying`);
 const runRound=(field,round)=>{
  const rows=field.map((entry,index)=>{
   const car=setupAdjustedCar(entry.c||{},options.setups?.[entry.team?.id],circuit);
   const rating=ratings({...entry,c:car},circuit);
   const weather=options.weather?.wetness||0;
   const execution=normal(rng)*noise*(101-rating.driverConsistency)/50;
   const mistake=rng.next()<(0.015+weather*0.035)*(1-rating.errorResistance/150);
   const traffic=rng.next()<0.07?0.2+rng.next()*0.9:0;
   const invalid=rng.next()<0.008;
   const lapTime=circuit.baselineLap+paceDelta(rating.driverQualifying,0.025)+paceDelta(rating.carQualifying,0.035)+paceDelta(rating.carSpeed,0.008)+execution+(mistake?1.2+rng.next()*2.5:0)+traffic+weather*(2-rating.wetAbility/100)-index*0.012;
   const sectors=[lapTime*0.31,lapTime*0.34,lapTime*0.35];sectors[2]=lapTime-sectors[0]-sectors[1];
   return {...entry,q:invalid?-Infinity:-lapTime,bestLap:invalid?Infinity:lapTime,sectors,
    timedLaps:(entry.timedLaps||0)+1,eliminated:false,round,invalidLap:invalid,driverMistake:mistake};
  }).sort((a,b)=>b.q-a.q||stableId(a).localeCompare(stableId(b)));
  return rows;
 };
 let ranked;
 const knockout=options.knockout!==false&&entries.length>15;
 if(knockout){
  const cut=Number.isInteger(options.eliminatePerRound)?Math.max(0,options.eliminatePerRound):Math.floor((entries.length-10)/2);
  const q1=runRound(entries,'Q1');
  const q1Out=q1.slice(Math.max(0,q1.length-cut)).map(entry=>({...entry,eliminated:true}));
  const q2=runRound(q1.slice(0,Math.max(0,q1.length-cut)),'Q2');
  const q2Out=q2.slice(Math.max(0,q2.length-cut)).map(entry=>({...entry,eliminated:true}));
  const q3=runRound(q2.slice(0,Math.max(0,q2.length-cut)),'Q3');
  ranked=[...q3,...q2Out,...q1Out];
 }else ranked=runRound(entries,'Q');
 ranked=ranked.sort((a,b)=>{
  const order={Q3:0,Q2:1,Q1:2,Q:0};
  return (order[a.round]??3)-(order[b.round]??3)||b.q-a.q||stableId(a).localeCompare(stableId(b));
 });
 ranked=ranked.map((entry,index)=>({...entry,grid:index+1,position:index+1,gridPenalty:Number(options.gridPenalties?.[entry.driver?.id]||0)}));
 for(const entry of ranked.filter(row=>row.gridPenalty>0)){
  ranked=ranked.filter(row=>row!==entry);
  ranked.splice(Math.min(ranked.length,entry.grid-1+entry.gridPenalty),0,entry);
 }
 return ranked.map((entry,index)=>({...entry,grid:index+1,position:index+1,gapToPole:entry.bestLap-ranked[0].bestLap}));
}

// Backward-compatible helper that now uses the same seeded lap model.
export function race(entries,{sprint=false,strategies={},seed=1,race:raceData={},laps}={}){
 const ordered=entries.map((entry,index)=>({...entry,grid:entry.grid||index+1}));
 const {classification}=simulateRace({entries:ordered,race:raceData,seed,format:sprint?'sprint':'race',strategies,laps});
 return classification.map(row=>({...row,pos:row.position}));
}
export function weekend(entries,raceData={},options={}){
 const qualifying=qualify(entries,{seed:options.seed??1,race:raceData});
 const sprint=raceData.is_sprint?race(qualifying,{sprint:true,seed:options.seed??1,race:raceData,strategies:options.strategies}):null;
 const grandPrixGrid=raceData.is_sprint&&raceData.sprintAffectsGrandPrixGrid?sprint:qualifying;
 return {q:qualifying,sprint,race:race(grandPrixGrid,{seed:(options.seed??1)+1,race:raceData,strategies:options.strategies})};
}
export function championship(entries,races,options={}){
 const tally={};
 for(let index=0;index<races.length;index++){
  const result=weekend(entries,races[index],{...options,seed:(options.seed??1)+index*17});
  for(const session of [result.sprint,result.race].filter(Boolean))for(const entry of session){
   const driverId=entry.driver.id;
   const record=(tally[driverId]??={driver:entry.driver,team:entry.team,pts:0,wins:0});
   record.pts+=entry.pts;
   if(entry.pos===1&&session===result.race)record.wins+=1;
  }
 }
 return Object.values(tally).sort((a,b)=>b.pts-a.pts);
}
