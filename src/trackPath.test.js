import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrackPath,getDirectionalTrackPoints,getLapProgress,getPitPointAt,getPointAt,getTrackDisplayPoint,hasUsableTrackPath,interpolateLapProgress,interpolateTrackProgress} from './trackPath.js';

const points=[
 {x:0.15,y:0.2},{x:0.8,y:0.15},{x:0.88,y:0.72},{x:0.22,y:0.82}
];

test('track path wraps around and preserves the start-finish point',()=>{
 const path=buildTrackPath(points,{closed:true,width:1200,height:800});
 const start=getPointAt(path,0),wrapped=getPointAt(path,1);
 assert.ok(start&&wrapped);
 assert.ok(Math.hypot(start.x-points[0].x,start.y-points[0].y)<0.002);
 assert.ok(Math.hypot(start.x-wrapped.x,start.y-wrapped.y)<1e-8);
 assert.ok(Number.isFinite(start.angle));
});

test('selected start-finish marker becomes progress zero',()=>{
 const path=buildTrackPath(points,{closed:true,startIndex:2});
 const start=getPointAt(path,0);
 assert.ok(start);
 assert.ok(Math.hypot(start.x-points[2].x,start.y-points[2].y)<0.002);
});

test('direction reversal keeps start/finish fixed and preserves marker indices',()=>{
 const directional=getDirectionalTrackPoints(points,1,-1);
 assert.deepEqual(directional.points,[points[1],points[0],points[3],points[2]]);
 assert.equal(directional.points[directional.indexMap[2]],points[2]);
});

test('track path samples are evenly spaced along the smoothed line',()=>{
 const path=buildTrackPath(points,{closed:true,width:1200,height:800,sampleCount:1000});
 assert.equal(path.samples.length,1000);
 const distances=path.samples.map((sample,index)=>{
  const next=path.samples[(index+1)%path.samples.length];
  return Math.hypot((next.x-sample.x)*path.width,(next.y-sample.y)*path.height);
 });
 const average=distances.reduce((sum,distance)=>sum+distance,0)/distances.length;
 assert.ok(Math.max(...distances)-Math.min(...distances)<average*0.04);
});

test('pit path progresses from its entry point to its exit point',()=>{
 const trackMap={imageWidth:1200,imageHeight:800,pitLanePoints:[{x:0.2,y:0.3},{x:0.5,y:0.4},{x:0.8,y:0.3}]};
 const entry=getPitPointAt(trackMap,0),exit=getPitPointAt(trackMap,1);
 assert.ok(entry&&exit);
 assert.ok(Math.hypot(entry.x-0.2,entry.y-0.3)<0.002);
 assert.ok(Math.hypot(exit.x-0.8,exit.y-0.3)<0.002);
 assert.equal(getPitPointAt({},0.5),null);
});

test('pit-lane map position returns to the racing line after pit transit',()=>{
 const trackMap={imageWidth:1200,imageHeight:800,pitLanePoints:[{x:0.2,y:0.3},{x:0.5,y:0.4},{x:0.8,y:0.3}]};
 const path=buildTrackPath(points,{closed:true,width:1200,height:800});
 const atEntry=getTrackDisplayPoint(path,trackMap,0.4,0);
 const inLane=getTrackDisplayPoint(path,trackMap,0.4,0.5);
 const afterExit=getTrackDisplayPoint(path,trackMap,0.4,1);
 assert.equal(atEntry?.pit,true);
 assert.equal(inLane?.pit,true);
 assert.equal(afterExit?.pit,false);
 assert.ok(Math.abs(afterExit.x-getPointAt(path,0.4).x)<1e-8);
});

test('progress interpolation wraps forward and clamps at the lap boundary',()=>{
 assert.ok(interpolateTrackProgress(0.98,0.02,50,100)<0.0001);
 assert.ok(Math.abs(interpolateTrackProgress(0.98,0.02,100,100)-0.02)<1e-8);
});

test('lap interpolation crosses start-finish while advancing one complete lap',()=>{
 assert.ok(Math.abs(interpolateLapProgress(0.98,0.02,0.5)-0.5)<1e-8);
 assert.ok(Math.abs(interpolateLapProgress(0.98,0.02,1)-0.02)<1e-8);
 assert.ok(Math.abs(interpolateLapProgress(0.42,0.4,1)-0.4)<1e-8);
});

test('race progress converts to per-lap distance without spreading the starting grid',()=>{
 assert.ok(Math.abs(getLapProgress(0.018,50,0)-0.018)<1e-8);
 assert.ok(Math.abs(getLapProgress(0.0196,50,1)-0.98)<1e-8);
});

test('a circuit without a closed traced path uses the schematic fallback',()=>{
 assert.equal(hasUsableTrackPath(null),false);
 assert.equal(hasUsableTrackPath({pathPoints:points,closed:false}),false);
 assert.equal(hasUsableTrackPath({pathPoints:points,closed:true}),true);
 assert.equal(hasUsableTrackPath({points,closed:true}),true);
 assert.equal(hasUsableTrackPath({pathPoints:[points[0],points[0],points[1]],closed:true}),false);
});
