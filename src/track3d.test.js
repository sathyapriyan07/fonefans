import test from 'node:test';
import assert from 'node:assert/strict';
import {canRenderTrack3D,parseCircuitTrackPath,stringifyCircuitTrackPath,getPointAt} from './trackPath.js';
import {buildTrackRibbonGeometry,createTrack3DPath,getTrack3DPointAt} from './track3d.js';

const loop=[
 {x:0.15,y:0.2},{x:0.8,y:0.15},{x:0.88,y:0.72},{x:0.22,y:0.82},
 {x:0.12,y:0.62},{x:0.1,y:0.4},{x:0.3,y:0.18},{x:0.5,y:0.1}
];

test('3D ribbon is a closed constant-width mesh with two vertices per sample',()=>{
 const path=createTrack3DPath(loop,{imageWidth:1200,imageHeight:800,sampleCount:256});
 const geometry=buildTrackRibbonGeometry(path.worldSamples,8,true);
 const positions=geometry.getAttribute('position');
 assert.equal(path.samples.length,256);
 assert.equal(positions.count,512);
 assert.equal(geometry.index.count,256*6);
 const width=Math.hypot(
  positions.getX(0)-positions.getX(1),
  positions.getY(0)-positions.getY(1),
  positions.getZ(0)-positions.getZ(1)
 );
 assert.ok(Math.abs(width-8)<1e-5);
 geometry.dispose();
});

test('3D world position maps to the exact sampled 2D track point',()=>{
 const path=createTrack3DPath(loop,{imageWidth:1200,imageHeight:800,sampleCount:1000});
 for(const progress of [0,0.13,0.5,0.81,0.999]){
  const twoD=getPointAt(path,progress),threeD=getTrack3DPointAt(path,progress);
  assert.ok(twoD&&threeD);
  assert.ok(Math.abs(threeD.x-(twoD.x-0.5)*400)<1e-9);
  assert.ok(Math.abs(threeD.z-(0.5-twoD.y)*400*800/1200)<1e-9);
 }
});

test('optional elevation round-trips and does not change legacy points',()=>{
 const track={points:[{x:0.1,y:0.2,z:5},{x:0.8,y:0.7}],closed:true};
 assert.deepEqual(parseCircuitTrackPath(stringifyCircuitTrackPath(track)).points,track.points);
 assert.deepEqual(parseCircuitTrackPath(JSON.stringify({points:[{x:0.1,y:0.2}],closed:true})).points,[{x:0.1,y:0.2}]);
});

test('3D render eligibility rejects short paths for the 2D fallback',()=>{
 assert.equal(canRenderTrack3D(loop,true),true);
 assert.equal(canRenderTrack3D(loop.slice(0,7),true),false);
 assert.equal(canRenderTrack3D(loop,false),false);
});
