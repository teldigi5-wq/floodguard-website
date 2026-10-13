"use client";
import {Canvas,useFrame,useThree} from "@react-three/fiber";
import {Environment,OrbitControls,Sparkles,Stars} from "@react-three/drei";
import {useEffect,useMemo,useRef,useState} from "react";
import {AdditiveBlending,DoubleSide,Group,MathUtils,Mesh,MeshBasicMaterial,MeshPhysicalMaterial,Vector3} from "three";
import {useLive} from "@/hooks/use-live";

const clamp=(value:number)=>Math.min(1,Math.max(0,value));
const lanes=[-2,0,2];
const waterFillFromGap=(distance:number|null|undefined)=>typeof distance==="number"&&Number.isFinite(distance)?clamp(Math.max(4,Math.min(94,100-distance*3))/100):null;

function AnimatedWater({position,size,color="#087eb2",opacity=.78,speed=1}:{position:[number,number,number];size:[number,number];color?:string;opacity?:number;speed?:number}){
 const surface=useRef<Mesh>(null),material=useRef<MeshPhysicalMaterial>(null),glint=useRef<Mesh>(null);
 useFrame(({clock},delta)=>{const t=clock.elapsedTime*speed;if(surface.current){surface.current.position.y=MathUtils.damp(surface.current.position.y,position[1],2.4,delta);const points=surface.current.geometry.attributes.position;for(let i=0;i<points.count;i++){const x=points.getX(i),y=points.getY(i);points.setZ(i,Math.sin(x*.86+t*1.05)*.035+Math.sin(y*1.18-t*.72)*.024+Math.sin((x+y)*1.7+t*.46)*.012)}points.needsUpdate=true}if(material.current)material.current.opacity=MathUtils.damp(material.current.opacity,opacity,2.8,delta);if(glint.current){glint.current.position.y=MathUtils.damp(glint.current.position.y,position[1]+.035,2.4,delta);glint.current.position.x=position[0]+((t*.7)%4)-2;(glint.current.material as MeshBasicMaterial).opacity=MathUtils.damp((glint.current.material as MeshBasicMaterial).opacity,opacity*.12,2.8,delta)}});
 return <group><mesh ref={surface} position={position} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[size[0],size[1],32,20]}/><meshPhysicalMaterial ref={material} color={color} transparent opacity={opacity} metalness={.08} roughness={.16} clearcoat={1} clearcoatRoughness={.12}/></mesh><mesh ref={glint} position={[position[0],position[1]+.035,position[2]]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[1.4,size[1]*.92]}/><meshBasicMaterial color="#8df5ff" transparent opacity={opacity*.12} blending={AdditiveBlending}/></mesh></group>;
}

function ReservoirBasin({level}:{level:number}){
 const volume=useRef<Mesh>(null),ripples=useRef<Group>(null),base=-1.5,surfaceY=base+level*1.9;
 useFrame(({clock},delta)=>{const height=Math.max(.04,level*1.9);if(volume.current){volume.current.scale.y=MathUtils.damp(volume.current.scale.y,height,2.2,delta);volume.current.position.y=MathUtils.damp(volume.current.position.y,base+height/2,2.2,delta)}if(ripples.current){ripples.current.position.y=MathUtils.damp(ripples.current.position.y,surfaceY+.025,2.2,delta);ripples.current.children.forEach((ring,index)=>{const phase=(clock.elapsedTime*.18+index*.23)%1;ring.scale.setScalar(.7+phase*1.25);((ring as Mesh).material as MeshBasicMaterial).opacity=.16*(1-phase)})}});
 return <group>
 <mesh position={[0,-1.56,-3.25]}><boxGeometry args={[10.8,.48,7.9]}/><meshStandardMaterial color="#162c35" roughness={.95}/></mesh>
 <mesh ref={volume} position={[0,base+.04,-3.2]} scale={[1,.08,1]}><boxGeometry args={[10,.98,7.2]}/><meshStandardMaterial color="#05638f" transparent opacity={.58} roughness={.22}/></mesh>
 <AnimatedWater position={[0,surfaceY,-3.2]} size={[10.05,7.2]} color={level>.68?"#079fc0":"#087eae"} opacity={.84} speed={.68+level*.55}/>
 {[-1,1].map(side=><group key={side}><mesh position={[side*6,-.2,-3.15]} rotation={[0,0,side*.25]}><boxGeometry args={[2.7,3.3,8.8]}/><meshStandardMaterial color="#183c3b" roughness={.92}/></mesh><mesh position={[side*5.3,.82,-4.7]} rotation={[0,side*.14,side*.2]}><coneGeometry args={[2.3,4.4,6]}/><meshStandardMaterial color="#1c5049" roughness={1}/></mesh></group>)}
 <group ref={ripples} position={[0,surfaceY+.025,0]}>{Array.from({length:7},(_,i)=><mesh key={i} position={[-3.9+i*1.3,0,-5.6+Math.sin(i)*.28]} rotation={[-Math.PI/2,0,.12*i]}><ringGeometry args={[.2,.22,32]}/><meshBasicMaterial color="#8ff6ff" transparent opacity={.16}/></mesh>)}</group>
 <mesh position={[0,-1.05,-7]}><boxGeometry args={[5.5,.35,.45]}/><meshStandardMaterial color="#1b5350" roughness={.9}/></mesh>
</group>}

