import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceRaceIfRunning,advanceRaceLap,createRaceState,getClassification,qualify,setPitInstruction,simulateRace,TYRES} from './sim.js';

function entry(id,{driver={},car={}}={}){
 return {
  driver:{id,name:`Driver ${id}`,...driver},
  team:{id:`team-${id}`,name:`Team ${id}`},
  d:{speed:70,race:70,qualifying:70,experience:60,consistency:75,overtaking:60,defence:60,...driver},
  c:{speed:70,race:70,performance:70,qualifying:70,reliability:90,...car}
 };
}
const circuit={laps:8,circuit_length_km:5.1,straight_line_importance:0.6,overtaking_difficulty:0.35};

test('same seed and inputs reproduce the complete race state',()=>{
 const entries=[entry(1),entry(2,{driver:{speed:77}}),entry(3,{car:{speed:78}})];
 const a=simulateRace({entries,race:circuit,seed:124,strategies:{'team-1':{stops:1,tyre:'medium'}}});
 const b=simulateRace({entries,race:circuit,seed:124,strategies:{'team-1':{stops:1,tyre:'medium'}}});
 assert.deepEqual(a,b);
});

test('qualifying sets the starting grid and grid penalties move a driver back',()=>{
 const rows=qualify([entry(1),entry(2,{driver:{qualifying:100,speed:90}}),entry(3)],{seed:8,race:circuit,gridPenalties:{2:2}});
 assert.deepEqual(rows.map(row=>row.grid),[1,2,3]);
 assert.equal(rows.find(row=>row.driver.id===2).grid,3);
 assert.ok(rows.every(row=>Number.isFinite(row.bestLap)&&Math.abs(row.sectors.reduce((a,b)=>a+b,0)-row.bestLap)<1e-8));
});

test('lap advancement consumes fuel, ages tyres, and records sector timing',()=>{
 const state=createRaceState({entries:[entry(1),entry(2)],race:circuit,seed:2,laps:8});
 const startFuel=state.cars[0].fuelRemaining;
 const next=advanceRaceLap(state);
 assert.equal(next.lap,1);
 assert.ok(next.cars.every(car=>car.fuelRemaining<startFuel));
 assert.ok(next.cars.every(car=>car.tyre.age===1));
 assert.ok(next.cars.every(car=>Math.abs(car.lastSectors.reduce((a,b)=>a+b,0)-car.lastLap)<1e-8));
 assert.ok(next.cars.every(car=>car.tyre.wear>0&&car.tyre.grip<TYRES[car.tyre.compound].grip));
});

test('planned pit stops add time, change tyres, and are kept in history',()=>{
 const strategies={'team-1':{stops:1,tyre:'soft'},'team-2':{stops:0,tyre:'hard'}};
 let state=createRaceState({entries:[entry(1),entry(2)],race:circuit,seed:3,laps:4,strategies});
 while(state.lap<3)state=advanceRaceLap(state);
 const pitted=state.cars.find(car=>car.teamId==='team-1');
 const notPitted=state.cars.find(car=>car.teamId==='team-2');
 assert.equal(pitted.pitStops,1);
 assert.equal(pitted.pitHistory[0].from,'soft');
 assert.notEqual(pitted.pitHistory[0].to,'soft');
 assert.ok(pitted.totalTime>notPitted.totalTime||pitted.pitHistory[0].timeLoss>20);
 assert.equal(notPitted.pitStops,0);
 assert.deepEqual(pitted.pitHistory[0].stages.map(stage=>stage.phase),['pit_entry','pit_lane','stationary_service','pit_exit']);
 assert.equal(pitted.pitHistory[0].timeLoss,pitted.pitHistory[0].stages.reduce((sum,stage)=>sum+stage.seconds,0));
});

test('a significantly faster car generally sets a faster race time',()=>{
 const fast=entry(1,{driver:{speed:92,race:92,consistency:95},car:{speed:94,race:94,performance:94,qualifying:90}});
 const slow=entry(2,{driver:{speed:25,race:25,consistency:95},car:{speed:25,race:25,performance:25,qualifying:25}});
 fast.grid=1;slow.grid=2;
 const result=simulateRace({entries:[fast,slow],race:circuit,seed:19,laps:15,strategies:{'team-1':{stops:0},'team-2':{stops:0}}});
 assert.ok(result.state.cars.find(car=>car.driverId===1).totalTime<result.state.cars.find(car=>car.driverId===2).totalTime);
});

test('every car completes a full race with finite timing state',()=>{
 const entries=Array.from({length:20},(_,index)=>entry(index+1));
 const {state,classification}=simulateRace({entries,race:{...circuit,laps:12},seed:44});
 assert.equal(state.done,true);
 assert.equal(classification.length,20);
 assert.ok(classification.every(car=>Number.isFinite(car.totalTime)&&car.totalTime>=0));
 assert.ok(classification.every(car=>car.lapsCompleted<=state.totalLaps));
});

