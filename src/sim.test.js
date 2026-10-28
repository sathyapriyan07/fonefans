import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceRaceLap,createRaceState,getClassification,qualify,simulateRace} from './sim.js';

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
});

test('planned pit stops add time, change tyres, and are kept in history',()=>{
 const strategies={'team-1':{stops:1,tyre:'soft'},'team-2':{stops:0,tyre:'hard'}};
 let state=createRaceState({entries:[entry(1),entry(2)],race:circuit,seed:3,laps:4,strategies});
 while(state.lap<3)state=advanceRaceLap(state);
 const pitted=state.cars.find(car=>car.teamId==='team-1');
 const notPitted=state.cars.find(car=>car.teamId==='team-2');
 assert.equal(pitted.pitStops,1);
 assert.equal(pitted.pitHistory[0].to,'soft');
 assert.ok(pitted.totalTime>notPitted.totalTime||pitted.pitHistory[0].timeLoss>20);
 assert.equal(notPitted.pitStops,0);
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