function DownstreamChannel({flow}:{flow:number}){return <group>
 <mesh position={[0,-1.67,5.05]}><boxGeometry args={[8.9,.35,7.6]}/><meshStandardMaterial color="#172b32" roughness={.98}/></mesh>
 <AnimatedWater position={[0,-1.49+flow*.035,5.15]} size={[7.55,7.2]} color="#087aa7" opacity={.015+flow*.72} speed={1.15+flow*1.8}/>
 {[-1,1].map(side=><mesh key={side} position={[side*5.3,-.48,5.1]} rotation={[0,0,side*.32]}><boxGeometry args={[2.8,2.9,8.8]}/><meshStandardMaterial color="#193d3b" roughness={.95}/></mesh>)}
 {lanes.map(x=><mesh key={x} position={[x,-1.32,3.25]} rotation={[-.06,0,0]}><boxGeometry args={[1.55,.16,3.8]}/><meshStandardMaterial color="#697d80" roughness={.82}/></mesh>)}
</group>}

function SensorBeacon({position,color}:{position:[number,number,number];color:string}){
 const rotor=useRef<Group>(null),pulse=useRef<Mesh>(null);
 useFrame(({clock})=>{const time=clock.elapsedTime;if(rotor.current)rotor.current.rotation.z=time*.65;if(pulse.current){const phase=(time*.72)%1;pulse.current.scale.setScalar(1+phase*1.8);(pulse.current.material as MeshBasicMaterial).opacity=.48*(1-phase)}});
 return <group position={position}><mesh position={[0,-.3,0]}><cylinderGeometry args={[.045,.08,.65,12]}/><meshStandardMaterial color="#769bb1" metalness={.7} roughness={.22}/></mesh><mesh><sphereGeometry args={[.12,18,18]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.8}/></mesh><group ref={rotor} rotation={[Math.PI/2,0,0]}>{[.23,.36].map(radius=><mesh key={radius}><torusGeometry args={[radius,.012,8,44]}/><meshBasicMaterial color={color} transparent opacity={.48}/></mesh>)}</group><mesh ref={pulse} rotation={[Math.PI/2,0,0]}><ringGeometry args={[.13,.17,40]}/><meshBasicMaterial color={color} transparent opacity={.4} side={DoubleSide}/></mesh></group>;
}

function UltrasonicGauge({level,state}:{level:number;state:"safe"|"warning"|"danger"|"unavailable"}){
 const pulse=useRef<Group>(null),beam=useRef<Mesh>(null),surfaceY=-1.5+level*1.9,sensorY=2.65,gap=Math.max(.25,sensorY-surfaceY),color=state==="danger"?"#ff6174":state==="warning"?"#ffbd4a":state==="unavailable"?"#7d99aa":"#3ce6a4";
 useFrame(({clock})=>{const t=clock.elapsedTime;if(beam.current)(beam.current.material as MeshBasicMaterial).opacity=.16+Math.sin(t*5)*.07;if(pulse.current)pulse.current.children.forEach((child,index)=>{const phase=(t*.72+index*.32)%1;child.scale.setScalar(.42+phase*1.7);((child as Mesh).material as MeshBasicMaterial).opacity=.5*(1-phase)})});
 return <group position={[-3.7,0,-3.15]}><mesh position={[0,2.38,0]}><cylinderGeometry args={[.055,.075,.6,12]}/><meshStandardMaterial color="#91afbb" metalness={.72} roughness={.2}/></mesh><mesh position={[0,sensorY,0]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.19,.19,.16,22]}/><meshStandardMaterial color="#183c4a" metalness={.8} roughness={.2}/></mesh><mesh position={[0,sensorY-.1,0]} rotation={[Math.PI/2,0,0]}><circleGeometry args={[.12,24]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={2}/></mesh><mesh ref={beam} position={[0,surfaceY+gap/2,0]}><cylinderGeometry args={[.025,.08,gap,14,1,true]}/><meshBasicMaterial color={color} transparent opacity={.2} side={DoubleSide}/></mesh><group ref={pulse} position={[0,surfaceY+.035,0]} rotation={[-Math.PI/2,0,0]}>{[0,1,2].map(i=><mesh key={i}><ringGeometry args={[.12,.16,32]}/><meshBasicMaterial color={color} transparent opacity={.4} side={DoubleSide}/></mesh>)}</group></group>
}

