import {Component,Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {Canvas,useFrame,useLoader} from '@react-three/fiber';
import {Billboard,Line,OrbitControls,Text} from '@react-three/drei';
import {BoxGeometry,DoubleSide,Line as ThreeLine,LineBasicMaterial,MathUtils,TextureLoader,Vector3} from 'three';
import {buildTrackPath,canRenderTrack3D,getDirectionalTrackPoints,parseCircuitTrackPath} from './trackPath.js';
import {buildTrackRibbonGeometry,createTrack3DPath,getTrack3DPointAt,TRACK_RIBBON_WIDTH} from './track3d.js';
import {useCarProgress} from './useCarProgress.js';

const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const wrap=value=>((value%1)+1)%1;
const labelFor=driver=>String(driver?.code||driver?.name||'???').replace(/[^a-z0-9]/gi,'').slice(0,3).toUpperCase().padEnd(3,'?');
const toWorld=(point,path)=>point?{
 x:(point.x-0.5)*path.worldWidth,
 y:(Number(point.z)||0)*path.worldScale,
 z:(0.5-point.y)*path.worldWidth*path.height/path.width
}:null;

function findProgress(path,points,index){
 if(!Number.isInteger(Number(index))||Number(index)<0||Number(index)>=points.length)return null;
 const target=points[index];
 let nearest=0,best=Infinity;
 path.samples.forEach((point,sampleIndex)=>{
  const distance=((point.x-target.x)*path.width)**2+((point.y-target.y)*path.height)**2;
  if(distance<best){best=distance;nearest=sampleIndex}
 });
 return nearest/path.samples.length;
}

function getColorSections(samples,boundaries){
 if(!samples.length)return [];
 const sorted=boundaries.filter(Number.isFinite).sort((a,b)=>a-b);
 const colors=['#9355d8','#31a86c','#e4b630'];
 const sections=[];
 let current=-1,points=[];
 samples.forEach((point,index)=>{
  const sector=sorted.filter(boundary=>index/samples.length>=boundary).length%3;
  if(current!==sector&&points.length>1)sections.push({color:colors[current],points});
  if(current!==sector){current=sector;points=[point]}else points.push(point);
 });
 if(points.length>1)sections.push({color:colors[current],points});
 return sections;
}

function getDrsSections(samples,zones){
 return zones.filter(zone=>Number.isFinite(zone.start)&&Number.isFinite(zone.end)).map(zone=>{
  const points=samples.filter((_,index)=>{
   const progress=index/samples.length;
   return zone.start<=zone.end?progress>=zone.start&&progress<=zone.end:progress>=zone.start||progress<=zone.end;
  });
  return points.length>1?points:null;
 }).filter(Boolean);
}

function SceneErrorBoundary({children,onFallback}){
 return <Boundary onFallback={onFallback}>{children}</Boundary>;
}
class Boundary extends Component{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 componentDidCatch(){
  this.props.onFallback('3D rendering could not start. Showing the 2D map.');
 }
 render(){return this.state.failed?null:this.props.children}
}

function GroundTexture({url,width,depth}){
 const texture=useLoader(TextureLoader,url);
 return <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.65,0]} receiveShadow>
  <planeGeometry args={[width,depth]}/>
  <meshBasicMaterial map={texture} transparent opacity={0.24} depthWrite={false}/>
 </mesh>;
}

