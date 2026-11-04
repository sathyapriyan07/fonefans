const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const wrap=value=>((value%1)+1)%1;
const validPoints=points=>Array.isArray(points)?points.filter(point=>
 Number.isFinite(Number(point?.x))&&Number.isFinite(Number(point?.y))
).map(point=>({x:clamp(Number(point.x),0,1),y:clamp(Number(point.y),0,1)})):[];

export function parseCircuitTrackPath(value){
 let source=value;
 if(typeof value==='string'){
  if(!value.trim())return emptyCircuitTrackPath();
  try{source=JSON.parse(value)}catch{return emptyCircuitTrackPath()}
 }
 if(!source||typeof source!=='object'||!Array.isArray(source.points))return emptyCircuitTrackPath();
 const points=validPoints(source.points);
 const index=value=>value!==null&&value!==undefined&&value!==''&&Number.isInteger(Number(value))&&Number(value)>=0&&Number(value)<points.length?Number(value):null;
 return {
  points,
  closed:source.closed===true,
  startFinishIndex:index(source.startFinishIndex),
  sectorMarks:[index(source.sectorMarks?.[0]),index(source.sectorMarks?.[1])],
  drsZones:Array.isArray(source.drsZones)?source.drsZones.filter(zone=>zone&&typeof zone==='object').map(zone=>({start:index(zone.start),end:index(zone.end)})):[],
  pitLanePoints:validPoints(source.pitLanePoints),
  direction:Number(source.direction)===-1?-1:1
 };
}

export function emptyCircuitTrackPath(){
 return {points:[],closed:false,startFinishIndex:null,sectorMarks:[null,null],drsZones:[],pitLanePoints:[],direction:1};
}

export function stringifyCircuitTrackPath(value){
 return JSON.stringify(parseCircuitTrackPath(value));
}

export function getDirectionalTrackPoints(points,startIndex=0,direction=1){
 if(!Array.isArray(points)||!points.length)return {points:[],indexMap:[]};
 const count=points.length;
 const origin=((Math.floor(Number(startIndex)||0)%count)+count)%count;
 const rotated=Array.from({length:count},(_,index)=>points[(origin+index)%count]);
 const ordered=Number(direction)===-1?[rotated[0],...rotated.slice(1).reverse()]:rotated;
 const indexMap=Array.from({length:count},(_,index)=>{
  const offset=(index-origin+count)%count;
  return Number(direction)===-1&&offset?count-offset:offset;
 });
 return {points:ordered,indexMap};
}

export function hasUsableTrackPath(trackMap){
 const points=validPoints(trackMap?.pathPoints??trackMap?.points);
 return trackMap?.closed!==false&&new Set(points.map(point=>`${point.x}:${point.y}`)).size>2;
}

function catmullRom(p0,p1,p2,p3,t){
 const t2=t*t,t3=t2*t;
 return {
  x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
  y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
 };
}
function interpolateSamples(samples,distance){
 let low=0,high=samples.length-1;
 while(low<high){
  const mid=Math.floor((low+high)/2);
  if(samples[mid].distance<distance)low=mid+1;
  else high=mid;
 }
 const next=samples[low],previous=samples[Math.max(0,low-1)];
 const span=next.distance-previous.distance;
 const amount=span>0?(distance-previous.distance)/span:0;
 return {x:previous.x+(next.x-previous.x)*amount,y:previous.y+(next.y-previous.y)*amount};
}