function StormAtmosphere({rain,state}:{rain:number;state:"safe"|"warning"|"danger"|"unavailable"}){
 const clouds=useRef<Group>(null),strength=clamp(rain/35),color=state==="danger"?"#ff6174":state==="warning"?"#ffbd4a":"#30dff0";
 useFrame(({clock})=>{if(clouds.current){clouds.current.position.x=Math.sin(clock.elapsedTime*.12)*1.2;clouds.current.children.forEach((cloud,index)=>cloud.rotation.y=clock.elapsedTime*(index%2?-.035:.028))}});
 return <><group ref={clouds} position={[0,4,-2]}>{Array.from({length:5},(_,i)=><mesh key={i} position={[-5+i*2.45,Math.sin(i)*.28,-1+(i%2)*1.8]} scale={[1.7+(i%2)*.5,.38,.85]}><sphereGeometry args={[1,16,10]}/><meshStandardMaterial color="#183449" transparent opacity={.08+strength*.3} roughness={1}/></mesh>)}</group><pointLight position={[0,3.2,-2]} intensity={(state==="danger"?10:state==="warning"?5:1.5)+strength*4} distance={14} color={color}/></>
}

function WaterRelease({x,openness}:{x:number;openness:number}){
 const root=useRef<Group>(null),foam=useRef<Group>(null),splash=useRef<Group>(null),curtain=useRef<Mesh>(null),chute=useRef<Mesh>(null),intensity=useRef(0);
 const pieces=useMemo(()=>Array.from({length:11},(_,i)=>({z:2.1+i*.52,offset:Math.sin(i*7.1)*.16,width:.72+(i%3)*.11})),[]);
 useFrame(({clock},delta)=>{const t=clock.elapsedTime;intensity.current=MathUtils.damp(intensity.current,openness,2.1,delta);const value=intensity.current;if(root.current){root.current.visible=value>.004;root.current.scale.y=.06+value*.94}if(curtain.current)(curtain.current.material as MeshBasicMaterial).opacity=.05+value*.8;if(chute.current)(chute.current.material as MeshBasicMaterial).opacity=.02+value*.58;if(foam.current)foam.current.children.forEach((child,index)=>{child.position.z=2.12+((t*(1.35+value*3.4)+index*.58)%6);child.position.x=x+Math.sin(t*2.1+index)*(.025+value*.11);child.position.y=-1.37+Math.sin(t*4+index)*(.008+value*.025);((child as Mesh).material as MeshBasicMaterial).opacity=.03+value*.65});if(splash.current){splash.current.rotation.y=t*(.25+value*.65);splash.current.children.forEach(child=>((child as Mesh).material as MeshBasicMaterial).opacity=.02+value*.34)}});
 const curtainHeight=1.62;
 return <group ref={root} scale={[1,.06,1]}><mesh ref={curtain} position={[x,-.96+curtainHeight/2,1.94]}><planeGeometry args={[1.08,curtainHeight,10,16]}/><meshBasicMaterial color="#36dff2" transparent opacity={.05} side={DoubleSide}/></mesh><mesh ref={chute} position={[x,-1.25,2.25]} rotation={[-.45,0,0]}><planeGeometry args={[1.12,1.6,8,12]}/><meshBasicMaterial color="#90f7ff" transparent opacity={.02} side={DoubleSide}/></mesh><group ref={foam}>{pieces.map((piece,index)=><mesh key={index} position={[x+piece.offset,-1.37,piece.z]} rotation={[-Math.PI/2,0,index*.2]}><planeGeometry args={[piece.width+.3,.46]}/><meshBasicMaterial color={index%2?"#d8fdff":"#54dff0"} transparent opacity={.03}/></mesh>)}</group><group ref={splash} position={[x,-1.2,2.25]}>{[0,1,2].map(i=><mesh key={i} rotation={[-Math.PI/2,0,i*1.05]}><ringGeometry args={[.18+i*.08,.25+i*.12,36]}/><meshBasicMaterial color="#e1feff" transparent opacity={.02}/></mesh>)}</group></group>;
}

