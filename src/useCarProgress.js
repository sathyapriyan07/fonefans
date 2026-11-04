import {useCallback,useRef} from 'react';
import {getLapProgress,getTrackDisplayPoint,interpolateLapProgress} from './trackPath.js';

const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const wrap=value=>((value%1)+1)%1;

export function useCarProgress({state,isRunning,speed,path,trackMap,pitPath}){
 const optionsRef=useRef(null);
 const timelineRef=useRef({observedLap:state?.lap,elapsedMs:0,lastFrameTime:0,transitionSpeed:speed,fromProgress:new Map(),displayed:new Map()});
 optionsRef.current={state,isRunning,speed,path,trackMap,pitPath};

 return useCallback(now=>{
  const current=optionsRef.current;
  if(!current?.state||!current.path)return [];
  const {state:raceState,isRunning:running,speed:playbackSpeed,path:trackPath,trackMap:currentTrackMap,pitPath:currentPitPath}=current;
  const timeline=timelineRef.current;
  if(raceState.lap!==timeline.observedLap){
   timeline.observedLap=raceState.lap;
   timeline.elapsedMs=0;
   timeline.transitionSpeed=playbackSpeed;
   timeline.fromProgress=new Map(timeline.displayed);
  }else if(timeline.lastFrameTime&&running){
   timeline.elapsedMs+=clamp(now-timeline.lastFrameTime,0,100);
  }
  timeline.lastFrameTime=now;
  const activeCars=raceState.cars.filter(car=>!car.retired);
  const averageLap=activeCars.reduce((sum,car)=>sum+(Number(car.lastLap)||Number(car.bestLap)||90),0)/Math.max(1,activeCars.length);
  const baseAmount=clamp(timeline.elapsedMs/Math.max(100,1000/Math.max(0.1,timeline.transitionSpeed)),0,1);
  const raceControl=['safety_car','vsc'].includes(raceState.raceControl);
  const leader=activeCars.find(car=>car.position===1)||activeCars[0];
  const leaderProgress=leader?getLapProgress(leader.trackProgress,raceState.totalLaps,raceState.lap):0;
  const cars=raceState.cars.map(car=>{
   const id=String(car.driverId),raceProgress=car.retired?(car.retiredProgress??car.trackProgress):car.trackProgress;
   const authoritative=getLapProgress(raceProgress,raceState.totalLaps,raceState.lap);
   const previous=timeline.fromProgress.get(id)??timeline.displayed.get(id)??authoritative;
   const carLap=Number(car.lastLap)||Number(car.bestLap)||averageLap;
   const amount=clamp(baseAmount*averageLap/carLap,0,1);
   let progress=car.retired||car.completed?authoritative:interpolateLapProgress(previous,authoritative,amount);
   if(raceControl&&!car.retired&&car!==leader){
    const gap=wrap(progress-leaderProgress);
    progress=wrap(leaderProgress+gap*0.45);
   }
   const inPit=Boolean(car.pitState?.complete&&car.pitState.entryLap===raceState.lap);
   const pitProgress=inPit&&currentPitPath?.samples?.length>1
    ?clamp((baseAmount*averageLap)/(Number(car.pitState.totalTimeLoss)||24),0,1)
    :null;
   const point=getTrackDisplayPoint(trackPath,currentTrackMap,progress,pitProgress,currentPitPath);
   return {car,id,progress,point,pit:Boolean(point?.pit)};
  });
  timeline.displayed=new Map(cars.map(car=>[car.id,car.progress]));
  return cars;
 },[]);
}
