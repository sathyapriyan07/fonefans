// Deterministic lap-based race simulation. Times and gaps are measured in seconds.
export const RACE_PTS=[25,18,15,12,10,8,6,4,2,1];
export const SPRINT_PTS=[8,7,6,5,4,3,2,1];
export const ENGINE_VERSION='2.1.0';
const DEFAULT_LAPS=57;
const DEFAULT_BASE_LAP=90;
export const TYRES={
 soft:{pace:-0.18,degradation:0.018,warmup:0.02,grip:1.04},
 medium:{pace:0,degradation:0.011,warmup:0.01,grip:1},
 hard:{pace:0.24,degradation:0.007,warmup:0.04,grip:0.96},
 intermediate:{pace:0.4,degradation:0.012,warmup:0.05,grip:0.92},
 wet:{pace:0.65,degradation:0.01,warmup:0.08,grip:0.9}
};
const TYRE_DEFAULTS={wearCritical:82,wearDanger:95,overheatingThreshold:105,punctureBasePerLap:0.00004,wearMultiplier:1};
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
  drsZones:Math.max(0,Number(race.drs_zones??(Number(race.year)<2011?0:2))),
  wearMultiplier:Number(race.tyre_wear_multiplier)>0?Number(race.tyre_wear_multiplier):1,
  punctureRisk:Number(race.puncture_risk_multiplier)>0?Number(race.puncture_risk_multiplier):1,
  overheatingThreshold:Number(race.tyre_overheating_threshold)>0?Number(race.tyre_overheating_threshold):105,
  trackPath:typeof race.circuit_path==='string'?race.circuit_path:'',
  geometrySource:race.geometry_source||'schematic'
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
 const aero=carRating(c,'aerodynamic_efficiency',['downforce','performance']);
 const high=carRating(c,'high_speed_cornering',['downforce','performance']);
 const medium=carRating(c,'medium_speed_cornering',['performance','race']);
 const low=carRating(c,'low_speed_cornering',['mechanical_grip','race']);
 const carPace=average([
  straight*(0.2+circuit.straightImportance*0.8),
  aero*(0.2+circuit.downforce*0.45),
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
  drs:carRating(c,'drs_effectiveness',['speed']),
  pitCrewExecution:value(entry.team,'pit_crew_execution',50),
  strategyQuality:value(entry.team,'strategy_quality',100),
  reliabilityManagement:value(entry.team,'reliability_management',50),
  operationalConsistency:value(entry.team,'operational_consistency',50)
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
 return {compound,age:0,wear:0,condition:1,grip:TYRES[compound]?.grip??1,temperature:90,graining:0,overheating:0,degradationRate:0,state:'fresh',remainingCompetitiveLaps:null};
}
function strategyFor(entry,strategies,circuit,totalLaps,seed=1,minimumStops=0){
 const strategy=strategies?.[entry.team?.id]||{};
 const rating=ratings(entry,circuit);
 const fixedStops=Number.isFinite(Number(strategy.stops))&&strategy.stops!==''?clamp(Math.round(Number(strategy.stops)),0,3):null;
 const fixedTyre=TYRES[strategy.tyre]?strategy.tyre:null;
 const candidates=[];
 const degradation=(100-rating.carTyrePreservation)/180+0.25;
 for(const tyre of fixedTyre?[fixedTyre]:['soft','medium','hard'])for(const stops of fixedStops===null?Array.from({length:3-minimumStops},(_,index)=>index+minimumStops):[fixedStops]){
  const stint=totalLaps/(stops+1);
  const sequence=[tyre];
  for(let stop=1;stop<=stops;stop++){
   const next=['soft','medium','hard'].filter(compound=>compound!==sequence[stop-1])
    .sort((a,b)=>(TYRES[a].pace+TYRES[a].degradation*stint)-(TYRES[b].pace+TYRES[b].degradation*stint))[0];
   sequence.push(next);
  }
  const tyreTime=sequence.reduce((sum,compound)=>sum+stint*(TYRES[compound].pace+TYRES[compound].warmup)+Math.pow(stint,2.18)*TYRES[compound].degradation*degradation*0.5,0);
  candidates.push({stops,tyre,compounds:sequence,time:tyreTime+stops*(circuit.pitLaneLoss+2.5)});
 }
 candidates.sort((a,b)=>a.time-b.time);
 const quality=value(entry.team,'strategy_quality',100),rng=makeRandom(`${seed}:${entry.team?.id}:strategy`);
 const choice=quality>=100||candidates.length===1?0:rng.next()<(100-quality)/120?Math.min(candidates.length-1,1+Math.floor(rng.next()*2)):0;
 const selected=candidates[choice];
 const variation=(driverRating(rating.d,'tyre_management',['experience'])-50)*0.004+(carRating(rating.c,'tyre_preservation',['race'])-50)*0.003;
 const plannedPitLap=clamp(Math.round(totalLaps/(selected.stops+1)*(1+variation)),2,Math.max(2,totalLaps-2));
 return {...strategy,stops:selected.stops,tyre:selected.tyre,compounds:selected.compounds,plannedPitLap,automatic:strategy.stops==='auto'||strategy.tyre==='auto'||Object.keys(strategy).length===0};
}
function rankCars(cars){
 return [...cars].sort((a,b)=>b.lapsCompleted-a.lapsCompleted||a.totalTime+a.penaltyTime-b.totalTime-b.penaltyTime||stableId(a.entry).localeCompare(stableId(b.entry)))
  .map((car,index)=>({...car,position:index+1}));
}
function selectPoints(position,format){
 const points=format==='sprint'?SPRINT_PTS:RACE_PTS;
 return points[position-1]||0;
}
export function getWeekendPhases(race={}){
 const format=String(race.weekend_format||'').toLowerCase();
 const sprint=race.is_sprint||format.startsWith('sprint');
 return sprint?['practice1','sprintQualifying','sprint','qualifying','race']:['practice1','practice2','practice3','qualifying','race'];
}

export function createRaceState({
 entries,race={},seed=1,format='race',strategies={},setups={},weather='dry',laps,rules={},tyreConfig={}
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
  const requireTwoCompounds=rules.mandatoryDryTyreCompounds??(format==='race'&&Number(race.year)>=2007&&initialWeather.wetness<0.24);
  const strategy=strategyFor(prepared,strategies,circuit,totalLaps,seed,requireTwoCompounds?1:0);
  const startingTyre=tyreForWeather(initialWeather,strategy.tyre);
  strategy.tyre=startingTyre;
  return {
   entry:prepared,driverId:entry.driver?.id??null,teamId:entry.team?.id??null,
   position:index+1,gridPosition:index+1,lap:0,lapsCompleted:0,totalTime:0,
   lastLap:null,bestLap:null,lastSectors:null,fuelRemaining:Math.max(1,totalLaps*1.72*(1+(circuit.lengthKm-5.2)*0.035)*(1-(rating.fuelEfficiency-50)*0.001)),
   tyre:tyreState(startingTyre),damage:0,pitStops:0,pitHistory:[],penalties:[],
   penaltyTime:0,retired:false,retirementReason:null,events:[],strategy,
   ratings:rating,positionHistory:[index+1],lapHistory:[],completed:false,
   automaticStrategy:true,manualPitMode:false,pitInstruction:null,pitStatus:'AUTO',
   pitState:null,pitLaneProgress:0,lastTrafficSeconds:0,
   lastPitLap:null,retiredProgress:null,
   pendingCompound:null,plannedStopLap:strategy.plannedPitLap,stayOutDeferredLap:null,
   tyreConfig:{...TYRE_DEFAULTS,wearMultiplier:circuit.wearMultiplier,punctureRisk:circuit.punctureRisk,overheatingThreshold:circuit.overheatingThreshold,...tyreConfig},
   mileageKm:0,vehicleStress:0,mechanicalFault:null,retirementLap:null,trackProgress:index*0.002
  };
 });
 return {
  engineVersion:ENGINE_VERSION,seed,totalLaps,lap:0,format,done:false,
  circuit,weather:initialWeather,raceControl:'green',cars,events:[],
  randomStreams:createStreams(seed),rules:{sprintAffectsGrandPrixGrid:false,...rules},
  tyreConfig:{...TYRE_DEFAULTS,wearMultiplier:circuit.wearMultiplier,punctureRisk:circuit.punctureRisk,overheatingThreshold:circuit.overheatingThreshold,...tyreConfig},
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
 const degradation=tyreModel.degradation*circuitDeg*temperatureFactor*wetFactor*(1-driverCare)*state.tyreConfig.wearMultiplier;
 const tyreDelta=tyreModel.pace+tyreModel.warmup/(age+1)+Math.pow(age,1.16)*degradation+(1-car.tyre.grip)*2.2+car.tyre.overheating*0.8+car.tyre.graining*0.5;
 const wetPenalty=Math.abs(weather.wetness-(compound==='wet'?0.95:compound==='intermediate'?0.55:0.05))*2.2;
 const wetAbility=(rating.wetAbility-50)*weather.wetness*0.012;
 const carDelta=paceDelta(rating.carPace,0.035)+paceDelta(rating.carRace,0.012);
 const driverDelta=paceDelta(rating.driverPace,0.018);
 const damageDelta=car.damage*(0.18+circuit.highSpeed*0.08);
 const weatherDelta=weather.intensity*0.7+wetPenalty-wetAbility-paceDelta(rating.wetPerformance,0.006)*weather.wetness;
 const mechanicalRng=stream(state,'mechanical');
 let mechanicalEvent=null,retire=false;
 const effectiveReliability=clamp(rating.reliability+(rating.reliabilityManagement-50)*0.12,0,100);
 const stressFactor=1+car.vehicleStress*0.8+car.damage*1.5;
 if(mechanicalRng.next()<(0.00012+(100-effectiveReliability)*0.000025)*stressFactor){
  const failure=mechanicalRng.next();
  mechanicalEvent=failure<0.19?'engine_failure':failure<0.34?'gearbox_failure':failure<0.48?'electrical_failure':failure<0.61?'hydraulic_failure':failure<0.73?'brake_failure':failure<0.84?'cooling_failure':failure<0.93?'suspension_failure':'mechanical_problem';
  retire=['engine_failure','gearbox_failure','electrical_failure','hydraulic_failure','brake_failure','cooling_failure'].includes(mechanicalEvent);
 }
 const punctureRange=Math.max(1,100-state.tyreConfig.wearDanger);
 const punctureRisk=state.tyreConfig.punctureBasePerLap+
  Math.pow(Math.max(0,car.tyre.wear-state.tyreConfig.wearDanger)/punctureRange,2)*0.08*state.circuit.punctureRisk;
 const puncture=stream(state,'mechanical').next()<punctureRisk;
 const punctureLoss=puncture?clamp(7+(stream(state,'mechanical').next()*8),7,15):0;
 const failureLoss=mechanicalEvent==='suspension_failure'?3.5:mechanicalEvent==='mechanical_problem'?1.5:0;
 const mistakeRng=stream(state,'mistakes');
 const mistakeRisk=(0.004+(weather.wetness*0.014)+(car.tyre.overheating*0.008)+car.damage*0.002)*(1-(rating.errorResistance/150));
 const mistake=mistakeRng.next()<mistakeRisk;
 const mistakeLoss=mistake?(2+mistakeRng.next()*5):0;
 const paceRng=stream(state,'pace');
 const consistency=Math.max(0.35,(101-rating.driverConsistency)/50);
 const variation=normal(paceRng)*0.12*consistency;
 const startDelta=lapNumber===1?(50-rating.starts)*0.012+(50-carRating(rating.c,'traction',['race']))*0.006:0;
 const baseLap=circuit.baselineLap+carDelta+driverDelta+tyreDelta+fuelDelta+trafficSeconds+weatherDelta+damageDelta+mistakeLoss+punctureLoss+failureLoss+variation+startDelta;
 const controlDelta=state.raceControl==='safety_car'?circuit.baselineLap*0.22:0;
 const lapTime=Math.max(35,baseLap+controlDelta);
 const weights=[0.31,0.34,0.35];
 const sectors=[lapTime*weights[0],lapTime*weights[1],lapTime*weights[2]];
 sectors[2]=lapTime-sectors[0]-sectors[1];
 return {
  lapTime,sectors,fuelPerLap,tyreDegradation:degradation,tyreWearIncrease:degradation*100,retire,mechanicalEvent,puncture,
  mistake,damageIncrease:(mistake?0.03:0)+(puncture?0.015:0)+(mechanicalEvent==='suspension_failure'?0.08:mechanicalEvent==='mechanical_problem'?0.025:0),
  tyreHeat:clamp(0.08+circuit.tyreEnergy*0.18+(100-rating.tyreManagement)*0.0008,0,0.5)
 };
}
function choosePitCompound(car,weather,stintLaps,circuit){
 const options=weather.wetness>=0.42?['intermediate','wet']:['soft','medium','hard'];
 return options.map(compound=>{
  const tyre=TYRES[compound],mismatch=Math.abs(weather.wetness-(compound==='wet'?0.95:compound==='intermediate'?0.55:0.05));
  const driverCare=(car.ratings.tyreManagement-50)*0.004+(car.ratings.carTyrePreservation-50)*0.004;
  const degradation=tyre.degradation*(0.65+circuit.tyreEnergy*0.7)*(1-driverCare);
  return {compound,cost:stintLaps*(tyre.pace+tyre.warmup+mismatch*2.2)+Math.pow(stintLaps,2.16)*degradation*0.48};
 }).sort((a,b)=>a.cost-b.cost)[0]?.compound||'medium';
}
function automaticPitDecision(car,state,lapNumber,trafficSeconds){
 if(!car.automaticStrategy||car.manualPitMode||car.pitStops>=car.strategy.stops)return null;
 const lapsRemaining=state.totalLaps-lapNumber;
 if(lapsRemaining<=1)return null;
 const weather=state.weather;
 const requiredTyre=tyreForWeather(weather,car.tyre.compound);
 if(car.weatherPitNeeded||requiredTyre!==car.tyre.compound){
  return {reason:'weather',compound:choosePitCompound(car,weather,lapsRemaining,state.circuit)};
 }
 const wearRate=Math.max(car.tyre.degradationRate,TYRES[car.tyre.compound].degradation*100*state.circuit.wearMultiplier);
 const projectedWear=car.tyre.wear+wearRate*Math.min(lapsRemaining,3);
 const plannedWindow=lapNumber>=car.plannedStopLap;
 const critical=car.tyre.wear>=car.tyreConfig.wearCritical||projectedWear>=car.tyreConfig.wearDanger;
 const safetyCar=state.raceControl==='safety_car';
 const pitLoss=state.circuit.pitLaneLoss*(safetyCar?0.68:1)+3.6+Math.max(0,trafficSeconds)*0.45;
 const stayCost=(car.tyre.wear/100)**1.7*Math.min(lapsRemaining,12)*2.5+
  Math.max(0,projectedWear-car.tyreConfig.wearCritical)*0.14*Math.min(lapsRemaining,8);
 const newCompound=choosePitCompound(car,weather,Math.min(lapsRemaining,Math.max(3,car.plannedStopLap?state.totalLaps-car.plannedStopLap:8)),state.circuit);
 const compoundAdvantage=(TYRES[car.tyre.compound].pace-TYRES[newCompound].pace)*Math.min(lapsRemaining,8);
 const trafficRisk=trafficSeconds>0.6?1.12:1;
 const strategyStopWorthwhile=stayCost+compoundAdvantage>pitLoss*trafficRisk;
 if(car.stayOutDeferredLap&&lapNumber>=car.stayOutDeferredLap)
  return {reason:'stay_out_deferred',compound:car.strategy.compounds?.[car.pitStops+1]||newCompound};
 if(critical)return {reason:'tyre_wear',compound:newCompound};
 if(plannedWindow&&(strategyStopWorthwhile||trafficSeconds<=0.6))
  return {reason:safetyCar?'safety_car':'strategy',compound:car.strategy.compounds?.[car.pitStops+1]||newCompound};
 if(safetyCar&&stayCost+compoundAdvantage>pitLoss*0.75)return {reason:'safety_car',compound:newCompound};
 return null;
}
function pitDecision(car,state,lapNumber,trafficSeconds){
 if(car.retired||car.completed||car.pitState&&!car.pitState.complete)return null;
 if(car.weatherPitNeeded)return {reason:'emergency',compound:choosePitCompound(car,state.weather,Math.max(1,state.totalLaps-lapNumber),state.circuit)};
 if(car.pitInstruction?.mode==='pit'&&car.pitInstruction.targetLap<=lapNumber)
  return {reason:'manual',compound:car.pitInstruction.compound||car.pendingCompound};
 if(car.pitInstruction?.mode==='stay_out'&&car.pitInstruction.targetLap===lapNumber)return null;
 if(car.pitInstruction?.mode==='pit')return null;
 return automaticPitDecision(car,state,lapNumber,trafficSeconds);
}
function recordEvent(state,type,lap,car,details={}){
 const event={type,lap,driverId:car?.driverId??null,teamId:car?.teamId??null,...details};
 state.events.push(event);
 if(car)car.events.push(event);
}
function retireCar(state,car,lapNumber,reason){
 car.retired=true;car.retirementReason=reason;car.retirementLap=lapNumber;
 car.pitInstruction=null;car.pendingCompound=null;car.manualPitMode=false;car.stayOutDeferredLap=null;
 car.pitStatus='RETIRED';
 recordEvent(state,'retirement',lapNumber,car,{reason});
}
function attemptPasses(state,cars,lapNumber){
 if(state.raceControl==='safety_car')return;
 const rng=stream(state,'racecraft');
 for(let index=1;index<cars.length;index++){
  const order=[...cars].sort((a,b)=>a.position-b.position);
  const follower=order[index],leader=order[index-1];
  if(!follower||!leader||follower.retired||leader.retired||follower.lapsCompleted!==leader.lapsCompleted)continue;
  const previousGap=Math.max(0,follower.totalTime-leader.totalTime);
  if(previousGap>1.8)continue;
  const advantage=leader.lastLap-follower.lastLap;
  if(advantage<=0)continue;
  const rating=follower.ratings;
  const drs=state.circuit.drsZones>0&&previousGap<=1?Math.max(0,rating.drs-50)*0.0015+0.12:0;
  const chance=clamp(0.12+advantage*0.12+drs+(rating.overtaking-leader.ratings.defence)*0.002-state.circuit.overtakingDifficulty*0.1,0.03,0.78);
  if(rng.next()<chance){
   const currentGap=follower.totalTime-leader.totalTime;
   const gain=Math.max(0.05,currentGap+0.05);
   follower.totalTime-=gain;
   follower.position=index;
   leader.position=index+1;
   follower.lastLap=Math.max(35,follower.lastLap-gain);
   follower.bestLap=Math.min(follower.bestLap??follower.lastLap,follower.lastLap);
   if(follower.lastSectors?.length){follower.lastSectors=[...follower.lastSectors];follower.lastSectors[2]-=gain}
   const lastRecord=follower.lapHistory[follower.lapHistory.length-1];
   if(lastRecord){lastRecord.time=follower.lastLap;if(lastRecord.sectors?.length){lastRecord.sectors=[...lastRecord.sectors];lastRecord.sectors[2]-=gain}}
   recordEvent(state,'overtake',lapNumber,follower,{passedDriverId:leader.driverId,timeGain:gain});
  }else{
   const delay=0.15+rng.next()*0.45;
   follower.totalTime+=delay;
   follower.lastLap+=delay;
   if(follower.lastSectors?.length){follower.lastSectors=[...follower.lastSectors];follower.lastSectors[2]+=delay}
   const lastRecord=follower.lapHistory[follower.lapHistory.length-1];
   if(lastRecord){lastRecord.time+=delay;if(lastRecord.sectors?.length){lastRecord.sectors=[...lastRecord.sectors];lastRecord.sectors[2]+=delay}}
   recordEvent(state,'attack_defended',lapNumber,follower,{defendingDriverId:leader.driverId,timeLoss:delay});
  }
 }
}
export function setPitInstruction(previous,driverId,command,{compound,targetLap}={}){
 if(previous.done)throw new Error('Pit instructions cannot be changed after the chequered flag.');
 const index=previous.cars.findIndex(car=>String(car.driverId)===String(driverId));
 if(index<0)throw new Error('The selected driver is not in this race.');
 const selected=previous.cars[index];
 if(selected.retired||selected.completed)throw new Error('A retired or finished car cannot receive a pit instruction.');
 const cars=[...previous.cars],car={...selected};
 if(command==='auto'){
  car.automaticStrategy=true;car.manualPitMode=false;car.stayOutDeferredLap=null;car.pitInstruction=null;car.pendingCompound=null;car.pitStatus='AUTO';
 }else if(command==='stay_out'){
  car.automaticStrategy=true;car.manualPitMode=false;car.pendingCompound=null;
  car.pitInstruction={mode:'stay_out',targetLap:previous.lap+1};
  car.plannedStopLap=Math.max(car.plannedStopLap||0,previous.lap+2);
  car.stayOutDeferredLap=previous.lap+2;
  car.pitStatus='STAY OUT · AUTO RESUMES';
 }else if(command==='pit_this_lap'||command==='pit_next_lap'||command==='planned_stop'){
  const requested=command==='planned_stop'?Number(targetLap):previous.lap+(command==='pit_this_lap'?1:2);
  if(!Number.isInteger(requested)||requested<=previous.lap||requested>=previous.totalLaps)throw new Error('Choose a pit lap after the current lap and before the finish.');
  car.manualPitMode=true;car.stayOutDeferredLap=null;
  car.pitInstruction={mode:'pit',targetLap:requested,compound:TYRES[compound]?compound:undefined};
  car.pendingCompound=TYRES[compound]?compound:null;
  car.pitStatus=`PIT LAP ${requested} · ${car.pendingCompound?.toUpperCase()||car.tyre.compound.toUpperCase()}`;
 }else if(command==='set_compound'){
  if(!TYRES[compound])throw new Error('Choose a valid tyre compound.');
  car.pendingCompound=compound;
  car.pitStatus=`NEXT STOP · ${compound.toUpperCase()}`;
 }else if(command==='cancel'){
  car.pitInstruction=null;car.pendingCompound=null;car.manualPitMode=false;car.stayOutDeferredLap=null;car.pitStatus=car.automaticStrategy?'AUTO':'NO AUTO STOP';
 }else{
  throw new Error(`Unknown pit instruction: ${command}`);
 }
 cars[index]=car;
 return {...previous,cars};
}
function updateTyre(car,lapResult,weather){
 const compoundGrip=TYRES[car.tyre.compound]?.grip??1;
 car.tyre.age+=1;
 car.tyre.wear=clamp(car.tyre.wear+lapResult.tyreWearIncrease,0,100);
 car.tyre.condition=clamp(1-car.tyre.wear/100,0,1);
 car.tyre.grip=clamp(compoundGrip*(1-car.tyre.wear/120),0.12,1.08);
 car.tyre.temperature=clamp(car.tyre.temperature+lapResult.tyreHeat*10-weather.wetness*5,45,145);
 car.tyre.overheating=clamp((car.tyre.temperature-car.tyreConfig.overheatingThreshold)/40,0,1);
 car.tyre.graining=clamp(car.tyre.graining+(car.tyre.temperature>115?0.03:0)-0.005,0,1);
 car.tyre.degradationRate=lapResult.tyreWearIncrease;
 car.tyre.state=car.tyre.wear>=car.tyreConfig.wearDanger?'danger':car.tyre.wear>=car.tyreConfig.wearCritical?'critical':car.tyre.wear>=65?'worn':car.tyre.wear>=30?'used':'fresh';
 car.tyre.remainingCompetitiveLaps=car.tyre.degradationRate>0?Math.max(0,(car.tyreConfig.wearCritical-car.tyre.wear)/car.tyre.degradationRate):null;
}
function handlePit(car,state,lapNumber,teamStops,decision){
 const extra=teamStops.has(car.teamId)?2.5:0;
 const crew=car.ratings.pitCrewExecution,consistency=car.ratings.operationalConsistency;
 const service=clamp(2.4-(crew-50)*0.006+normal(stream(state,'mechanical'))*0.18*(1-(consistency-50)*0.005),1.6,4.2);
 const lane=state.circuit.pitLaneLoss*(state.raceControl==='safety_car'?0.68:1);
 const oldTyre={...car.tyre},oldCompound=car.tyre.compound;
 const plannedCompound=car.pendingCompound||car.pitInstruction?.compound||decision?.compound||car.strategy.compounds?.[car.pitStops+1]||'medium';
 const newCompound=tyreForWeather(state.weather,plannedCompound);
 const stages=[
  {phase:'pit_entry',seconds:1.2},
  {phase:'pit_lane',seconds:lane},
  {phase:'stationary_service',seconds:service+extra},
  {phase:'pit_exit',seconds:1.2}
 ];
 const pitState={phase:'pit_entry',progress:0,entryLap:lapNumber,complete:false,stages:[]};
 car.pitState=pitState;
 car.pitLaneProgress=0;
 car.lastPitReason=decision?.reason||'strategy';
 recordEvent(state,'pit_entry',lapNumber,car,{reason:car.lastPitReason});
 for(let index=0;index<stages.length;index++){
  const stage=stages[index];
  car.pitState={...car.pitState,phase:stage.phase,progress:(index+1)/stages.length};
  car.pitLaneProgress=stage.phase==='pit_lane'?(stage.seconds?1:0):stage.phase==='pit_entry'?0:stage.phase==='stationary_service'?0.5:1;
  car.totalTime+=stage.seconds;
  car.pitState.stages=[...car.pitState.stages,{phase:stage.phase,seconds:stage.seconds}];
  if(stage.phase==='stationary_service'){
   car.tyre=tyreState(newCompound);
   car.tyreConfig=state.tyreConfig;
  }
  recordEvent(state,stage.phase,lapNumber,car,{seconds:stage.seconds});
 }
 const loss=stages.reduce((sum,stage)=>sum+stage.seconds,0);
 car.pitStops+=1;
 car.pitHistory.push({lap:lapNumber,from:oldCompound,to:newCompound,timeLoss:loss,serviceTime:service,teamStackDelay:extra,stages:car.pitState.stages,wearAtStop:oldTyre.wear,damageAtStop:car.damage,fuelAtStop:car.fuelRemaining});
 car.weatherPitNeeded=false;
 car.pendingCompound=null;
 car.pitInstruction=null;
 car.manualPitMode=false;
 car.stayOutDeferredLap=null;
 car.pitStatus=`PIT EXIT · ${newCompound.toUpperCase()}`;
 car.lastPitLap=lapNumber;
 car.pitState={...car.pitState,phase:'pit_exit',progress:1,complete:true,compound:newCompound,totalTimeLoss:loss};
 if(car.automaticStrategy&&car.pitStops<car.strategy.stops){
  const remainingStops=car.strategy.stops-car.pitStops;
  car.plannedStopLap=lapNumber+Math.max(1,Math.round((state.totalLaps-lapNumber)/(remainingStops+1)));
 }
 teamStops.add(car.teamId);
 recordEvent(state,'pit_stop',lapNumber,car,{reason:car.lastPitReason,timeLoss:loss,compound:car.tyre.compound,wearAtStop:oldTyre.wear,damage:car.damage,fuel:car.fuelRemaining,teamStackDelay:extra});
}
export function advanceRaceLap(previous){
 if(previous.done)return previous;
 const state={
  ...previous,lap:previous.lap+1,events:[],randomStreams:{...previous.randomStreams},
  weather:{...previous.weather},cars:previous.cars.map(car=>({
   ...car,tyre:{...car.tyre},pitState:null,
   pitStatus:car.lastPitLap!==null&&car.lastPitLap<previous.lap+1&&car.pitStatus.startsWith('PIT EXIT')?'AUTO':car.pitStatus,
   pitLaneProgress:0,pitHistory:[...car.pitHistory],penalties:[...car.penalties],events:[...car.events],
   positionHistory:[...car.positionHistory],lapHistory:[...car.lapHistory]
  }))
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
  car.lastTrafficSeconds=traffic;
  const tyre=tyreForWeather(weather,car.tyre.compound);
  if(tyre!==car.tyre.compound){car.strategy={...car.strategy,tyre};car.weatherPitNeeded=true;recordEvent(state,'weather_tyre_change_required',lapNumber,car,{compound:tyre})}
  const lapResult=calculateLap(car,state,lapNumber,weather,traffic);
  car.lap=lapNumber;car.lapsCompleted+=1;car.lastLap=lapResult.lapTime;car.lastSectors=lapResult.sectors;
  car.bestLap=car.bestLap===null?lapResult.lapTime:Math.min(car.bestLap,lapResult.lapTime);
  car.totalTime+=lapResult.lapTime;car.fuelRemaining=Math.max(0,car.fuelRemaining-lapResult.fuelPerLap);
  car.damage=clamp(car.damage+lapResult.damageIncrease,0,1);
  car.vehicleStress=clamp(car.vehicleStress+car.damage*0.008+lapResult.tyreWearIncrease*0.00015,0,1);
  car.mileageKm+=state.circuit.lengthKm;
  updateTyre(car,lapResult,weather);
  car.lapHistory.push({lap:lapNumber,time:lapResult.lapTime,sectors:lapResult.sectors,tyre:car.tyre.compound,tyreAge:car.tyre.age,tyreWear:car.tyre.wear,tyreState:car.tyre.state,fuel:car.fuelRemaining});
  if(lapResult.mechanicalEvent){
   recordEvent(state,lapResult.mechanicalEvent,lapNumber,car);
   if(lapResult.retire)retireCar(state,car,lapNumber,lapResult.mechanicalEvent.replaceAll('_',' '));
   else car.mechanicalFault=lapResult.mechanicalEvent;
  }
  if(lapResult.puncture){recordEvent(state,'puncture',lapNumber,car,{wear:car.tyre.wear});car.weatherPitNeeded=true}
  if(lapResult.mistake){recordEvent(state,'driver_mistake',lapNumber,car,{timeLoss:lapResult.lapTime})}
  if(!car.retired&&car.damage>=0.98){
   recordEvent(state,'terminal_damage',lapNumber,car,{damage:car.damage});
   retireCar(state,car,lapNumber,'terminal damage');
  }
  if(car.pitInstruction?.mode==='stay_out'&&car.pitInstruction.targetLap<=lapNumber){car.pitInstruction=null;car.pitStatus='AUTO · STAYED OUT'}
  results.set(stableId(car.entry),lapResult);
 }
 const teamStops=new Set();
 for(const car of [...state.cars].sort((a,b)=>a.position-b.position)){
  const decision=pitDecision(car,state,lapNumber,car.lastTrafficSeconds||0);
  if(decision&&!car.retired){car.lastPitReason=decision.reason;handlePit(car,state,lapNumber,teamStops,decision)}
 }
 const incident=state.events.some(event=>['retirement','driver_mistake','mechanical_problem'].includes(event.type));
 const deployed=incident&&stream(state,'racecraft').next()<0.22;
 if(deployed){state.raceControl='safety_car';recordEvent(state,'safety_car',lapNumber,null,{cause:'track incident'})}
 else if(underSafetyCar){state.raceControl='green';recordEvent(state,'safety_car_ended',lapNumber,null)}
 attemptPasses(state,state.cars,lapNumber);
 const ranked=rankCars(state.cars);
 const leader=ranked.find(car=>!car.retired&&!car.completed);
 for(const car of ranked){
  if(!leader){
   if(car.retired&&car.retirementLap===state.lap){car.trackProgress=(car.lapsCompleted/state.totalLaps)%1;car.retiredProgress=car.trackProgress}
   continue;
  }
  if(car.retired){
   if(car.retirementLap===state.lap){
    const gap=Math.max(0,car.totalTime-leader.totalTime);
    const lapOffset=clamp(1-gap/state.circuit.baselineLap,0,0.999);
    car.trackProgress=((Math.max(0,car.lapsCompleted-1)+lapOffset)/state.totalLaps)%1;
   }
   car.retiredProgress=car.trackProgress;
   continue;
  }
  if(car.completed){car.trackProgress=0.999999;continue}
  const gap=Math.max(0,car.totalTime-leader.totalTime);
  const lapOffset=clamp(1-gap/state.circuit.baselineLap,0,0.999);
  car.trackProgress=((Math.max(0,car.lapsCompleted-1)+lapOffset)/state.totalLaps)%1;
 }
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
export function advanceRaceIfRunning(state,running){
 return running&&!state.done?advanceRaceLap(state):state;
}
export function getClassification(state){
 return rankCars(state.cars).map((car,index)=>({
  ...car.entry,position:index+1,pos:index+1,grid:car.gridPosition,gridPosition:car.gridPosition,
  dnf:car.retired,retired:car.retired,status:car.status,
  lapsCompleted:car.lapsCompleted,totalTime:car.totalTime,
  bestLap:car.bestLap,lastLap:car.lastLap,lastSectors:car.lastSectors,
  fuelRemaining:car.fuelRemaining,damage:car.damage,tyre:car.tyre,pitStops:car.pitStops,pitHistory:car.pitHistory,
  lapHistory:car.lapHistory,positionHistory:car.positionHistory,strategy:car.strategy,
  mechanicalFault:car.mechanicalFault,mileageKm:car.mileageKm,vehicleStress:car.vehicleStress,
  penalties:car.penalties,retirementLap:car.retirementLap,retirementReason:car.retirementReason,tyreConfig:car.tyreConfig,
  pitInstruction:car.pitInstruction,pitStatus:car.pitStatus,manualPitMode:car.manualPitMode,pitState:car.pitState,pitLaneProgress:car.pitLaneProgress,trackProgress:car.retired?(car.retiredProgress??car.trackProgress):car.trackProgress,
  pts:car.retired?0:Array.isArray(state.rules.points?.[state.format])?(state.rules.points[state.format][index]||0):selectPoints(index+1,state.format),
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
 const grandPrixGrid=raceData.sprint_affects_grand_prix_grid||raceData.sprintAffectsGrandPrixGrid?sprint:qualifying;
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
export function calculateStandings(completedRaces=[],entries=[]){
 const drivers=new Map(),teams=new Map();
 const makeStanding=(map,id,person,team)=>{
  const key=String(id??person?.name??'unknown');
  let standing=map.get(key);
  if(!standing){
   standing={id, name:person?.name||'Unknown',code:person?.code||'',team,points:0,wins:0,podiums:0};
   map.set(key,standing);
  }else{
   if(person?.code)standing.code=person.code;
   if(team)standing.team={...standing.team,...team};
  }
  return standing;
 };
 for(const entry of entries){
  makeStanding(drivers,entry.driver?.id,entry.driver,entry.team);
  makeStanding(teams,entry.team?.id,entry.team,null);
 }
 const races=[...completedRaces].sort((a,b)=>(Number(a.round)||0)-(Number(b.round)||0));
 for(const race of races){
  for(const [rows,isGrandPrix] of [[race.sprintResults||[],false],[race.raceResults||[],true]]){
   for(const row of rows){
    const position=Number(row.position??row.pos);
    const points=Number(row.points??row.pts)||0;
    const driver=makeStanding(drivers,row.driver?.id,row.driver,row.team);
    const team=makeStanding(teams,row.team?.id,row.team,null);
    driver.points+=points;team.points+=points;
    if(isGrandPrix&&position===1){driver.wins++;team.wins++}
    if(isGrandPrix&&position>0&&position<=3){driver.podiums++;team.podiums++}
   }
  }
 }
 const order=(a,b)=>b.points-a.points||b.wins-a.wins||b.podiums-a.podiums||a.name.localeCompare(b.name);
 return {drivers:[...drivers.values()].sort(order),teams:[...teams.values()].sort(order)};
}