function Discharge({flow}:{flow:number}){return <group>{lanes.map(x=><WaterRelease key={x} x={x} openness={flow}/>)}{flow>.015&&<Sparkles position={[0,-1,2.7]} count={Math.round(25+flow*75)} scale={[6.5,1.8,3.2]} size={1.6+flow*2.5} speed={1+flow*1.8} color="#c8fbff"/>}</group>}

function FlowTracers({flow}:{flow:number}){
 const group=useRef<Group>(null),tracers=useMemo(()=>Array.from({length:24},(_,i)=>({x:lanes[i%3]+Math.sin(i*4.7)*.34,z:2.2+(i%8)*.72,speed:.72+(i%5)*.14})),[]);
 useFrame(({clock})=>{if(!group.current)return;group.current.visible=flow>.02;group.current.children.forEach((child,index)=>{const item=tracers[index],progress=(clock.elapsedTime*item.speed*(.35+flow*2.7)+item.z)%6.9;child.position.set(item.x+Math.sin(clock.elapsedTime*2+index)*.06,-1.31,2.1+progress);child.scale.z=.55+flow*1.5;((child as Mesh).material as MeshBasicMaterial).opacity=.08+flow*.62})});
 return <group ref={group}>{tracers.map((item,index)=><mesh key={index} position={[item.x,-1.31,item.z]} rotation={[Math.PI/2,0,0]}><capsuleGeometry args={[.025,.22,3,6]}/><meshBasicMaterial color={index%3===0?"#ddffff":"#43dff2"} transparent opacity={.08} blending={AdditiveBlending}/></mesh>)}</group>
}

function Dam({openness}:{openness:number}){
 const gates=useRef<Group>(null),cables=useRef<Group>(null);
 useFrame((_,delta)=>{const lift=openness*1.7;if(gates.current)gates.current.position.y=MathUtils.damp(gates.current.position.y,lift,4.5,delta);if(cables.current)cables.current.scale.y=MathUtils.damp(cables.current.scale.y,Math.max(.18,1-openness*.67),4.5,delta)});
 return <group position={[0,-.22,1.25]}><mesh position={[0,-.05,-.08]}><boxGeometry args={[9.2,3.35,1.18]}/><meshStandardMaterial color="#43565f" roughness={.86} metalness={.03}/></mesh><mesh position={[0,1.76,-.02]}><boxGeometry args={[9.65,.32,1.45]}/><meshStandardMaterial color="#73858a" roughness={.72}/></mesh>
 {[-4.15,-1.05,1.05,4.15].map(x=><group key={x}><mesh position={[x,-.02,.58]}><boxGeometry args={[.5,3.55,.46]}/><meshStandardMaterial color="#829093" roughness={.74}/></mesh><mesh position={[x,1.98,.05]}><boxGeometry args={[.25,.63,1.25]}/><meshStandardMaterial color="#486577" metalness={.36}/></mesh></group>)}
 {lanes.map(x=><group key={x}><mesh position={[x,-.42,.57]}><boxGeometry args={[1.35,2.3,.3]}/><meshStandardMaterial color="#04121b" roughness={.78}/></mesh><mesh position={[x,-1.58,.62]} rotation={[-.08,0,0]}><boxGeometry args={[1.55,.18,2.7]}/><meshStandardMaterial color="#879599" roughness={.82}/></mesh></group>)}
 <group ref={gates}>{lanes.map(x=><group key={x} position={[x,-.42,.79]}><mesh><boxGeometry args={[1.08,1.72,.22]}/><meshStandardMaterial color="#0da9c2" emissive="#035e70" emissiveIntensity={.55} metalness={.58} roughness={.2}/></mesh>{[-.34,0,.34].map(bar=><mesh key={bar} position={[bar,0,.13]}><boxGeometry args={[.06,1.55,.05]}/><meshStandardMaterial color="#a9f7ff" emissive="#1bcfe8" emissiveIntensity={.55}/></mesh>)}</group>)}</group>
 <group ref={cables} position={[0,1.15,.81]}>{lanes.map(x=><group key={x}><mesh position={[x,.1,0]}><cylinderGeometry args={[.015,.015,1.85,8]}/><meshStandardMaterial color="#bfd3d7" metalness={.9}/></mesh><mesh position={[x,.95,0]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.2,.2,.28,18]}/><meshStandardMaterial color="#ffbd4a" emissive="#9d530c" emissiveIntensity={.42} metalness={.6}/></mesh></group>)}</group>
 <mesh position={[0,2.12,.65]}><boxGeometry args={[8.3,.12,.15]}/><meshStandardMaterial color="#a7bdc3" metalness={.72}/></mesh>{[-3.7,-2.5,-1.25,0,1.25,2.5,3.7].map(x=><mesh key={x} position={[x,2.3,.65]}><boxGeometry args={[.07,.45,.1]}/><meshStandardMaterial color="#9eb5bb" metalness={.65}/></mesh>)}{[-3.9,3.9].map(x=><mesh key={x} position={[x,2.12,.78]}><sphereGeometry args={[.1,16,16]}/><meshStandardMaterial color={openness>.02?"#ffbd4a":"#3ce6a4"} emissive={openness>.02?"#ff8c28":"#16b878"} emissiveIntensity={2.4}/></mesh>)}<SensorBeacon position={[-3.7,2.72,.78]} color={openness>.02?"#ffbd4a":"#23e4f1"}/><SensorBeacon position={[3.7,2.72,.78]} color={openness>.02?"#ff6174":"#3ce6a4"}/></group>;
}