function TrackSurface({path,pitPath,showSectors,showDrs,sectorMarks,drsZones}){
 const trackGeometry=useMemo(()=>buildTrackRibbonGeometry(path.worldSamples,TRACK_RIBBON_WIDTH,true),[path]);
 const pitGeometry=useMemo(()=>pitPath.worldSamples.length>1?buildTrackRibbonGeometry(pitPath.worldSamples,TRACK_RIBBON_WIDTH*0.68,false):null,[pitPath]);
 const edgeLines=useMemo(()=>[-1,1].map(side=>path.worldSamples.map((point,index)=>{
  const previous=path.worldSamples[(index-1+path.worldSamples.length)%path.worldSamples.length];
  const next=path.worldSamples[(index+1)%path.worldSamples.length];
  const dx=next.x-previous.x,dz=next.z-previous.z,length=Math.hypot(dx,dz)||1;
  return [point.x-side*dz/length*(TRACK_RIBBON_WIDTH/2-0.35),point.y+0.08,point.z+side*dx/length*(TRACK_RIBBON_WIDTH/2-0.35)];
 }),[path]);
 const sectors=useMemo(()=>getColorSections(path.worldSamples,sectorMarks),[path,sectorMarks]);
 const drs=useMemo(()=>getDrsSections(path.worldSamples,drsZones),[path,drsZones]);
 const start=getTrack3DPointAt(path,0);
 const curbs=useMemo(()=>path.points.map((point,index)=>{
  const before=path.points[(index-1+path.points.length)%path.points.length],after=path.points[(index+1)%path.points.length];
  const ax=(point.x-before.x)*path.width,ay=(point.y-before.y)*path.height;
  const bx=(after.x-point.x)*path.width,by=(after.y-point.y)*path.height;
  const lengths=Math.hypot(ax,ay)*Math.hypot(bx,by)||1;
  const bend=Math.acos(clamp((ax*bx+ay*by)/lengths,-1,1));
  if(bend<0.72)return null;
  const location=toWorld(point,path);
  return location?{...location,rotation:Math.atan2(bx,-by)}:null;
 }).filter(Boolean),[path]);
 useEffect(()=>()=>{trackGeometry.dispose();pitGeometry?.dispose()},[trackGeometry,pitGeometry]);
 return <>
  <mesh geometry={trackGeometry} receiveShadow castShadow dispose={null}>
   <meshStandardMaterial color="#33383b" roughness={0.94} side={DoubleSide}/>
  </mesh>
  {edgeLines.map((points,index)=><Line key={`edge-${index}`} points={[...points,points[0]]} color="#f4f4ef" lineWidth={2}/>)}
  {showSectors&&sectors.map((section,index)=><Line key={`sector-${index}`} points={section.points.map(point=>[point.x,point.y+0.14,point.z])} color={section.color} lineWidth={4}/>)}
  {showDrs&&drs.map((points,index)=><Line key={`drs-${index}`} points={points.map(point=>[point.x,point.y+0.19,point.z])} color="#1687e8" lineWidth={5}/>)}
  {pitGeometry&&<mesh geometry={pitGeometry} receiveShadow dispose={null}><meshStandardMaterial color="#44494b" roughness={0.9} side={DoubleSide}/></mesh>}
  {pitPath.worldSamples.length>1&&<>
   <Line points={pitPath.worldSamples.map(point=>[point.x,point.y+0.12,point.z])} color="#eae9d9" lineWidth={1.5}/>
   {[pitPath.worldSamples[0],pitPath.worldSamples.at(-1)].map((pitPoint,index)=><Line key={`pit-join-${index}`} points={[[pitPoint.x,pitPoint.y+0.13,pitPoint.z],[path.worldSamples[index?Math.floor(path.worldSamples.length*0.72):0].x,path.worldSamples[index?Math.floor(path.worldSamples.length*0.72):0].y+0.13,path.worldSamples[index?Math.floor(path.worldSamples.length*0.72):0].z]]} color="#198c60" lineWidth={2}/>)}
  </>}
  {curbs.map((curb,index)=><mesh key={`curb-${index}`} position={[curb.x,curb.y+0.28,curb.z]} rotation={[0,curb.rotation,0]} castShadow>
   <boxGeometry args={[4,0.28,1.1]}/><meshStandardMaterial color={index%2?'#f4f4ef':'#e12636'} roughness={0.75}/>
  </mesh>)}
  {start&&<group position={[start.x,start.y+0.22,start.z]} rotation={[0,start.angle+Math.PI/2,0]}>
   {Array.from({length:8},(_,index)=><mesh key={index} position={[(index-3.5)*TRACK_RIBBON_WIDTH/8,0,0]}>
    <boxGeometry args={[TRACK_RIBBON_WIDTH/8,0.18,0.7]}/><meshStandardMaterial color={index%2?'#f4f4ef':'#111'} roughness={0.8}/>
   </mesh>)}
  </group>}
 </>;
}

function RaceCars({state,path,pitPath,trackMap,selectedDriverId,onSelect,filter,showTrail,sampleCars,frameRef}){
 const groupRefs=useRef(new Map()),safetyRef=useRef(null),trailPointsRef=useRef([]),trailObjectRef=useRef(null);
 const bodyGeometry=useMemo(()=>new BoxGeometry(2.15,0.72,4.35,2,1,5),[]);
 const wingGeometry=useMemo(()=>new BoxGeometry(3.1,0.16,0.55),[]);
 const wheelGeometry=useMemo(()=>new BoxGeometry(0.55,0.85,0.95),[]);
 const trail=useMemo(()=>new ThreeLine(undefined,new LineBasicMaterial({color:'#e12636',transparent:true,opacity:0.45})),[]);
 useEffect(()=>()=>{bodyGeometry.dispose();wingGeometry.dispose();wheelGeometry.dispose();trail.geometry.dispose();trail.material.dispose()},[bodyGeometry,wingGeometry,wheelGeometry,trail]);
 useFrame((_,delta)=>{
  const candidates=sampleCars(performance.now());
  frameRef.current=candidates;
  const visible=candidates.filter(item=>item.car.retired?filter==='retired':filter!=='retired');
  const displayed=visible.map(item=>({...item,world:toWorld(item.point,path)})).filter(item=>item.world);
  displayed.forEach((item,index)=>{
   const nearby=displayed.filter(other=>other!==item&&Math.hypot(other.world.x-item.world.x,other.world.z-item.world.z)<5);
   if(nearby.length){
    const side=index%2?1:-1,offset=side*Math.min(nearby.length,3)*2.1,angle=item.point.angle;
    item.world.x-=Math.sin(angle)*offset;
    item.world.z-=Math.cos(angle)*offset;
   }
   const group=groupRefs.current.get(item.id);
   if(group){
    group.position.set(item.world.x,item.world.y+(item.car.retired?-1:0),item.world.z);
    group.rotation.y=item.point.angle+Math.PI/2;
    group.scale.setScalar(item.car.retired?0.86:1);
   }
  });
  const leader=displayed.find(item=>item.car.position===1&&!item.car.retired);
  if(showTrail&&leader){
   trailPointsRef.current.push(new Vector3(leader.world.x,leader.world.y+0.35,leader.world.z));
   trailPointsRef.current=trailPointsRef.current.slice(-32);
   trail.geometry.setFromPoints(trailPointsRef.current);
  }else if(!showTrail)trailPointsRef.current=[];
  if(trailObjectRef.current)trailObjectRef.current.visible=showTrail;
  if(leader&&safetyRef.current){
   const marker=getTrack3DPointAt(path,wrap(leader.progress-0.018))||toWorld(leader.point,path);
   safetyRef.current.position.set(marker.x,marker.y+1.15,marker.z);
   safetyRef.current.rotation.y=leader.point.angle+Math.PI/2;
  }
 });
 useEffect(()=>()=>{groupRefs.current.clear()},[]);
 return <>
  {state.cars.map(car=><group key={car.driverId}
   ref={node=>{if(node)groupRefs.current.set(String(car.driverId),node);else groupRefs.current.delete(String(car.driverId))}}
   onClick={event=>{event.stopPropagation();onSelect(car.driverId)}}
   visible={car.retired?filter==='retired':filter!=='retired'}>
   <mesh geometry={bodyGeometry} castShadow receiveShadow dispose={null}><meshStandardMaterial color={car.retired?'#777':car.entry.team?.color||'#d3202f'} metalness={0.22} roughness={0.55}/></mesh>
   <mesh geometry={wingGeometry} position={[0,-0.08,2.38]} castShadow dispose={null}><meshStandardMaterial color={car.entry.team?.color||'#d3202f'} roughness={0.5}/></mesh>
   <mesh geometry={wingGeometry} position={[0,-0.08,-2.45]} castShadow dispose={null}><meshStandardMaterial color={car.entry.team?.color||'#d3202f'} roughness={0.5}/></mesh>
   {[-1,1].flatMap(side=>[-1,1].map(axle=><mesh key={`${side}-${axle}`} geometry={wheelGeometry} position={[side*1.14,-0.08,axle*1.38]} castShadow dispose={null}><meshStandardMaterial color="#17191a" roughness={0.95}/></mesh>))}
   {String(car.driverId)===String(selectedDriverId)&&<mesh position={[0,0.65,0]} scale={[1.3,1,2.3]}><boxGeometry args={[2.2,0.08,4.4]}/><meshBasicMaterial color="#ffe354" wireframe/></mesh>}
   <Billboard position={[0,3.4,0]} follow><Text fontSize={1.75} color="#16191a" outlineColor="white" outlineWidth={0.12} anchorX="center" anchorY="middle">{labelFor(car.entry.driver)}</Text></Billboard>
  </group>)}
  <group ref={safetyRef} visible={['safety_car','vsc'].includes(state.raceControl)}>
   <mesh geometry={bodyGeometry} castShadow dispose={null}><meshStandardMaterial color="#f4d532" emissive="#b5941e" emissiveIntensity={0.2}/></mesh>
   <mesh geometry={wingGeometry} position={[0,0.05,2.38]} dispose={null}><meshStandardMaterial color="#f4d532"/></mesh>
  </group>
  <primitive ref={trailObjectRef} object={trail} visible={showTrail}/>
 </>;
}

function CameraRig({mode,selectedDriverId,state,path,frameRef,controlsRef}){
 const focusRef=useRef([0,0,0]);
 useFrame(({camera},delta)=>{
  if(mode==='orbit')return;
  let target=[0,0,0],desired=[0,360,0.01];
  if(mode==='chase'){
   const selected=frameRef.current.find(item=>String(item.car.driverId)===String(selectedDriverId));
   const point=selected?toWorld(selected.point,path):null;
   if(point){
    const angle=selected.point.angle,forward=[Math.cos(angle),-Math.sin(angle)];
    target=[point.x+forward[0]*9,point.y+1,point.z+forward[1]*9];
    desired=[point.x-forward[0]*24,point.y+14,point.z-forward[1]*24];
   }
  }else if(mode==='tv'){
   const selected=state.cars.find(car=>String(car.driverId)===String(selectedDriverId));
   const cameraIndex=Math.floor((Math.max(1,selected?.position||1)-1)/4)%5;
   const sample=getTrack3DPointAt(path,(cameraIndex+0.5)/5);
   if(sample){
    const angle=sample.angle,point=sample,side=[Math.sin(angle),Math.cos(angle)];
    target=[point.x,point.y+1,point.z];
    desired=[point.x+side[0]*37,point.y+15,point.z+side[1]*37];
   }
  }
  camera.up.set(0,0,-1);
  const smoothing=1-Math.exp(-delta*(mode==='chase'?3:2));
  camera.position.lerp({x:desired[0],y:desired[1],z:desired[2]},smoothing);
  focusRef.current=focusRef.current.map((value,index)=>MathUtils.lerp(value,target[index],smoothing));
  camera.lookAt(...focusRef.current);
  camera.updateProjectionMatrix();
 });
 return <OrbitControls ref={controlsRef} enabled={mode==='orbit'} target={[0,0,0]} enableDamping dampingFactor={0.08}/>;
}

function TrackScene({state,race,selectedDriverId,onSelect,filter,showSectors,showDrs,showTrail,showGroundImage,path,pitPath,trackMap,sectorMarks,drsZones,groundDepth,cameraMode}){
 const frameRef=useRef([]),controlsRef=useRef(null);
 const sampleCars=useCarProgress({state,isRunning:race.isRunning,speed:race.speed,path,trackMap,pitPath});
 return <>
  <color attach="background" args={['#9ba9ad']}/>
  <fog attach="fog" args={['#9ba9ad',150,660]}/>
  <ambientLight intensity={0.8}/>
  <directionalLight position={[-120,180,90]} intensity={2.2} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024}/>
  <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.8,0]} receiveShadow>
   <planeGeometry args={[500,groundDepth]}/><meshStandardMaterial color="#626d5b" roughness={1}/>
  </mesh>
  {showGroundImage&&race?.circuit_image_url&&<Suspense fallback={null}><GroundTexture url={race.circuit_image_url} width={500} depth={groundDepth}/></Suspense>}
  <TrackSurface path={path} pitPath={pitPath} showSectors={showSectors} showDrs={showDrs} sectorMarks={sectorMarks} drsZones={drsZones}/>
  <RaceCars state={state} path={path} pitPath={pitPath} trackMap={trackMap} selectedDriverId={selectedDriverId} onSelect={onSelect} filter={filter} showTrail={showTrail} sampleCars={sampleCars} frameRef={frameRef}/>
  <CameraRig mode={cameraMode} selectedDriverId={selectedDriverId} state={state} path={path} frameRef={frameRef} controlsRef={controlsRef}/>
 </>;
}

