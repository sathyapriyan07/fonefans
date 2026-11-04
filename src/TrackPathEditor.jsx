import {useEffect,useMemo,useRef,useState} from 'react';
import {buildTrackPath,emptyCircuitTrackPath,getDirectionalTrackPoints,getPointAt,parseCircuitTrackPath,stringifyCircuitTrackPath} from './trackPath.js';
import {autoTraceTrack} from './trackAutoTrace.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const markerModes={
 startFinish:'Set start / finish',
 sector1:'Sector 1 end',
 sector2:'Sector 2 end / Sector 3 start',
 drsStart:'DRS zone start',
 drsEnd:'DRS zone end',
 pitEntry:'Pit entry',
 pitExit:'Pit exit'
};
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
function getSvgPoint(event){
 const rect=event.currentTarget.getBoundingClientRect();
 return {x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};
}
function nearestPoint(points,point){
 if(!points.length)return null;
 return points.reduce((best,candidate,index)=>{
  const distance=(candidate.x-point.x)**2+(candidate.y-point.y)**2;
  return distance<best.distance?{index,distance}:best;
 },{index:0,distance:Infinity}).index;
}

export default function TrackPathEditor({race,value,image,onChange}){
 const [draft,setDraft]=useState(()=>parseCircuitTrackPath(value));
 const [rawJson,setRawJson]=useState(()=>typeof value==='string'&&value.trim()?value:stringifyCircuitTrackPath(emptyCircuitTrackPath()));
 const [rawError,setRawError]=useState('');
 const [error,setError]=useState('');
 const [mode,setMode]=useState('manual');
 const [selectedPoint,setSelectedPoint]=useState(null);
 const [dragging,setDragging]=useState(null);
 const [preview,setPreview]=useState(false);
 const [activeDrsZone,setActiveDrsZone]=useState(0);
 const [imageSize,setImageSize]=useState({width:1200,height:800});
 const [imageSource,setImageSource]=useState('');
 const undoStack=useRef([]);
 const svgRef=useRef(null);
 const previewDotRef=useRef(null);
 const fileUrlRef=useRef(null);
 const editValueRef=useRef(value);

 useEffect(()=>{
  const imageIsFile=typeof File!=='undefined'&&image instanceof File;
  if(imageIsFile){
   const url=URL.createObjectURL(image);
   fileUrlRef.current=url;setImageSource(url);
   return ()=>{URL.revokeObjectURL(url);if(fileUrlRef.current===url)fileUrlRef.current=null};
  }
  setImageSource(typeof image==='string'?image:'');
  return undefined;
 },[image]);

 useEffect(()=>{
  if(editValueRef.current===value)return;
  editValueRef.current=value;
  const parsed=parseCircuitTrackPath(value);
  setDraft(parsed);setRawJson(typeof value==='string'&&value.trim()?value:stringifyCircuitTrackPath(emptyCircuitTrackPath()));
  setRawError('');setError('');undoStack.current=[];setSelectedPoint(null);setActiveDrsZone(0);
 },[value]);

 const width=imageSize.width,height=imageSize.height;
 const directional=useMemo(()=>getDirectionalTrackPoints(draft.points,draft.startFinishIndex??0,draft.direction),[draft.points,draft.startFinishIndex,draft.direction]);
 const smoothPath=useMemo(()=>buildTrackPath(directional.points,{closed:draft.closed,width,height,sampleCount:500}),[directional.points,draft.closed,width,height]);
 const pitPath=useMemo(()=>buildTrackPath(draft.pitLanePoints,{closed:false,width,height,sampleCount:180}),[draft.pitLanePoints,width,height]);
 const svgPoints=points=>points.map(point=>`${point.x*width},${point.y*height}`).join(' ');
 const markerAt=index=>{
  if(!Number.isInteger(index)||!draft.points[index])return null;
  return directional.points[directional.indexMap[index]];
 };
 const markers=[
  ...(draft.startFinishIndex===null?[]:[{index:draft.startFinishIndex,label:'S/F',color:'#e12636'}]),
  ...(draft.sectorMarks[0]===null||draft.sectorMarks[0]===undefined?[]:[{index:draft.sectorMarks[0],label:'S1 END',color:'#7a4be0'}]),
  ...(draft.sectorMarks[1]===null||draft.sectorMarks[1]===undefined?[]:[{index:draft.sectorMarks[1],label:'S2 / S3',color:'#7a4be0'}]),
  ...(draft.drsZones||[]).flatMap((zone,index)=>[
   ...(zone.start===null||zone.start===undefined?[]:[{index:zone.start,label:`D${index+1}S`,color:'#1874d1'}]),
   ...(zone.end===null||zone.end===undefined?[]:[{index:zone.end,label:`D${index+1}E`,color:'#1874d1'}])
  ])
 ];
 const commit=next=>{
  const canonical=parseCircuitTrackPath(next);
  const serialized=stringifyCircuitTrackPath(canonical);
  setDraft(canonical);setRawJson(serialized);setRawError('');setError('');
  editValueRef.current=serialized;
  onChange?.(serialized);
 };
 const update=next=>{undoStack.current.push(clone(draft));commit(next)};
 const setPoints=(lane,points)=>update({...draft,[lane==='pit'?'pitLanePoints':'points']:points});
 const undo=()=>{
  const previous=undoStack.current.pop();
  if(previous){commit(previous);setSelectedPoint(null)}
 };
 const clear=()=>{
  update({...draft,points:[],closed:false,startFinishIndex:null,sectorMarks:[],drsZones:[],pitLanePoints:[]});
  setActiveDrsZone(0);
 };
 const addDrsZone=()=>{
  const index=(draft.drsZones||[]).length;
  update({...draft,drsZones:[...(draft.drsZones||[]),{start:null,end:null}]});
  setActiveDrsZone(index);setMode('drsStart');
 };
 const deletePoint=(lane,index)=>{
  const key=lane==='pit'?'pitLanePoints':'points',points=draft[key].filter((_,pointIndex)=>pointIndex!==index);
  if(lane==='pit'){setPoints('pit',points);return}
  const adjust=value=>value===index?null:Number.isInteger(value)&&value>index?value-1:value;
  update({
   ...draft,points,
   startFinishIndex:adjust(draft.startFinishIndex),
   sectorMarks:draft.sectorMarks.map(adjust),
   drsZones:draft.drsZones.map(zone=>({start:adjust(zone.start),end:adjust(zone.end)}))
  });
  setSelectedPoint(null);
 };
 const placeMarker=point=>{
  const index=nearestPoint(draft.points,point);
  if(index===null){setError('Trace the racing line before placing markers.');return}
  if(mode==='startFinish')update({...draft,startFinishIndex:index});
  else if(mode==='sector1'||mode==='sector2'){
   const sectorMarks=[...draft.sectorMarks];
   sectorMarks[mode==='sector1'?0:1]=index;
   update({...draft,sectorMarks});
  }else if(mode==='drsStart'||mode==='drsEnd'){
   const drsZones=[...(draft.drsZones||[])];
   while(drsZones.length<=activeDrsZone)drsZones.push({start:null,end:null});
   const zone={...drsZones[activeDrsZone]};
   zone[mode==='drsStart'?'start':'end']=index;drsZones[activeDrsZone]=zone;
   update({...draft,drsZones});
  }else if(mode==='pitEntry'||mode==='pitExit'){
   const pitLanePoints=[...draft.pitLanePoints],coordinate=draft.points[index];
   if(mode==='pitEntry'){
    if(pitLanePoints.length===1)pitLanePoints.unshift(coordinate);
    else pitLanePoints[0]=coordinate;
   }else if(!pitLanePoints.length)pitLanePoints.push(coordinate);
   else if(pitLanePoints.length===1)pitLanePoints.push(coordinate);
   else pitLanePoints[pitLanePoints.length-1]=coordinate;
   update({...draft,pitLanePoints});
  }
 };
 const addPoint=event=>{
  if(event.button!==0||dragging)return;
  if(!imageSource){setError('Select or upload a circuit image before tracing points.');return}
  const point=getSvgPoint(event);
  if(Object.hasOwn(markerModes,mode)){placeMarker(point);return}
  const lane=mode==='pit'?'pit':'track',key=lane==='pit'?'pitLanePoints':'points';
  const points=[...draft[key],point];
  setPoints(lane,points);setSelectedPoint({lane,index:points.length-1});
 };
 const handlePointerMove=event=>{
  if(!dragging)return;
  const key=dragging.lane==='pit'?'pitLanePoints':'points',points=[...draft[key]];
  points[dragging.index]={...points[dragging.index],...getSvgPoint(event)};
  commit({...draft,[key]:points});
 };
 const setSelectedElevation=value=>{
  if(selectedPoint?.lane!=='track'||!draft.points[selectedPoint.index])return;
  const points=[...draft.points];
  points[selectedPoint.index]={...points[selectedPoint.index],z:Number(value)};
  update({...draft,points});
 };
 const startDrag=(event,lane,index)=>{
  event.stopPropagation();event.preventDefault();
  setDragging({lane,index,snapshot:clone(draft)});
  setSelectedPoint({lane,index});
  event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
 };
 const endDrag=()=>{
  if(dragging){undoStack.current.push(clone(dragging.snapshot));setDragging(null)}
 };
 const rightClickDelete=event=>{
  event.preventDefault();
  const point=getSvgPoint(event);
  const candidates=[
   ...draft.points.map((candidate,index)=>({lane:'track',index,candidate})),
   ...draft.pitLanePoints.map((candidate,index)=>({lane:'pit',index,candidate}))
  ].map(item=>({...item,distance:(item.candidate.x-point.x)**2*width**2+(item.candidate.y-point.y)**2*height**2}));
  const nearest=candidates.sort((left,right)=>left.distance-right.distance)[0];
  if(nearest&&nearest.distance<=(Math.max(width,height)*0.025)**2)deletePoint(nearest.lane,nearest.index);
 };
 const onEditorKeyDown=event=>{
  if(event.key==='Delete'||event.key==='Backspace'){
   if(selectedPoint){event.preventDefault();deletePoint(selectedPoint.lane,selectedPoint.index)}
  }
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo()}
 };
 const runAutoTrace=async()=>{
  if(!imageSource){setError('Upload or select a circuit image before auto-tracing.');return}
  setError('');
  try{
   const imageElement=new Image();
   imageElement.crossOrigin='anonymous';
   await new Promise((resolve,reject)=>{
    imageElement.onload=resolve;
    imageElement.onerror=()=>reject(new Error('The circuit image could not be loaded for auto-tracing.'));
    imageElement.src=imageSource;
   });
   const scale=Math.min(1,512/Math.max(imageElement.naturalWidth,imageElement.naturalHeight));
   const canvas=document.createElement('canvas');
   canvas.width=Math.max(8,Math.round(imageElement.naturalWidth*scale));
   canvas.height=Math.max(8,Math.round(imageElement.naturalHeight*scale));
   const context=canvas.getContext('2d',{willReadFrequently:true});
   if(!context)throw new Error('Canvas processing is unavailable in this browser.');
   context.drawImage(imageElement,0,0,canvas.width,canvas.height);
   const points=autoTraceTrack(context.getImageData(0,0,canvas.width,canvas.height));
   if(points.length<8)throw new Error('The detected path was too small. Use manual tracing instead.');
   setImageSize({width:imageElement.naturalWidth,height:imageElement.naturalHeight});
   update({...draft,points,closed:true,startFinishIndex:0,direction:1});
   setMode('manual');
  }catch(traceError){
   console.error('Circuit auto-trace failed:',traceError);
   setError(`${traceError instanceof Error?traceError.message:String(traceError)} You can trace the circuit manually.`);
  }
 };
 useEffect(()=>{
  if(!preview||!previewDotRef.current||!smoothPath.samples.length)return undefined;
  let animationId=0,startTime=null;
  const animate=now=>{
   if(startTime===null)startTime=now;
   const fraction=((now-startTime)%8000)/8000;
   const progress=smoothPath.closed?fraction:fraction<0.5?fraction*2:2-fraction*2;
   const point=getPointAt(smoothPath,progress);
   if(point&&previewDotRef.current){
    previewDotRef.current.setAttribute('cx',String(point.x*width));
    previewDotRef.current.setAttribute('cy',String(point.y*height));
   }
   animationId=requestAnimationFrame(animate);
  };
  animationId=requestAnimationFrame(animate);
  return ()=>cancelAnimationFrame(animationId);
 },[preview,smoothPath,width,height]);
 const handleRawJson=value=>{
  setRawJson(value);
  editValueRef.current=value;onChange?.(value);
  try{
   const parsed=JSON.parse(value);
   if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.points))throw new Error('JSON must have a points array.');
   const canonical=parseCircuitTrackPath(parsed);
   setDraft(canonical);setRawError('');setActiveDrsZone(0);
  }catch(parseError){setRawError(parseError instanceof Error?parseError.message:'Invalid JSON.')}
 };
 const onImageLoad=event=>{
  const {naturalWidth,naturalHeight}=event.currentTarget;
  if(naturalWidth&&naturalHeight)setImageSize({width:naturalWidth,height:naturalHeight});
 };

 return <section className="track-path-editor" onKeyDown={onEditorKeyDown} tabIndex={0}>
  <div className="track-path-editor-heading">
   <div><h3>Track Path Editor</h3><p>Auto-trace the track outline or add and move points manually. Coordinates save normalized to the image.</p></div>
   <div className="track-path-mode" role="group" aria-label="Tracing mode">
    <button type="button" className={mode==='auto'?'active':''} onClick={()=>setMode('auto')}>Auto-trace</button>
    <button type="button" className={mode!=='auto'?'active':''} onClick={()=>setMode('manual')}>Manual</button>
   </div>
  </div>
  {mode==='auto'&&<div className="track-path-auto-controls">
   <p>Detect the largest closed dark track outline from the selected circuit image. Label boxes and small image details are discarded.</p>
   <button type="button" onClick={()=>void runAutoTrace()} disabled={!imageSource}>Auto-trace image</button>
  </div>}
  <div className="track-path-tools">
   <label>Editor tool<select value={mode==='auto'?'manual':mode} onChange={event=>setMode(event.target.value)}>
    <option value="manual">Racing line point</option><option value="pit">Pit lane point</option>
    {Object.entries(markerModes).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></label>
   {(draft.drsZones.length>0||mode==='drsStart'||mode==='drsEnd')&&<label>DRS zone<select value={Math.min(activeDrsZone,Math.max(0,draft.drsZones.length-1))} onChange={event=>setActiveDrsZone(Number(event.target.value))}>
    {Array.from({length:Math.max(1,draft.drsZones.length)},(_,index)=><option key={index} value={index}>Zone {index+1}</option>)}
   </select></label>}
   <button type="button" onClick={addDrsZone}>Add DRS zone</button>
   <button type="button" onClick={undo} disabled={!undoStack.current.length}>Undo</button>
   <button type="button" onClick={()=>update({...draft,closed:!draft.closed})}>{draft.closed?'Open loop':'Close loop'}</button>
   <button type="button" onClick={()=>update({...draft,direction:draft.direction===1?-1:1})}>Flip direction</button>
   <button type="button" onClick={()=>setPreview(value=>!value)} disabled={smoothPath.samples.length<2}>{preview?'Stop preview':'Preview'}</button>
   <button type="button" onClick={clear} disabled={!draft.points.length&&!draft.pitLanePoints.length}>Clear</button>
   {selectedPoint?.lane==='track'&&draft.points[selectedPoint.index]&&<label>Elevation <output>{draft.points[selectedPoint.index].z??0}</output><input type="range" min="-10" max="30" step="0.5" value={draft.points[selectedPoint.index].z??0} onChange={event=>setSelectedElevation(event.target.value)}/></label>}
  </div>
  <p className="track-path-marker-help">Sector 3 ends at start/finish; pit entry and exit are the first and last pit-lane points. Right-click a point or select it and press Delete to remove it.</p>
  <div className="track-path-markers">
   <span>{draft.points.length} racing points</span><span>{draft.pitLanePoints.length} pit-lane points</span>
   <span>Start/finish: {draft.startFinishIndex??'not set'}</span><span>Direction: {draft.direction===1?'forward':'reverse'}</span>
  </div>
  <div className="track-path-canvas-wrap" style={{aspectRatio:`${width}/${height}`}}>
   {imageSource?<img className="track-path-background" src={imageSource} alt={`${race?.name||'Race'} circuit`} onLoad={onImageLoad}/>:<div className="track-path-no-image">Upload or select a circuit image above to trace the path.</div>}
   <svg ref={svgRef} tabIndex={0} aria-label="Track path drawing area" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={`track-path-editor-canvas ${Object.hasOwn(markerModes,mode)?'placing-marker':'adding-points'}`}
    onClick={addPoint} onPointerMove={handlePointerMove} onPointerUp={endDrag} onPointerLeave={endDrag} onContextMenu={rightClickDelete}>
    {smoothPath.samples.length>1&&<polyline points={svgPoints(smoothPath.samples)} fill="none" stroke="#e12636" strokeWidth={Math.max(width,height)*0.004} strokeLinejoin="round" strokeLinecap="round"/>}
    {draft.closed&&draft.points.length>2&&<polyline points={`${svgPoints(smoothPath.samples)} ${smoothPath.samples[0]?.x*width},${smoothPath.samples[0]?.y*height}`} fill="none" stroke="#e12636" strokeWidth={Math.max(width,height)*0.004}/>}
    {pitPath.samples.length>1&&<polyline points={svgPoints(pitPath.samples)} fill="none" stroke="#168b62" strokeWidth={Math.max(width,height)*0.003} strokeDasharray={`${Math.max(width,height)*0.012} ${Math.max(width,height)*0.009}`}/>}
    {markers.map((marker,index)=>{const point=markerAt(marker.index);return point&&<g key={`${marker.label}-${index}`} pointerEvents="none"><circle cx={point.x*width} cy={point.y*height} r={Math.max(width,height)*0.009} fill={marker.color} stroke="white" strokeWidth={Math.max(width,height)*0.003}/><text x={point.x*width} y={point.y*height} dy={-Math.max(width,height)*0.016} fill={marker.color} fontSize={Math.max(width,height)*0.018} fontWeight="bold" textAnchor="middle">{marker.label}</text></g>})}
    {draft.pitLanePoints.length>0&&[ {point:draft.pitLanePoints[0],label:'PIT IN'},...(draft.pitLanePoints.length>1?[{point:draft.pitLanePoints.at(-1),label:'PIT OUT'}]:[]) ].map(marker=><g key={marker.label} pointerEvents="none"><circle cx={marker.point.x*width} cy={marker.point.y*height} r={Math.max(width,height)*0.009} fill="#168b62" stroke="white" strokeWidth={Math.max(width,height)*0.003}/><text x={marker.point.x*width} y={marker.point.y*height} dy={-Math.max(width,height)*0.016} fill="#168b62" fontSize={Math.max(width,height)*0.018} fontWeight="bold" textAnchor="middle">{marker.label}</text></g>)}
    {draft.points.map((point,index)=>{const location=directional.points[directional.indexMap[index]];return <circle key={`track-${index}`} cx={location.x*width} cy={location.y*height} r={Math.max(width,height)*0.006} fill={selectedPoint?.lane==='track'&&selectedPoint.index===index?'#ffd43b':'#fff'} stroke="#d3202f" strokeWidth={Math.max(width,height)*0.003} onPointerDown={event=>startDrag(event,'track',index)} onClick={event=>event.stopPropagation()}/>})}
    {draft.pitLanePoints.map((point,index)=><circle key={`pit-${index}`} cx={point.x*width} cy={point.y*height} r={Math.max(width,height)*0.006} fill={selectedPoint?.lane==='pit'&&selectedPoint.index===index?'#ffd43b':'#fff'} stroke="#168b62" strokeWidth={Math.max(width,height)*0.003} onPointerDown={event=>startDrag(event,'pit',index)} onClick={event=>event.stopPropagation()}/>)}
    {preview&&<circle ref={previewDotRef} r={Math.max(width,height)*0.01} fill="#ffe354" stroke="#171717" strokeWidth={Math.max(width,height)*0.003} pointerEvents="none"/>}
   </svg>
  </div>
  {error&&<p className="track-path-error" role="alert">{error}</p>}
  <details className="track-path-raw">
   <summary>Advanced: raw JSON</summary>
   <label>circuit_path JSON<textarea spellCheck="false" value={rawJson} onChange={event=>handleRawJson(event.target.value)}/></label>
   {rawError&&<span className="track-path-error" role="alert">{rawError}</span>}
  </details>
 </section>;
}