function GateLiftGuides({openness}:{openness:number}){
 const group=useRef<Group>(null);
 useFrame(({clock})=>{if(group.current){group.current.children.forEach((child,index)=>{child.rotation.y=clock.elapsedTime*(index%2?-.35:.35)})}});
 return <group ref={group} position={[0,-.05,1.95]}>
   {lanes.map((x,index)=><group key={x} position={[x,0,0]}>
     <mesh position={[0,.45,0]}><cylinderGeometry args={[.018,.018,2.85,10]}/><meshBasicMaterial color="#56e9f6" transparent opacity={.16+openness*.28}/></mesh>
     <mesh position={[0,-.75+openness*1.7,.03]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.72,.018,8,48]}/><meshBasicMaterial color={openness>.02?"#5eefff":"#3ce6a4"} transparent opacity={.22+openness*.42} blending={AdditiveBlending}/></mesh>
     <mesh position={[0,-.75+openness*1.7,.02]} rotation={[Math.PI/2,0,index*.7]}><ringGeometry args={[.42,.46,44]}/><meshBasicMaterial color="#b9fbff" transparent opacity={.08+openness*.3} side={DoubleSide}/></mesh>
   </group>)}
 </group>
}

function RainField({rain}:{rain:number}){const field=useRef<Group>(null),count=Math.min(110,20+Math.round(rain/3.5));useFrame((_,delta)=>{field.current?.children.forEach((drop,index)=>{drop.position.y-=delta*(4.4+rain/18);drop.position.x-=delta*.3;if(drop.position.y<-2){drop.position.y=6+(index%5)*.3;drop.position.x=(index*1.73)%14-7}})});if(rain<=0)return null;return <group ref={field}>{Array.from({length:count},(_,index)=><mesh key={index} position={[(index*1.73)%14-7,(index*2.31)%8-1,(index*.91)%14-7]} rotation={[0,0,.12]}><boxGeometry args={[.012,.36,.012]}/><meshBasicMaterial color="#72ddff" transparent opacity={.58}/></mesh>)}</group>}

type ViewMode="overview"|"reservoir"|"spillway";
const viewPositions:Record<ViewMode,[number,number,number]>={overview:[0,3.8,11.4],reservoir:[0,5.1,-10.8],spillway:[7.8,2.8,8.2]};
function CameraRig({view}:{view:ViewMode}){const{camera}=useThree(),goal=useRef(new Vector3(...viewPositions[view])),moving=useRef(false);useEffect(()=>{goal.current.set(...viewPositions[view]);moving.current=true},[view]);useFrame((_,delta)=>{if(!moving.current)return;camera.position.lerp(goal.current,1-Math.exp(-delta*2.7));camera.lookAt(0,-.25,.6);if(camera.position.distanceTo(goal.current)<.025)moving.current=false});return null}