test('different seeds produce different but valid lap times',()=>{
 const entries=[entry(1),entry(2)];
 const a=simulateRace({entries,race:circuit,seed:10,laps:6}).classification;
 const b=simulateRace({entries,race:circuit,seed:11,laps:6}).classification;
 assert.notDeepEqual(a.map(car=>car.totalTime),b.map(car=>car.totalTime));
 assert.ok([...a,...b].every(car=>Number.isFinite(car.bestLap)));
});

test('classification and lap state remain stable when input order changes',()=>{
 const entries=[entry(1),entry(2),entry(3)];
 const a=simulateRace({entries,race:circuit,seed:91}).classification;
 const b=simulateRace({entries:[...entries].reverse(),race:circuit,seed:91}).classification;
 assert.deepEqual(a.map(car=>[car.driver.id,car.totalTime]),b.map(car=>[car.driver.id,car.totalTime]));
});

test('classification reports actual lap progress, retirement status, and points',()=>{
 let state=createRaceState({entries:[entry(1),entry(2)],race:{...circuit,laps:2},seed:15});
 while(!state.done)state=advanceRaceLap(state);
 const rows=getClassification(state);
 assert.ok(rows.every(row=>row.lapsCompleted===2||row.retired));
 assert.ok(rows.every(row=>row.retired?row.pts===0:Number.isInteger(row.pts)));
});

test('pit commands are per-driver and manual stops execute at their requested lap',()=>{
 let state=createRaceState({entries:[entry(1),entry(2)],race:{...circuit,laps:7},seed:24,laps:7,strategies:{'team-1':{stops:0},'team-2':{stops:0}}});
 state=setPitInstruction(state,1,'planned_stop',{targetLap:2,compound:'hard'});
 assert.equal(state.cars.find(car=>car.driverId===1).pitStatus,'PIT LAP 2 · HARD');
 assert.equal(state.cars.find(car=>car.driverId===2).pitInstruction,null);
 state=advanceRaceLap(state);
 assert.equal(state.cars.find(car=>car.driverId===1).pitStops,0);
 state=advanceRaceLap(state);
 const pitted=state.cars.find(car=>car.driverId===1);
 assert.equal(pitted.pitStops,1);
 assert.equal(pitted.pitHistory[0].lap,2);
 assert.equal(pitted.tyre.compound,'hard');
 assert.equal(state.cars.find(car=>car.driverId===2).pitStops,0);
});

test('a queued manual stop suppresses automatic stops until its target lap',()=>{
 let state=createRaceState({entries:[entry(1),entry(2)],race:{...circuit,laps:8},seed:26,laps:8,strategies:{'team-1':{stops:1,tyre:'medium'},'team-2':{stops:0}}});
 const car=state.cars.find(row=>row.driverId===1);
 car.plannedStopLap=2;
 state=setPitInstruction(state,1,'planned_stop',{targetLap:4,compound:'hard'});
 while(state.lap<3)state=advanceRaceLap(state);
 assert.equal(state.cars.find(row=>row.driverId===1).pitStops,0);
 state=advanceRaceLap(state);
 const pitted=state.cars.find(row=>row.driverId===1);
 assert.equal(pitted.pitHistory[0].lap,4);
 assert.equal(pitted.pitHistory[0].to,'hard');
 assert.equal(pitted.manualPitMode,false);
});

test('pit next lap is distinct from pit this lap and pending commands remain visible',()=>{
 let state=createRaceState({entries:[entry(1),entry(2)],race:{...circuit,laps:8},seed:27,laps:8,strategies:{'team-1':{stops:0},'team-2':{stops:0}}});
 state=setPitInstruction(state,1,'pit_next_lap',{compound:'soft'});
 assert.equal(state.cars.find(row=>row.driverId===1).pitInstruction.targetLap,2);
 assert.match(state.cars.find(row=>row.driverId===1).pitStatus,/PIT LAP 2/);
 state=advanceRaceLap(state);
 assert.equal(state.cars.find(row=>row.driverId===1).pitStops,0);
 state=advanceRaceLap(state);
 assert.equal(state.cars.find(row=>row.driverId===1).pitHistory[0].lap,2);
});

test('stay-out defers the planned stop by one lap and automatic strategy resumes',()=>{
 let state=createRaceState({entries:[entry(1),entry(2)],race:{...circuit,laps:8},seed:25,laps:8,strategies:{'team-1':{stops:1,tyre:'medium'},'team-2':{stops:0}}});
 while(state.lap<2)state=advanceRaceLap(state);
 state=setPitInstruction(state,1,'stay_out');
 assert.equal(state.cars.find(car=>car.driverId===1).pitStatus,'STAY OUT · AUTO RESUMES');
 state=advanceRaceLap(state);
 assert.equal(state.cars.find(car=>car.driverId===1).pitStops,0);
 state=advanceRaceLap(state);
 assert.equal(state.cars.find(car=>car.driverId===1).pitStops,1);
 assert.equal(state.cars.find(car=>car.driverId===1).automaticStrategy,true);
});

