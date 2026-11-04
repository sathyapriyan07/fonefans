const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

export function createTrackMask(imageData,{luminanceThreshold=118,colorThreshold=205}={}){
 const {data,width,height}=imageData;
 const mask=new Uint8Array(width*height);
 for(let index=0,pixel=0;pixel<mask.length;pixel++,index+=4){
  const red=data[index],green=data[index+1],blue=data[index+2];
  const maximum=Math.max(red,green,blue),minimum=Math.min(red,green,blue);
  const luminance=0.2126*red+0.7152*green+0.0722*blue;
  const vivid=maximum-minimum>58&&luminance<colorThreshold;
  if(luminance<luminanceThreshold||vivid)mask[pixel]=1;
 }
 return mask;
}

function neighborsOf(index,width,height,mask){
 const x=index%width,y=Math.floor(index/width),neighbors=[];
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  if(!dx&&!dy)continue;
  const nx=x+dx,ny=y+dy;
  if(nx<0||nx>=width||ny<0||ny>=height)continue;
  const next=ny*width+nx;
  if(!mask[next])continue;
  if(dx&&dy&&(mask[y*width+nx]||mask[ny*width+x]))continue;
  neighbors.push(next);
 }
 return neighbors;
}

export function keepLargestComponent(mask,width,height,{minimumArea=12}={}){
 const visited=new Uint8Array(mask.length),largest=[];
 for(let start=0;start<mask.length;start++){
  if(!mask[start]||visited[start])continue;
  const component=[],queue=[start];visited[start]=1;
  for(let head=0;head<queue.length;head++){
   const current=queue[head];component.push(current);
   const x=current%width,y=Math.floor(current/width);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const nx=x+dx,ny=y+dy;
    if(nx<0||nx>=width||ny<0||ny>=height)continue;
    const next=ny*width+nx;
    if(mask[next]&&!visited[next]){visited[next]=1;queue.push(next)}
   }
  }
  if(component.length>largest.length)largest.splice(0,largest.length,...component);
 }
 if(largest.length<minimumArea)return new Uint8Array(mask.length);
 const result=new Uint8Array(mask.length);
 for(const pixel of largest)result[pixel]=1;
 return result;
}

export function thinZhangSuen(source,width,height){
 const pixels=new Uint8Array(source),neighbors=new Int32Array(8);
 let changed=true,iterations=0;
 while(changed&&iterations++<Math.max(width,height)){
  changed=false;
  for(let phase=0;phase<2;phase++){
   const remove=[];
   for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const index=y*width+x;
    if(!pixels[index])continue;
    neighbors[0]=pixels[index-width];
    neighbors[1]=pixels[index-width+1];
    neighbors[2]=pixels[index+1];
    neighbors[3]=pixels[index+width+1];
    neighbors[4]=pixels[index+width];
    neighbors[5]=pixels[index+width-1];
    neighbors[6]=pixels[index-1];
    neighbors[7]=pixels[index-width-1];
    const count=neighbors.reduce((sum,value)=>sum+value,0);
    if(count<2||count>6)continue;
    let transitions=0;
    for(let i=0;i<8;i++)if(!neighbors[i]&&neighbors[(i+1)%8])transitions++;
    if(transitions!==1)continue;
    const [n1,n2,n3,n4,n5,n6,n7,n8]=neighbors;
    if(phase===0?(n1*n3*n5!==0||n3*n5*n7!==0):(n1*n3*n7!==0||n1*n5*n7!==0))continue;
    remove.push(index);
   }
   if(remove.length){changed=true;for(const index of remove)pixels[index]=0}
  }
 }
 return pixels;
}

export function orderSkeletonLoop(skeleton,width,height){
 const occupied=[];
 for(let index=0;index<skeleton.length;index++)if(skeleton[index])occupied.push(index);
 if(occupied.length<8)return [];
 const degrees=new Map(occupied.map(index=>[index,neighborsOf(index,width,height,skeleton).length]));
 const queue=occupied.filter(index=>degrees.get(index)<=1),removed=new Uint8Array(skeleton.length);
 for(let head=0;head<queue.length;head++){
  const index=queue[head];if(removed[index])continue;removed[index]=1;
  for(const neighbor of neighborsOf(index,width,height,skeleton)){
   if(removed[neighbor])continue;
   const degree=degrees.get(neighbor)-1;degrees.set(neighbor,degree);
   if(degree<=1)queue.push(neighbor);
  }
 }
 const core=skeleton.slice();
 for(let index=0;index<core.length;index++)if(removed[index])core[index]=0;
 const candidates=[];
 for(let index=0;index<core.length;index++)if(core[index])candidates.push(index);
 if(candidates.length<8)return [];
 const start=candidates.reduce((best,index)=>{
  const x=index%width,y=Math.floor(index/width),bx=best%width,by=Math.floor(best/width);
  return y<by||y===by&&x<bx?index:best;
 },candidates[0]);
 let previous=-1,current=start;
 const ordered=[],seen=new Set();
 for(let step=0;step<=candidates.length+1;step++){
  if(seen.has(current))return current===start?ordered:[];
  seen.add(current);ordered.push({x:current%width,y:Math.floor(current/width)});
  const next=neighborsOf(current,width,height,core).filter(index=>index!==previous);
  if(!next.length)return [];
  let chosen=next[0];
  if(next.length>1&&previous!==-1){
   const px=previous%width-current%width,py=Math.floor(previous/width)-Math.floor(current/width);
   chosen=next.reduce((best,index)=>{
    const bx=best%width-current%width,by=Math.floor(best/width)-Math.floor(current/width);
    const x=index%width-current%width,y=Math.floor(index/width)-Math.floor(current/width);
    return px*x+py*y>px*bx+py*by?index:best;
   },chosen);
  }
  previous=current;current=chosen;
  if(current===start)return ordered;
 }
 return [];
}

