import test from 'node:test';
import assert from 'node:assert/strict';
import {autoTraceTrack,createTrackMask,keepLargestComponent,normalizeTrackPoints,orderSkeletonLoop,thinZhangSuen} from './trackAutoTrace.js';
import {parseCircuitTrackPath,stringifyCircuitTrackPath} from './trackPath.js';

function raster(width,height,background=[255,255,255,255]){
 const data=new Uint8ClampedArray(width*height*4);
 for(let offset=0;offset<data.length;offset+=4)data.set(background,offset);
 return {data,width,height};
}

test('track mask captures dark track and colored sector strokes but excludes white background',()=>{
 const image=raster(8,8);
 image.data.set([30,30,30,255],(2*8+2)*4);
 image.data.set([225,190,20,255],(2*8+3)*4);
 image.data.set([255,255,255,255],(2*8+4)*4);
 const mask=createTrackMask(image);
 assert.equal(mask[2*8+2],1);
 assert.equal(mask[2*8+3],1);
 assert.equal(mask[2*8+4],0);
});

test('largest component removes small isolated image details',()=>{
 const mask=new Uint8Array(20*20);
 for(let y=4;y<14;y++)for(let x=5;x<15;x++)mask[y*20+x]=1;
 mask[0]=1;mask[19]=1;
 const largest=keepLargestComponent(mask,20,20,{minimumArea:4});
 assert.equal(largest.reduce((sum,value)=>sum+value,0),100);
 assert.equal(largest[0],0);
});

test('skeleton ordering follows a closed loop',()=>{
 const width=64,height=64,mask=new Uint8Array(width*height);
 for(let y=12;y<=52;y++)for(let x=12;x<=52;x++){
  if(x<=15||x>=49||y<=15||y>=49)mask[y*width+x]=1;
 }
 const skeleton=thinZhangSuen(mask,width,height);
 const loop=orderSkeletonLoop(skeleton,width,height);
 assert.ok(loop.length>=8);
 assert.ok(Math.hypot(loop[0].x-loop.at(-1).x,loop[0].y-loop.at(-1).y)<=2);
});

test('auto-trace produces a normalized closed-loop candidate from a dark track band',()=>{
 const image=raster(96,80);
 for(let y=10;y<=70;y++)for(let x=10;x<=86;x++){
  if(x<=15||x>=81||y<=15||y>=65)image.data.set([32,32,32,255],(y*96+x)*4);
 }
 const points=autoTraceTrack(image);
 assert.ok(points.length>=8&&points.length<=100);
 assert.ok(points.every(point=>point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1));
});

test('normalization maps traced image coordinates into the zero-to-one range',()=>{
 const points=normalizeTrackPoints([{x:0,y:0},{x:99,y:49},{x:150,y:-1}],100,50);
 assert.deepEqual(points,[{x:0,y:0},{x:1,y:1},{x:1,y:0}]);
});

test('circuit path JSON round-trips the editor data shape',()=>{
 const input={
  points:[{x:0.1,y:0.2},{x:0.8,y:0.75}],
  closed:true,startFinishIndex:0,sectorMarks:[1,0],
  drsZones:[{start:0,end:1}],pitLanePoints:[{x:0.2,y:0.3},{x:0.4,y:0.3}],direction:-1
 };
 const serialized=stringifyCircuitTrackPath(input);
 assert.deepEqual(JSON.parse(serialized),input);
 assert.deepEqual(parseCircuitTrackPath(serialized),input);
});