test('tyre changes reset tyre-only state while fuel and damage persist',()=>{
 let state=createRaceState({entries:[entry(1),entry(2)],race:{...circuit,laps:7},seed:31,laps:7,strategies:{'team-1':{stops:0},'team-2':{stops:0}}});
 const car=state.cars.find(row=>row.driverId===1);
 car.damage=0.2;
 state=setPitInstruction(state,1,'planned_stop',{targetLap:2,compound:'soft'});
 state=advanceRaceLap(state);
 const fuelBeforeStop=state.cars.find(row=>row.driverId===1).fuelRemaining;
 state=advanceRaceLap(state);
 const afterStop=state.cars.find(row=>row.driverId===1);
 assert.equal(afterStop.tyre.age,0);
 assert.equal(afterStop.tyre.wear,0);
 assert.equal(afterStop.tyre.compound,'soft');
 assert.ok(afterStop.fuelRemaining<fuelBeforeStop);
 assert.ok(afterStop.damage>=0.2);
 assert.equal(afterStop.pitHistory[0].damageAtStop,afterStop.damage);
});

test('tyre telemetry includes wear, grip, condition and competitive life',()=>{
 let state=createRaceState({entries:[entry(1),entry(2)],race:{...circuit,laps:6},seed:32,laps:6,strategies:{'team-1':{stops:0},'team-2':{stops:0}},tyreConfig:{wearMultiplier:2}});
 state=advanceRaceLap(state);
 const tyre=state.cars[0].tyre;
 assert.ok(tyre.wear>0&&tyre.wear<=100);
 assert.ok(tyre.grip>0&&tyre.grip<TYRES[tyre.compound].grip);
 assert.ok(tyre.condition>=0&&tyre.condition<1);
 assert.ok(tyre.remainingCompetitiveLaps>0);
 assert.ok(['fresh','used','worn','critical','danger'].includes(tyre.state));
});

test('punctures force a stop and record the worn tyre state',()=>{
 let state=createRaceState({entries:[entry(1),entry(2)],race:{...circuit,laps:7},seed:33,laps:7,strategies:{'team-1':{stops:0},'team-2':{stops:0}},tyreConfig:{punctureBasePerLap:1}});
 state=advanceRaceLap(state);
 const car=state.cars.find(row=>row.driverId===1);
 assert.ok(car.events.some(event=>event.type==='puncture'));
 assert.equal(car.pitStops,1);
 assert.equal(car.tyre.age,0);
});

test('double-stacked teammates incur a second-car delay and preserve tyre service phases',()=>{
 const first=entry(1),second=entry(2);
 first.team={id:'shared-team',name:'Shared Team'};second.team={id:'shared-team',name:'Shared Team'};
 let state=createRaceState({entries:[first,second],race:{...circuit,laps:7},seed:36,laps:7,strategies:{'shared-team':{stops:0}}});
 state=setPitInstruction(state,1,'pit_this_lap',{compound:'medium'});
 state=setPitInstruction(state,2,'pit_this_lap',{compound:'medium'});
 state=advanceRaceLap(state);
 const stops=state.cars.map(car=>car.pitHistory[0]);
 assert.ok(stops.every(Boolean));
 assert.deepEqual(stops.map(stop=>stop.teamStackDelay).sort(),[0,2.5]);
 assert.ok(stops.every(stop=>stop.stages.some(stage=>stage.phase==='stationary_service')));
});

test('all five compounds differ and tyre wear measurably slows repeated laps',()=>{
 assert.equal(new Set(Object.values(TYRES).map(tyre=>`${tyre.pace}:${tyre.degradation}:${tyre.warmup}:${tyre.grip}`)).size,5);
 const entries=[entry(1),entry(2)];
 let state=createRaceState({entries,race:{...circuit,laps:20},seed:37,laps:20,strategies:{'team-1':{stops:0,tyre:'soft'},'team-2':{stops:0,tyre:'hard'}}});
 const first=advanceRaceLap(state);
 for(let lap=0;lap<8;lap++)state=advanceRaceLap(state);
 const soft=state.cars.find(car=>car.driverId===1),hard=state.cars.find(car=>car.driverId===2);
 assert.ok(soft.tyre.wear>first.cars.find(car=>car.driverId===1).tyre.wear);
 assert.ok(soft.tyre.grip<first.cars.find(car=>car.driverId===1).tyre.grip);
 assert.ok(soft.lastLap>first.cars.find(car=>car.driverId===1).lastLap,'soft tyre lap time should worsen as the same set wears');
 assert.notEqual(soft.tyre.compound,hard.tyre.compound);
});