function Scene({angle,rain,level,view,waterState}:{angle:number;rain:number;level:number;view:ViewMode;waterState:"safe"|"warning"|"danger"|"unavailable"}){const root=useRef<Group>(null),openness=clamp(angle/90),flow=openness*(.22+level*.78);useFrame(({pointer,clock})=>{if(root.current){const target=pointer.x*.07+Math.sin(clock.elapsedTime*.18)*.018;root.current.rotation.y+=(target-root.current.rotation.y)*.018;root.current.rotation.x+=(-pointer.y*.018-root.current.rotation.x)*.02}});return <><fog attach="fog" args={["#061724",12,31]}/><ambientLight intensity={.9}/><hemisphereLight args={["#b9efff","#172e29",1.05]}/><directionalLight position={[6,9,5]} intensity={2.9} color="#e1fbff"/><pointLight position={[0,-.2,3]} intensity={5+flow*10} distance={12} color="#19dff1"/><Stars radius={34} depth={24} count={450} factor={2}/><StormAtmosphere rain={rain} state={waterState}/><group ref={root}><ReservoirBasin level={level}/><UltrasonicGauge level={level} state={waterState}/><DownstreamChannel flow={flow}/><Dam openness={openness}/><GateLiftGuides openness={openness}/><Discharge flow={flow}/><FlowTracers flow={flow}/><RainField rain={rain}/></group><CameraRig view={view}/><OrbitControls makeDefault enablePan={false} enableZoom minDistance={8} maxDistance={15} target={[0,-.25,.6]} minPolarAngle={.7} maxPolarAngle={1.72} minAzimuthAngle={-Math.PI} maxAzimuthAngle={Math.PI} dampingFactor={.06} enableDamping/><Environment preset="night"/></>}

