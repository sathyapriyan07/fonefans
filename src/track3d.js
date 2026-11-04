import {BufferGeometry,Float32BufferAttribute} from 'three';
import {buildTrackPath,getPointAt} from './trackPath.js';

export const TRACK_WORLD_WIDTH=400;
export const TRACK_RIBBON_WIDTH=8;
export const TRACK_3D_SAMPLE_COUNT=1000;

export function createTrack3DPath(points,{
 imageWidth=1200,imageHeight=800,worldWidth=TRACK_WORLD_WIDTH,sampleCount=TRACK_3D_SAMPLE_COUNT,closed=true
}={}){
 const sampledPath=buildTrackPath(points,{
  closed,width:imageWidth,height:imageHeight,sampleCount
 });
 const worldScale=worldWidth/Math.max(1,Number(imageWidth)||1200);
 return {
  points,
  ...sampledPath,
  worldWidth,
  worldScale,
  worldSamples:sampledPath.samples.map(point=>({
   x:(point.x-0.5)*worldWidth,
   y:(Number(point.z)||0)*worldScale,
   z:(0.5-point.y)*worldWidth*(Number(imageHeight)||800)/Math.max(1,Number(imageWidth)||1200),
   distance:point.distance
  }))
 };
}

export function getTrack3DPointAt(path,progress){
 const point=getPointAt(path,progress);
 if(!point)return null;
 return {
  x:(point.x-0.5)*path.worldWidth,
  y:(Number(point.z)||0)*path.worldScale,
  z:(0.5-point.y)*path.worldWidth*path.height/path.width,
  angle:point.angle
 };
}

export function buildTrackRibbonGeometry(worldSamples,width=TRACK_RIBBON_WIDTH,closed=true){
 const count=worldSamples.length;
 const geometry=new BufferGeometry();
 if(count<2)return geometry;
 const halfWidth=width/2,positions=new Float32Array(count*2*3),indices=[];
 for(let index=0;index<count;index++){
  const previous=worldSamples[closed?(index-1+count)%count:Math.max(0,index-1)];
  const next=worldSamples[closed?(index+1)%count:Math.min(count-1,index+1)];
  const dx=next.x-previous.x,dz=next.z-previous.z,length=Math.hypot(dx,dz)||1;
  const normalX=-dz/length,normalZ=dx/length;
  const point=worldSamples[index],offset=index*6;
  positions[offset]=point.x+normalX*halfWidth;
  positions[offset+1]=point.y;
  positions[offset+2]=point.z+normalZ*halfWidth;
  positions[offset+3]=point.x-normalX*halfWidth;
  positions[offset+4]=point.y;
  positions[offset+5]=point.z-normalZ*halfWidth;
  if(index<count-1||closed){
   const nextIndex=(index+1)%count,left=index*2,right=left+1,nextLeft=nextIndex*2,nextRight=nextLeft+1;
   indices.push(left,right,nextLeft,right,nextRight,nextLeft);
  }
 }
 geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
 geometry.setIndex(indices);
 geometry.computeVertexNormals();
 return geometry;
}
