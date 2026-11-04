import {Suspense,lazy,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {buildTrackPath,canRenderTrack3D,getDirectionalTrackPoints,getPointAt,hasUsableTrackPath,parseCircuitTrackPath} from './trackPath.js';
import {useCarProgress} from './useCarProgress.js';

const LazyLiveTrack3D=lazy(()=>import('./LiveTrack3D.jsx'));

const FALLBACK_POINTS=[
 {x:22/180,y:72/110},{x:33/180,y:32/110},{x:68/180,y:20/110},{x:92/180,y:35/110},
 {x:127/180,y:21/110},{x:155/180,y:38/110},{x:148/180,y:66/110},{x:164/180,y:82/110},
 {x:133/180,y:94/110},{x:105/180,y:81/110},{x:77/180,y:94/110},{x:49/180,y:81/110}
];
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const wrap=value=>((value%1)+1)%1;
function browserHasWebGL(){
 if(typeof document==='undefined')return false;
 try{
  const canvas=document.createElement('canvas');
  return Boolean(canvas.getContext('webgl2')||canvas.getContext('webgl')||canvas.getContext('experimental-webgl'));
 }catch{return false}
}
const pointProgress=(path,points,index)=>{
 if(!Number.isInteger(Number(index))||Number(index)<0||Number(index)>=points.length)return null;
 const target=points?.[index];
 if(!target||!path.samples.length)return null;
 let nearest=0,best=Infinity;
 path.samples.forEach((point,sampleIndex)=>{
  const distance=((point.x-target.x)*path.width)**2+((point.y-target.y)*path.height)**2;
  if(distance<best){best=distance;nearest=sampleIndex}
 });
 return nearest/path.samples.length;
};
const driverLabel=driver=>String(driver?.code||driver?.name||'???').replace(/[^a-z0-9]/gi,'').slice(0,3).toUpperCase().padEnd(3,'?');

export default function LiveTrackMap({state,race,selectedDriverId,onSelect,isRunning,speed=1,onTestMode,testModeFeedback}){
 const canvasRef=useRef(null),latestRef=useRef(null),displayedPointsRef=useRef(new Map()),trailRef=useRef([]);
 const [filter,setFilter]=useState('all');
 const [showSectors,setShowSectors]=useState(false),[showDrs,setShowDrs]=useState(false),[showTrail,setShowTrail]=useState(false),[showLeaderboard,setShowLeaderboard]=useState(true);
 const [viewMode,setViewMode]=useState('2d'),[graphicsQuality,setGraphicsQuality]=useState('high'),[showGroundImage,setShowGroundImage]=useState(false),[threeDFallbackMessage,setThreeDFallbackMessage]=useState('');
 const [imageSize,setImageSize]=useState({width:1200,height:800});
 const legacyMap=race?.track_map&&typeof race.track_map==='object'?race.track_map:{};
 const circuitPath=useMemo(()=>parseCircuitTrackPath(race?.circuit_path),[race?.circuit_path]);
 const useCircuitPath=typeof race?.circuit_path==='string'&&race.circuit_path.trim().startsWith('{');
 const sourcePoints=useCircuitPath?circuitPath.points:legacyMap.pathPoints||[];
 const sourceUsable=useCircuitPath?circuitPath.points.length>2:hasUsableTrackPath(legacyMap);
 const sourceStart=useCircuitPath?circuitPath.startFinishIndex:legacyMap.startFinishIndex;
 const direction=useCircuitPath?circuitPath.direction:legacyMap.drivingDirection==='counterclockwise'?-1:1;
 const directional=useMemo(()=>getDirectionalTrackPoints(sourcePoints,sourceStart??0,direction),[sourcePoints,sourceStart,direction]);
 const pathPoints=directional.points.length>2?directional.points:FALLBACK_POINTS;
 const traced=sourceUsable&&directional.points.length>2;
 const sectorMarks=useMemo(()=>useCircuitPath?{
  sector1:circuitPath.sectorMarks[0]===null?null:directional.indexMap[circuitPath.sectorMarks[0]],
  sector2:circuitPath.sectorMarks[1]===null?null:directional.indexMap[circuitPath.sectorMarks[1]]
 }:Object.fromEntries(Object.entries(legacyMap.sectorMarks||{}).map(([name,index])=>[name,Number.isInteger(index)?directional.indexMap[index]:null])),[useCircuitPath,circuitPath.sectorMarks,directional.indexMap,legacyMap.sectorMarks]);
 const drsZones=useMemo(()=>useCircuitPath?circuitPath.drsZones.map(zone=>({
  startIndex:zone.start===null?null:directional.indexMap[zone.start],
  endIndex:zone.end===null?null:directional.indexMap[zone.end]
 })): (legacyMap.drsZones||[]).map(zone=>({
  startIndex:Number.isInteger(zone.startIndex)?directional.indexMap[zone.startIndex]:null,
  endIndex:Number.isInteger(zone.endIndex)?directional.indexMap[zone.endIndex]:null
 })),[useCircuitPath,circuitPath.drsZones,directional.indexMap,legacyMap.drsZones]);
 const pitLanePoints=useMemo(()=>useCircuitPath?(direction===-1?[...circuitPath.pitLanePoints].reverse():circuitPath.pitLanePoints):legacyMap.pitLanePoints||[],[useCircuitPath,direction,circuitPath.pitLanePoints,legacyMap.pitLanePoints]);
 const trackMap={
  pathPoints,
  imageWidth:useCircuitPath?imageSize.width:Number(legacyMap.imageWidth)||imageSize.width,
  imageHeight:useCircuitPath?imageSize.height:Number(legacyMap.imageHeight)||imageSize.height,
  startFinishIndex:0,
  sectorMarks,drsZones,pitLanePoints,
  trackImageUrl:race?.circuit_image_url||legacyMap.trackImageUrl||''
 };
 const width=traced?Math.max(1,Number(trackMap.imageWidth)||1200):180;
 const height=traced?Math.max(1,Number(trackMap.imageHeight)||110):110;
 const path=useMemo(()=>buildTrackPath(pathPoints,{closed:true,width,height,sampleCount:1000}),[pathPoints,width,height,traced]);
 const pitPath=useMemo(()=>buildTrackPath(trackMap.pitLanePoints,{closed:false,width,height,sampleCount:200}),[trackMap.pitLanePoints,width,height]);
 const sampleCars=useCarProgress({state,isRunning,speed,path,trackMap,pitPath});
 const markers=useMemo(()=>{
  if(!traced)return {};
  const sectors=Object.entries(trackMap.sectorMarks||{}).map(([name,index])=>[name,pointProgress(path,pathPoints,index)]).filter(([,progress])=>Number.isFinite(progress));
  const drs=(trackMap.drsZones||[]).map(zone=>({
   start:pointProgress(path,pathPoints,zone.startIndex),end:pointProgress(path,pathPoints,zone.endIndex)
  })).filter(zone=>zone.start!==null&&zone.end!==null);
  return {
   sectors,
   drs,
   startFinish:trackMap.startFinishIndex===null||trackMap.startFinishIndex===undefined?null:pointProgress(path,pathPoints,trackMap.startFinishIndex),
   pitEntry:null,
   pitExit:null
  };
 },[traced,trackMap.sectorMarks,trackMap.drsZones,trackMap.startFinishIndex,path,pathPoints]);
 latestRef.current={state,trackMap,traced,width,height,path,pitPath,markers,selectedDriverId,isRunning,speed,filter,showSectors,showDrs,showTrail,showLeaderboard,sampleCars};
 useEffect(()=>{
  const canvas=canvasRef.current;
  if(!canvas)return;
  const context=canvas.getContext('2d');
  if(!context)return;
  let animationId=0;
  const resizeObserver=new ResizeObserver(()=>{canvas.width=Math.max(1,canvas.clientWidth*window.devicePixelRatio);canvas.height=Math.max(1,canvas.clientHeight*window.devicePixelRatio)});
  resizeObserver.observe(canvas);
  const frame=now=>{
   const current=latestRef.current;
   if(!current)return;
   const currentState=current.state;
   const cssWidth=canvas.clientWidth,cssHeight=canvas.clientHeight;
   const pixelRatio=window.devicePixelRatio||1;
   if(canvas.width!==Math.round(cssWidth*pixelRatio)||canvas.height!==Math.round(cssHeight*pixelRatio)){
    canvas.width=Math.max(1,Math.round(cssWidth*pixelRatio));canvas.height=Math.max(1,Math.round(cssHeight*pixelRatio));
   }
   context.setTransform(pixelRatio,0,0,pixelRatio,0,0);
   context.clearRect(0,0,cssWidth,cssHeight);
   const center=(x,y)=>({x:x*cssWidth,y:y*cssHeight});
   const coordinates=sample=>center(sample.x,sample.y);
   const samples=current.path.samples;
   if(current.traced){
    context.strokeStyle='rgba(25,31,37,.62)';context.lineWidth=Math.max(10,Math.min(cssWidth,cssHeight)*0.032);context.lineCap='round';context.lineJoin='round';
    context.beginPath();samples.forEach((sample,index)=>{const point=coordinates(sample);if(index===0)context.moveTo(point.x,point.y);else context.lineTo(point.x,point.y)});context.closePath();context.stroke();
    context.strokeStyle='rgba(255,255,255,.92)';context.lineWidth=Math.max(3,Math.min(cssWidth,cssHeight)*0.01);context.stroke();
    if(current.showSectors){
     const bounds=current.markers.sectors.map(([,progress])=>progress).sort((a,b)=>a-b);
     const colors=['#8b4ddd','#38a56a','#e8b52f'];
     samples.forEach((sample,index)=>{
      const progress=index/samples.length;
      const sector=bounds.filter(bound=>progress>=bound).length%3;
      const next=coordinates(samples[(index+1)%samples.length]),point=coordinates(sample);
      context.strokeStyle=colors[sector];context.lineWidth=Math.max(2,Math.min(cssWidth,cssHeight)*0.009);
      context.beginPath();context.moveTo(point.x,point.y);context.lineTo(next.x,next.y);context.stroke();
     });
    }
    if(current.showDrs){
     for(const zone of current.markers.drs){
      samples.forEach((sample,index)=>{
       const progress=index/samples.length;
       const active=zone.start<=zone.end?progress>=zone.start&&progress<=zone.end:progress>=zone.start||progress<=zone.end;
       if(!active)return;
       const next=coordinates(samples[(index+1)%samples.length]),point=coordinates(sample);
       context.strokeStyle='#1687e8';context.lineWidth=Math.max(2,Math.min(cssWidth,cssHeight)*0.013);
       context.beginPath();context.moveTo(point.x,point.y);context.lineTo(next.x,next.y);context.stroke();
      });
     }
    }
    const drawMarker=(progress,color,label)=>{
     if(!Number.isFinite(progress))return;
     const point=getPointAt(current.path,progress),at=coordinates(point),length=Math.min(cssWidth,cssHeight)*0.04;
     context.save();context.translate(at.x,at.y);context.rotate(point.angle+Math.PI/2);
     context.strokeStyle=color;context.lineWidth=3;context.beginPath();context.moveTo(0,-length);context.lineTo(0,length);context.stroke();context.restore();
     context.fillStyle=color;context.font='bold 10px sans-serif';context.fillText(label,at.x+5,at.y-6);
    };
    if(Number.isFinite(current.markers.startFinish))drawMarker(current.markers.startFinish,'#ec3444','S/F');
    if(Number.isFinite(current.markers.pitEntry))drawMarker(current.markers.pitEntry,'#168b62','IN');
    if(Number.isFinite(current.markers.pitExit))drawMarker(current.markers.pitExit,'#168b62','OUT');
    if(current.showSectors){
     current.markers.sectors.forEach(([name,progress])=>drawMarker(progress,'#8b4ddd',name.replace('sector','S')));
    }
    if(current.pitPath.samples.length>1){
     context.strokeStyle='rgba(20,139,92,.9)';context.lineWidth=Math.max(2,Math.min(cssWidth,cssHeight)*0.008);
     context.setLineDash([6,5]);context.beginPath();current.pitPath.samples.forEach((sample,index)=>{
      const point=coordinates(sample);if(index===0)context.moveTo(point.x,point.y);else context.lineTo(point.x,point.y);
     });context.stroke();context.setLineDash([]);
      const pitEntry=coordinates(current.pitPath.samples[0]),pitExit=coordinates(current.pitPath.samples.at(-1));
      context.fillStyle='#168b62';context.font='bold 9px sans-serif';context.fillText('PIT IN',pitEntry.x+4,pitEntry.y-4);context.fillText('PIT OUT',pitExit.x+4,pitExit.y-4);
    }
   }else if(!current.traced){
    if(current.state.circuit.trackPath&&typeof Path2D==='function'){
     try{
      context.save();context.scale(cssWidth/180,cssHeight/110);
      context.strokeStyle='#30363b';context.lineWidth=6;context.lineJoin='round';context.lineCap='round';context.stroke(new Path2D(current.state.circuit.trackPath));context.restore();
     }catch(error){console.error('Could not render the schematic track path:',error)}
    }else{
     context.strokeStyle='#30363b';context.lineWidth=Math.max(4,Math.min(cssWidth,cssHeight)*0.055);context.lineJoin='round';context.lineCap='round';
     context.beginPath();FALLBACK_POINTS.forEach((point,index)=>{const at=coordinates(point);if(index===0)context.moveTo(at.x,at.y);else context.lineTo(at.x,at.y)});context.closePath();context.stroke();
    }
    context.fillStyle='#777';context.font='bold 10px sans-serif';context.fillText('SCHEMATIC FALLBACK',8,16);
   }
   const activeCars=currentState.cars.filter(car=>!car.retired);
   const raceControl=['safety_car','vsc'].includes(currentState.raceControl);
   const leader=activeCars.find(car=>car.position===1)||activeCars[0];
   const candidates=current.sampleCars(now);
   const leaderProgress=candidates.find(item=>item.car===leader)?.progress??0;
   const visible=candidates.filter(item=>item.car.retired
    ?current.filter==='retired'
    :current.filter!=='retired');
   const points=visible.filter(item=>item.point).map(item=>({...item,...coordinates(item.point)}));
   points.forEach((item,index)=>{
    const neighbors=points.filter(other=>other!==item&&Math.hypot(other.x-item.x,other.y-item.y)<Math.min(cssWidth,cssHeight)*0.045);
    if(neighbors.length){
     const offset=(index%2?1:-1)*Math.min(neighbors.length,3)*Math.min(cssWidth,cssHeight)*0.012;
     item.x+=Math.cos(item.point.angle+Math.PI/2)*offset;
     item.y+=Math.sin(item.point.angle+Math.PI/2)*offset;
    }
   });
   const leaderPoint=points.find(item=>item.car.position===1&&!item.car.retired);
   if(current.showTrail&&leaderPoint){
    trailRef.current.push({x:leaderPoint.x,y:leaderPoint.y});
    trailRef.current=trailRef.current.slice(-24);
    context.strokeStyle='rgba(226,38,54,.36)';context.lineWidth=3;context.beginPath();
    trailRef.current.forEach((point,index)=>{if(index===0)context.moveTo(point.x,point.y);else context.lineTo(point.x,point.y)});context.stroke();
   }else if(!current.showTrail)trailRef.current=[];
   if(raceControl&&leaderPoint){
    const marker=getPointAt(current.path,wrap(leaderProgress-0.018)),point=coordinates(marker);
    context.fillStyle='#f0c431';context.strokeStyle='#262626';context.lineWidth=2;context.beginPath();context.arc(point.x,point.y,10,0,Math.PI*2);context.fill();context.stroke();
    context.fillStyle='#171717';context.font='bold 9px sans-serif';context.textAlign='center';context.fillText('SC',point.x,point.y+3);context.textAlign='start';
   }
   const displayedPoints=new Map();
   for(const item of points){
    const car=item.car,selected=String(car.driverId)===String(current.selectedDriverId);
    displayedPoints.set(item.id,{id:item.id,x:item.x,y:item.y,progress:item.progress});
    context.globalAlpha=car.retired?0.48:1;
    context.fillStyle=car.retired?'#777':car.entry.team?.color||'#d3202f';
    context.strokeStyle=selected?'#ffe354':'#fff';context.lineWidth=selected?3:1.5;
    context.beginPath();context.arc(item.x,item.y,selected?7:5,0,Math.PI*2);context.fill();context.stroke();
    context.globalAlpha=1;
    context.fillStyle='#171717';context.font='bold 9px sans-serif';context.textAlign='center';context.fillText(driverLabel(car.entry.driver),item.x,item.y-8);
    if(item.pit){context.fillStyle='#168b62';context.font='bold 8px sans-serif';context.fillText('PIT',item.x,item.y+16)}
   }
   displayedPointsRef.current=displayedPoints;
   if(current.showLeaderboard){
    context.fillStyle='rgba(18,21,24,.82)';context.fillRect(cssWidth-138,8,130,Math.min(104,activeCars.length*18+10));
    activeCars.sort((a,b)=>a.position-b.position).slice(0,5).forEach((car,index)=>{
     context.fillStyle=car.entry.team?.color||'#d3202f';context.fillRect(cssWidth-130,15+index*18,4,12);
     context.fillStyle='#fff';context.font='bold 10px sans-serif';context.textAlign='start';context.fillText(`${car.position}. ${driverLabel(car.entry.driver)}`,cssWidth-120,25+index*18);
    });
   }
   animationId=requestAnimationFrame(frame);
  };
  animationId=requestAnimationFrame(frame);
  return ()=>{cancelAnimationFrame(animationId);resizeObserver.disconnect()};
 },[path,pitPath,width,height,traced]);
 const safetyCar=['safety_car','vsc'].includes(state.raceControl);
 const topFive=[...state.cars].filter(car=>!car.retired).sort((a,b)=>a.position-b.position).slice(0,5);
 const canUse3D=canRenderTrack3D(sourcePoints,useCircuitPath?circuitPath.closed:legacyMap.closed!==false);
 const activate3D=()=>{
  if(!canUse3D){setThreeDFallbackMessage('3D requires a saved closed track path with at least 8 points. Showing the 2D map.');setViewMode('2d');return}
  if(!browserHasWebGL()){setThreeDFallbackMessage('WebGL is unavailable in this browser. Showing the 2D map.');setViewMode('2d');return}
  setThreeDFallbackMessage('');setViewMode('3d');
 };
 const returnTo2D=()=>{setViewMode('2d');setThreeDFallbackMessage('')};
 const handle3DFallback=useCallback(reason=>{setThreeDFallbackMessage(reason);setViewMode('2d')},[]);
 const pickDriver=event=>{
  const canvas=canvasRef.current,rect=canvas?.getBoundingClientRect();
  if(!rect)return;
  const x=event.clientX-rect.left,y=event.clientY-rect.top;
  let nearest=null,distance=18;
  for(const [id,point] of displayedPointsRef.current){
   const delta=Math.hypot(point.x-x,point.y-y);
   if(delta<distance){nearest=state.cars.find(car=>String(car.driverId)===id)?.driverId??null;distance=delta}
  }
  if(nearest!==null)onSelect(nearest);
 };
 return <section className="live-track-panel">
  <div className="section-title"><div><h3>Live track</h3><p>{traced?race?.circuit||race?.name||'Uploaded track map':'Illustrative schematic — trace and save a circuit path in Admin to enable the map'}</p></div>
   <div className="track-header-controls">
    <div className="track-controls" role="group" aria-label="Track display mode"><button type="button" className={viewMode==='2d'?'active':''} onClick={returnTo2D}>2D</button><button type="button" className={viewMode==='3d'?'active':''} onClick={activate3D}>3D</button></div>
    <div className="track-controls" role="group" aria-label="Track marker filter">{[['all','All'],['active','Racing'],['retired','Retired']].map(([key,label])=><button type="button" key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</div>
   </div>
  </div>
  {threeDFallbackMessage&&<p className="track-3d-message" role="status">{threeDFallbackMessage}</p>}
  {viewMode==='2d'&&traced&&onTestMode&&<div className="track-test-mode"><button type="button" onClick={onTestMode}>Run full-race path test</button>{testModeFeedback&&<span role="status">{testModeFeedback}</span>}</div>}
  {safetyCar&&<div className="track-safety-banner" role="status">{state.raceControl==='vsc'?'VIRTUAL SAFETY CAR':'SAFETY CAR'} · GAPS COMPRESSED</div>}
  {viewMode==='3d'?<Suspense fallback={<div className="live-track-stage track-3d-loading" role="status">Loading 3D track…</div>}>
   <LazyLiveTrack3D
    state={state} race={race} selectedDriverId={selectedDriverId} onSelect={onSelect}
    isRunning={isRunning} speed={speed} filter={filter} showSectors={showSectors}
    showDrs={showDrs} showTrail={showTrail} showLeaderboard={showLeaderboard}
    showGroundImage={showGroundImage} graphicsQuality={graphicsQuality}
    imageWidth={imageSize.width} imageHeight={imageSize.height}
    onFallback={handle3DFallback}
   />
  </Suspense>:<div className="live-track-stage" style={{aspectRatio:`${width}/${height}`}}>
   {traced&&trackMap.trackImageUrl&&<img className="live-track-background" src={trackMap.trackImageUrl} alt={`${race?.name||'Race'} track map`} onLoad={event=>{const image=event.currentTarget;if(image.naturalWidth&&image.naturalHeight)setImageSize({width:image.naturalWidth,height:image.naturalHeight})}}/>}
   <canvas ref={canvasRef} className="live-track-canvas" aria-label="Animated live track. Select a driver from the leaderboard to open telemetry." onClick={pickDriver}/>
  </div>}
  {viewMode==='3d'&&<div className="track-3d-settings">
   <label>Graphics<select value={graphicsQuality} onChange={event=>setGraphicsQuality(event.target.value)}><option value="low">Low</option><option value="high">High</option></select></label>
   <label><input type="checkbox" checked={showGroundImage} onChange={event=>setShowGroundImage(event.target.checked)}/>Ground image</label>
  </div>}
  <div className="live-track-options">
   <label><input type="checkbox" checked={showSectors} onChange={event=>setShowSectors(event.target.checked)}/>Sectors</label>
   <label><input type="checkbox" checked={showDrs} onChange={event=>setShowDrs(event.target.checked)}/>DRS zones</label>
   <label><input type="checkbox" checked={showTrail} onChange={event=>setShowTrail(event.target.checked)}/>Leader trail</label>
   <label><input type="checkbox" checked={showLeaderboard} onChange={event=>setShowLeaderboard(event.target.checked)}/>Top 5</label>
  </div>
  <div className="track-top-five" aria-label="Top five drivers">{topFive.map(car=><button type="button" key={car.driverId} onClick={()=>onSelect(car.driverId)} className={String(selectedDriverId)===String(car.driverId)?'selected':''}>
   <span style={{'--team-color':car.entry.team?.color||'#d3202f'}}>{car.position}</span>{driverLabel(car.entry.driver)}
  </button>)}</div>
 </section>;
}