export default function DamScene({angle=0,rain=0,waterDistance}:{angle?:number|null;rain?:number|null;waterDistance?:number|null}){
 const{data}=useLive();
 const liveDistance=waterDistance===undefined?data?.water?.distanceCm:waterDistance;
 const host=useRef<HTMLDivElement>(null);
 const[animate,setAnimate]=useState(false);
 const[view,setView]=useState<ViewMode>("overview");
 const[tour,setTour]=useState(false);
 const[section,setSection]=useState(false);
 const[fullscreen,setFullscreen]=useState(false);
 const safeAngle=Math.max(0,Math.min(90,angle??0));
 const levelReading=waterFillFromGap(liveDistance);
 const level=levelReading??.08;
 const gateOpen=clamp(safeAngle/90);
 const flow=Math.round(gateOpen*(.22+level*.78)*100);
 const levelPercent=levelReading===null?null:Math.round(levelReading*100);
 const waterState:"safe"|"warning"|"danger"|"unavailable"=typeof liveDistance!=="number"?"unavailable":liveDistance<=12?"danger":liveDistance<=15?"warning":"safe";
 const gateLabel=gateOpen>=.89?"OPEN":gateOpen<=.02?"CLOSED":"MOVING";

 useEffect(()=>{const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;const node=host.current;if(!node||reduced){setAnimate(true);return;}const observer=new IntersectionObserver(([entry])=>setAnimate(entry.isIntersecting),{rootMargin:"140px"});observer.observe(node);return()=>observer.disconnect()},[]);
 useEffect(()=>{if(!tour||matchMedia("(prefers-reduced-motion: reduce)").matches)return;const order:ViewMode[]=["overview","reservoir","spillway"];const timer=window.setInterval(()=>setView(current=>order[(order.indexOf(current)+1)%order.length]),6200);return()=>window.clearInterval(timer)},[tour]);
 useEffect(()=>{const update=()=>setFullscreen(document.fullscreenElement===host.current);document.addEventListener("fullscreenchange",update);return()=>document.removeEventListener("fullscreenchange",update)},[]);
 const chooseView=(item:ViewMode)=>{setTour(false);setView(item)};
 const toggleFullscreen=async()=>{if(!host.current)return;if(document.fullscreenElement)await document.exitFullscreen();else await host.current.requestFullscreen()};

 return <div ref={host} className="scene dam-scene dam-scene-v2 dam-scene-v37" data-flowing={flow>2} data-risk={waterState} aria-label={`Interactive reservoir and dam model. Water sensor gap ${liveDistance??"unavailable"} centimetres. Gate angle ${safeAngle} degrees. Procedural flow intensity ${flow} percent.`}>
   <Canvas frameloop={animate?"always":"demand"} dpr={[1,1.35]} camera={{position:[0,3.8,11.4],fov:43,near:.1,far:55}} gl={{antialias:true,powerPreference:"high-performance"}}>
     <Scene angle={safeAngle} rain={rain??0} level={level} view={view} waterState={waterState}/>
   </Canvas>

   <div className="scene-topbar" aria-label="Live dam telemetry">
     <div className={`scene-status-chip ${waterState}`}><i/><span><small>Reservoir</small><b>{waterState.toUpperCase()}</b></span></div>
     <div className="scene-status-chip gate"><span><small>Gate position</small><b>{gateLabel} · {Math.round(safeAngle)}°</b></span></div>
     <div className="scene-status-chip water"><span><small>HC-SR04 air gap</small><b>{typeof liveDistance==="number"?`${liveDistance.toFixed(1)} cm`:"Unavailable"}</b></span></div>
   </div>

   <div className="scene-control-dock">
     <div className="scene-views" role="group" aria-label="3D camera view">
       {(["overview","reservoir","spillway"] as ViewMode[]).map(item=><button key={item} className={view===item?"active":""} aria-pressed={view===item} onClick={()=>chooseView(item)}>{item}</button>)}
       <button className={tour?"tour active":"tour"} aria-pressed={tour} onClick={()=>setTour(value=>!value)}>{tour?"Pause tour":"Auto tour"}</button>
     </div>
     <div className="scene-actions">
       <button aria-pressed={section} onClick={()=>setSection(value=>!value)}>{section?"Hide section":"Hydraulic section"}</button>
       <button onClick={toggleFullscreen}>{fullscreen?"Exit presentation":"Presentation mode"}</button>
     </div>
   </div>

   <div className="scene-side-hud">
     <div className="scene-gate-telemetry"><small>Gate lift</small><strong>{Math.round(gateOpen*100)}%</strong><i><span style={{width:`${Math.round(gateOpen*100)}%`}}/></i></div>
     <div className={`scene-water-level ${waterState}`}>
       <i className="scene-level-meter"><span style={{height:`${levelPercent??0}%`}}/></i>
       <div><small>Live water digital twin</small><b>{levelPercent===null?"Reading unavailable":`${levelPercent}% visual fill`}</b><em>{typeof liveDistance==="number"?`${liveDistance.toFixed(1)} cm air gap`:"Waiting for HC-SR04"}</em></div>
     </div>
     <div className={`scene-telemetry ${flow>2?"active":""}`}><i/><span><small>{flow>2?"Controlled release":"Reservoir retained"}</small><b>{flow>2?`${flow}% relative flow`:"Gates sealed"}</b></span></div>
     <div className={`scene-operation ${flow>2?"releasing":"holding"}`}><small>Hydraulic response</small><b>{flow>2?"Release follows gate lift and water head":"Water retained behind closed gates"}</b></div>
   </div>

   {section&&<aside className="hydraulic-section" aria-label="Live hydraulic cross section"><header><span>Live hydraulic section</span><b>{waterState.toUpperCase()}</b></header><div className="section-diagram"><i className="section-water" style={{height:`${levelPercent??4}%`}}/><i className="section-dam"/><i className="section-gate" style={{transform:`translateY(${-gateOpen*36}px)`}}/><i className="section-release" style={{opacity:gateOpen}}/></div><dl><div><dt>Surface</dt><dd>{levelPercent===null?"—":`${levelPercent}%`}</dd></div><div><dt>Gate lift</dt><dd>{Math.round(gateOpen*100)}%</dd></div><div><dt>Visual flow</dt><dd>{flow}%</dd></div></dl><p>Visualization follows live sensor distance and gate angle. Flow is a relative visual indicator, not a measured discharge rate.</p></aside>}

   <div className="scene-sensor-badge"><i/><span><small>HC-SR04</small><b>Beam follows live surface</b></span></div>
   <div className="scene-orientation" aria-hidden><span>Upstream</span><i/><span>Dam</span><i/><span>Downstream</span></div>
   <span className="scene-hint">Drag to orbit · scroll to zoom</span>
 </div>
}