test('driver pit controls reject retired cars and classification preserves retirement data',()=>{
 const state=createRaceState({entries:[entry(1),entry(2)],race:circuit,seed:34});
 const retired={...state,cars:state.cars.map(car=>car.driverId===1?{...car,retired:true,retirementLap:3,retirementReason:'engine failure'}:car)};
 assert.throws(()=>setPitInstruction(retired,1,'pit_this_lap'),/retired or finished/);
 const classified=getClassification(retired).find(car=>car.driver.id===1);
 assert.equal(classified.retirementLap,3);
 assert.equal(classified.retirementReason,'engine failure');
 const afterRetirement=advanceRaceLap(retired);
 assert.equal(afterRetirement.cars.find(car=>car.driverId===1).lapsCompleted,retired.cars.find(car=>car.driverId===1).lapsCompleted);
 assert.ok(afterRetirement.events.every(event=>event.driverId!==1));
});

test('low reliability can cause a mechanical retirement with lap and reason',()=>{
 const entries=[entry(1,{car:{reliability:0}}),entry(2,{car:{reliability:100}})];
 let retiredCar=null,retirementState=null;
 for(let seed=1;seed<=30&&!retiredCar;seed++){
  let state=createRaceState({entries,race:{...circuit,laps:100},seed,laps:100});
  const unreliable=state.cars.find(car=>car.driverId===1);
  unreliable.vehicleStress=1;
  while(!state.done)state=advanceRaceLap(state);
  retiredCar=getClassification(state).find(car=>car.driver.id===1&&car.retired);
  if(retiredCar)retirementState=state;
 }
 assert.ok(retiredCar,'expected a seeded low-reliability run to retire mechanically');
 assert.ok(retiredCar.retirementLap>0);
 assert.ok(['engine failure','gearbox failure','electrical failure','hydraulic failure','brake failure','cooling failure','terminal damage'].includes(retiredCar.retirementReason));
 assert.ok(retiredCar.events.some(event=>event.type==='retirement'));
 const afterRetirement=advanceRaceLap(retirementState);
 assert.equal(afterRetirement.cars.find(car=>car.driverId===1).lapsCompleted,retiredCar.lapsCompleted);
});

test('track progress stays normalized and custom circuit geometry is retained',()=>{
 const customCircuit={...circuit,circuit_path:'M 10 10 L 90 90'};
 let state=createRaceState({entries:[entry(1),entry(2,{driver:{speed:10,race:10}})],race:customCircuit,seed:35,laps:8});
 state=advanceRaceLap(state);
 assert.equal(state.circuit.trackPath,customCircuit.circuit_path);
 assert.ok(state.cars.every(car=>car.trackProgress>=0&&car.trackProgress<1));
 assert.notEqual(state.cars[0].trackProgress,state.cars[1].trackProgress);
});

test('overtaking can change the running order and records a real pass event',()=>{
 const entries=[entry(1,{driver:{speed:10,race:10,overtaking:10,consistency:90}}),entry(2,{driver:{speed:100,race:100,overtaking:100,consistency:90},car:{speed:100,race:100,performance:100}})];
 let passed=false;
 for(let seed=1;seed<=25&&!passed;seed++){
  let state=createRaceState({entries,race:{...circuit,laps:5,overtaking_difficulty:0},seed,laps:5,strategies:{'team-1':{stops:0},'team-2':{stops:0}}});
  const leader=state.cars.find(car=>car.driverId===1),follower=state.cars.find(car=>car.driverId===2);
  leader.lapsCompleted=1;follower.lapsCompleted=1;leader.position=1;follower.position=2;
  leader.totalTime=100;follower.totalTime=100.2;leader.lastLap=100;follower.lastLap=85;
  state=advanceRaceLap(state);
  passed=state.events.some(event=>event.type==='overtake'&&event.driverId===2);
  if(passed){
   assert.ok(state.cars.find(car=>car.driverId===2).position<state.cars.find(car=>car.driverId===1).position);
   assert.ok(state.events.find(event=>event.type==='overtake').timeGain>0);
  }
 }
 assert.ok(passed,'a seeded, faster following car should eventually complete a pass');
});

test('pause blocks lap advancement, resume advances once, and same-seed reset is reproducible',()=>{
 const options={entries:[entry(1),entry(2)],race:{...circuit,laps:5},seed:38,laps:5};
 const initial=createRaceState(options);
 assert.equal(advanceRaceIfRunning(initial,false),initial);
 const resumed=advanceRaceIfRunning(initial,true);
 assert.equal(resumed.lap,1);
 assert.deepEqual(createRaceState(options),initial);
 assert.equal(advanceRaceIfRunning(resumed,false),resumed);
});