export function buildTrackPath(rawPoints,{closed=true,width=1,height=1,sampleCount=1000,startIndex=0}={}){
 const points=validPoints(rawPoints);
 const isClosed=Boolean(closed)&&points.length>2;
 if(isClosed&&points.length){
  const origin=((Math.floor(Number(startIndex)||0)%points.length)+points.length)%points.length;
  points.push(...points.splice(0,origin));
 }
 const dimensions={width:Math.max(Number(width)||1,Number.EPSILON),height:Math.max(Number(height)||1,Number.EPSILON)};
 const count=Math.max(2,Math.floor(sampleCount)||1000);
 if(points.length<2)return {samples:[],totalLength:0,closed:Boolean(closed),...dimensions};
 const segmentCount=isClosed?points.length:points.length-1;
 const source=[];
 const steps=Math.max(8,Math.ceil(count/segmentCount));
 for(let segment=0;segment<segmentCount;segment++){
  const p1=points[segment],p2=points[(segment+1)%points.length];
  const p0=isClosed?points[(segment-1+points.length)%points.length]:points[Math.max(0,segment-1)];
  const p3=isClosed?points[(segment+2)%points.length]:points[Math.min(points.length-1,segment+2)];
  for(let step=0;step<steps;step++)source.push(catmullRom(p0,p1,p2,p3,step/steps));
 }
 if(!isClosed)source.push({...points.at(-1)});
 const cumulative=[0];
 for(let index=1;index<source.length;index++){
  const dx=(source[index].x-source[index-1].x)*dimensions.width;
  const dy=(source[index].y-source[index-1].y)*dimensions.height;
  cumulative.push(cumulative[index-1]+Math.hypot(dx,dy));
 }
 let totalLength=cumulative[cumulative.length-1];
 if(isClosed){
  const dx=(source[0].x-source[source.length-1].x)*dimensions.width;
  const dy=(source[0].y-source[source.length-1].y)*dimensions.height;
  totalLength+=Math.hypot(dx,dy);
 }
 if(totalLength===0)return {samples:[],totalLength:0,closed:isClosed,...dimensions};
 const sampleTotal=count;
 const sourceSamples=source.map((point,index)=>({...point,distance:cumulative[index]}));
 const samples=Array.from({length:sampleTotal},(_,index)=>{
  const distance=totalLength*(isClosed?index/sampleTotal:index/(sampleTotal-1));
  if(distance<=cumulative[cumulative.length-1])return {...interpolateSamples(sourceSamples,distance),distance};
  const closingDistance=distance-cumulative[cumulative.length-1];
  const closingLength=totalLength-cumulative[cumulative.length-1];
  const amount=closingLength?closingDistance/closingLength:0;
  return {x:source.at(-1).x+(source[0].x-source.at(-1).x)*amount,y:source.at(-1).y+(source[0].y-source.at(-1).y)*amount,distance};
 });
 return {samples,totalLength,closed:isClosed,...dimensions};
}

export function getPointAt(path,progress){
 if(!path?.samples?.length||!(path.totalLength>0))return null;
 const position=path.closed?wrap(Number(progress)||0):clamp(Number(progress)||0,0,1);
 const pointAtDistance=distance=>{
  if(path.closed&&distance>=path.samples.at(-1).distance){
   const span=path.totalLength-path.samples.at(-1).distance;
   const amount=span?(distance-path.samples.at(-1).distance)/span:0;
   return {x:path.samples.at(-1).x+(path.samples[0].x-path.samples.at(-1).x)*amount,y:path.samples.at(-1).y+(path.samples[0].y-path.samples.at(-1).y)*amount};
  }
  return interpolateSamples(path.samples,clamp(distance,0,path.totalLength));
 };
 const distance=position*path.totalLength;
 const point=pointAtDistance(distance);
 const offset=path.totalLength*0.001;
 const before=pointAtDistance(path.closed?wrap((distance-offset)/path.totalLength)*path.totalLength:Math.max(0,distance-offset));
 const after=pointAtDistance(path.closed?wrap((distance+offset)/path.totalLength)*path.totalLength:Math.min(path.totalLength,distance+offset));
 const angle=before&&after?Math.atan2((after.y-before.y)*path.height,(after.x-before.x)*path.width):0;
 return {...point,angle};
}

export function getPitPointAt(trackMap,progress){
 const points=validPoints(trackMap?.pitLanePoints);
 if(points.length<2)return null;
 return getPointAt(buildTrackPath(points,{closed:false,width:trackMap.imageWidth,height:trackMap.imageHeight}),progress);
}

export function getTrackDisplayPoint(path,trackMap,progress,pitProgress=null,pitPath=null){
 if(Number.isFinite(pitProgress)&&pitProgress>=0&&pitProgress<1){
  const pitPoint=pitPath?getPointAt(pitPath,pitProgress):getPitPointAt(trackMap,pitProgress);
  if(pitPoint)return {...pitPoint,pit:true};
 }
 const point=getPointAt(path,progress);
 return point?{...point,pit:false}:null;
}

export function interpolateTrackProgress(from,to,elapsedMs,durationMs){
 const start=wrap(Number(from)||0),target=wrap(Number(to)||0);
 const forwardDistance=wrap(target-start);
 const amount=durationMs>0?clamp((Number(elapsedMs)||0)/durationMs,0,1):1;
 return wrap(start+forwardDistance*amount);
}

export function interpolateLapProgress(from,to,lapFraction=1){
 const start=wrap(Number(from)||0),target=wrap(Number(to)||0);
 let correction=target-start;
 if(correction>0.5)correction-=1;
 else if(correction< -0.5)correction+=1;
 const amount=clamp(Number(lapFraction)||0,0,1);
 return wrap(start+amount*(1+correction));
}

export function getProgressDistance(path,progress){
 if(!path?.totalLength)return 0;
 return wrap(Number(progress)||0)*path.totalLength;
}

export function getLapProgress(trackProgress,totalLaps,lap=1){
 const distanceScale=Number(lap)===0?1:Math.max(1,Number(totalLaps)||1);
 return wrap((Number(trackProgress)||0)*distanceScale);
}