export default function LiveTrack3D({
 state,race,selectedDriverId,onSelect,isRunning,speed=1,filter='all',
 showSectors=false,showDrs=false,showTrail=false,showLeaderboard=true,
 showGroundImage=false,graphicsQuality='high',imageWidth:uploadedImageWidth=1200,
 imageHeight:uploadedImageHeight=800,onFallback
}){
 const legacyMap=race?.track_map&&typeof race.track_map==='object'?race.track_map:{};
 const circuitPath=useMemo(()=>parseCircuitTrackPath(race?.circuit_path),[race?.circuit_path]);
 const useCircuitPath=typeof race?.circuit_path==='string'&&race.circuit_path.trim().startsWith('{');
 const sourcePoints=useCircuitPath?circuitPath.points:legacyMap.pathPoints||[];
 const sourceStart=useCircuitPath?circuitPath.startFinishIndex:legacyMap.startFinishIndex;
 const direction=useCircuitPath?circuitPath.direction:legacyMap.drivingDirection==='counterclockwise'?-1:1;
 const directional=useMemo(()=>getDirectionalTrackPoints(sourcePoints,sourceStart??0,direction),[sourcePoints,sourceStart,direction]);
 const pathPoints=directional.points;
 const imageWidth=useCircuitPath?Number(legacyMap.imageWidth)||uploadedImageWidth:Number(legacyMap.imageWidth)||1200;
 const imageHeight=useCircuitPath?Number(legacyMap.imageHeight)||uploadedImageHeight:Number(legacyMap.imageHeight)||800;
 const path=useMemo(()=>createTrack3DPath(pathPoints,{imageWidth,imageHeight,sampleCount:1000}),[pathPoints,imageWidth,imageHeight]);
 const sourcePitPoints=useCircuitPath?circuitPath.pitLanePoints:legacyMap.pitLanePoints||[];
 const pitLanePoints=direction===-1&&useCircuitPath?[...sourcePitPoints].reverse():sourcePitPoints;
 const pitPath=useMemo(()=>createTrack3DPath(pitLanePoints,{imageWidth,imageHeight,sampleCount:200,closed:false}),[pitLanePoints,imageWidth,imageHeight]);
 const trackMap={pathPoints,imageWidth,imageHeight,pitLanePoints};
 const sectorMarks=useCircuitPath
  ?[circuitPath.sectorMarks[0],circuitPath.sectorMarks[1]].filter(Number.isInteger).map(index=>findProgress(path,pathPoints,directional.indexMap[index]))
  :Object.values(legacyMap.sectorMarks||{}).filter(Number.isInteger).map(index=>findProgress(path,pathPoints,directional.indexMap[index]));
 const drsZones=useCircuitPath?circuitPath.drsZones.map(zone=>({
  start:zone.start===null?null:findProgress(path,pathPoints,directional.indexMap[zone.start]),
  end:zone.end===null?null:findProgress(path,pathPoints,directional.indexMap[zone.end])
 })): (legacyMap.drsZones||[]).map(zone=>({
  start:Number.isInteger(zone.startIndex)?findProgress(path,pathPoints,directional.indexMap[zone.startIndex]):null,
  end:Number.isInteger(zone.endIndex)?findProgress(path,pathPoints,directional.indexMap[zone.endIndex]):null
 }));
 const [cameraMode,setCameraMode]=useState('top');
 const groundDepth=400*imageHeight/imageWidth;
 useEffect(()=>{
  if(!canRenderTrack3D(pathPoints,useCircuitPath?circuitPath.closed:legacyMap.closed!==false))
   onFallback('3D needs a closed track with at least 8 points. Showing the 2D map.');
 },[pathPoints,useCircuitPath,circuitPath.closed,legacyMap.closed,onFallback]);
 return <div className={`live-track-3d-stage ${graphicsQuality==='low'?'low-graphics':''}`}>
  <Canvas
   shadows={graphicsQuality==='high'}
   dpr={graphicsQuality==='high'?[1,1.75]:[1,1]}
   gl={{antialias:graphicsQuality==='high',powerPreference:'high-performance'}}
   camera={{position:[0,360,0.01],up:[0,0,-1],fov:43,near:0.1,far:1000}}
   onCreated={({gl})=>{if(!gl.getContext())onFallback('WebGL is unavailable. Showing the 2D map.')}}
  >
   <SceneErrorBoundary onFallback={onFallback}>
    <TrackScene
     state={state} race={{...race,isRunning,speed}} selectedDriverId={selectedDriverId}
     onSelect={onSelect} filter={filter} showSectors={showSectors} showDrs={showDrs}
     showTrail={showTrail} showGroundImage={showGroundImage} path={path} pitPath={pitPath} trackMap={trackMap}
     sectorMarks={sectorMarks} drsZones={drsZones} groundDepth={groundDepth} cameraMode={cameraMode}
    />
   </SceneErrorBoundary>
  </Canvas>
  <div className="track-3d-camera-controls" role="group" aria-label="3D camera mode">
   {[['top','Top-down'],['chase','Chase'],['tv','TV trackside'],['orbit','Orbit']].map(([key,label])=><button type="button" key={key} className={cameraMode===key?'active':''} onClick={()=>setCameraMode(key)}>{label}</button>)}
  </div>
  {showLeaderboard&&<div className="track-3d-leaderboard">{[...state.cars].filter(car=>!car.retired).sort((a,b)=>a.position-b.position).slice(0,5).map(car=><button type="button" key={car.driverId} onClick={()=>onSelect(car.driverId)} className={String(selectedDriverId)===String(car.driverId)?'selected':''}><span style={{'--team-color':car.entry.team?.color||'#d3202f'}}>{car.position}</span>{labelFor(car.entry.driver)}</button>)}</div>}
  {showTrail&&<div className="track-3d-indicator" aria-hidden="true">Leader trail enabled</div>}
 </div>;
}