function distanceToLine(point,start,end){
 const dx=end.x-start.x,dy=end.y-start.y;
 if(dx===0&&dy===0)return Math.hypot(point.x-start.x,point.y-start.y);
 const amount=clamp(((point.x-start.x)*dx+(point.y-start.y)*dy)/(dx*dx+dy*dy),0,1);
 return Math.hypot(point.x-(start.x+amount*dx),point.y-(start.y+amount*dy));
}

export function simplifyPolyline(points,tolerance){
 if(points.length<=2)return [...points];
 const keep=new Uint8Array(points.length);keep[0]=1;keep[points.length-1]=1;
 const stack=[[0,points.length-1]];
 while(stack.length){
  const [start,end]=stack.pop();let maximum=tolerance,index=-1;
  for(let current=start+1;current<end;current++){
   const distance=distanceToLine(points[current],points[start],points[end]);
   if(distance>maximum){maximum=distance;index=current}
  }
  if(index!==-1){keep[index]=1;stack.push([start,index],[index,end])}
 }
 return points.filter((_,index)=>keep[index]);
}

export function simplifyClosedLoop(points,targetCount=80){
 if(points.length<=targetCount)return [...points];
 let farthest=1,maximum=0;
 for(let index=1;index<points.length;index++){
  const distance=(points[index].x-points[0].x)**2+(points[index].y-points[0].y)**2;
  if(distance>maximum){maximum=distance;farthest=index}
 }
 const firstArc=points.slice(0,farthest+1);
 const secondArc=[...points.slice(farthest),points[0]];
 let low=0,high=Math.max(1,Math.hypot(points[0].x-points[farthest].x,points[0].y-points[farthest].y));
 let best=[...points];
 for(let iteration=0;iteration<20;iteration++){
  const tolerance=(low+high)/2;
  const candidate=[...simplifyPolyline(firstArc,tolerance),...simplifyPolyline(secondArc,tolerance).slice(1,-1)];
  if(candidate.length>targetCount){low=tolerance;best=candidate}
  else{high=tolerance;best=candidate}
 }
 return best;
}

export function normalizeTrackPoints(points,width,height){
 const maxX=Math.max(1,width-1),maxY=Math.max(1,height-1);
 return points.map(point=>({x:clamp(point.x/maxX,0,1),y:clamp(point.y/maxY,0,1)}));
}

function resampleClosedPolyline(points,count=80){
 if(points.length<2)return points;
 const cumulative=[0];
 for(let index=0;index<points.length;index++){
  const current=points[index],next=points[(index+1)%points.length];
  cumulative.push(cumulative.at(-1)+Math.hypot(next.x-current.x,next.y-current.y));
 }
 const total=cumulative.at(-1),result=[];
 if(!total)return points;
 for(let sample=0;sample<count;sample++){
  const distance=total*sample/count;
  let segment=0;
  while(segment<cumulative.length-2&&cumulative[segment+1]<distance)segment++;
  const start=points[segment],end=points[(segment+1)%points.length];
  const length=cumulative[segment+1]-cumulative[segment];
  const amount=length?(distance-cumulative[segment])/length:0;
  result.push({x:start.x+(end.x-start.x)*amount,y:start.y+(end.y-start.y)*amount});
 }
 return result;
}

export function autoTraceTrack(imageData){
 const {width,height}=imageData;
 if(width<8||height<8)throw new Error('The image is too small to trace.');
 const mask=createTrackMask(imageData);
 const largest=keepLargestComponent(mask,width,height);
 const skeleton=thinZhangSuen(largest,width,height);
 const loop=orderSkeletonLoop(skeleton,width,height);
 if(loop.length<8)throw new Error('No closed track outline was detected. Use manual tracing instead.');
 const simplified=simplifyClosedLoop(loop,80);
 if(simplified.length<3)throw new Error('The detected track is too small. Use manual tracing instead.');
 return normalizeTrackPoints(resampleClosedPolyline(simplified,80),width,height);
}
