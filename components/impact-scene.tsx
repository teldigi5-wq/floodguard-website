"use client";
import {Canvas,useFrame} from "@react-three/fiber";
import {Edges,OrbitControls,Sparkles,Stars} from "@react-three/drei";
import {useReducedMotion} from "framer-motion";
import {useMemo,useRef} from "react";
import {Group,Mesh,Shape} from "three";
import {SRI_LANKA_OUTLINE} from "@/data/sri-lanka-outline";

const events=[
 {year:"2003",deaths:"265",affected:"176,028 families",intensity:.56,points:[[-.7,1.4],[-.9,.1],[-.45,-1.4]]},
 {year:"2016",deaths:"93",affected:"Almost 500,000",intensity:.46,points:[[-.8,1.3],[-.35,.8],[.1,.35]]},
 {year:"2017",deaths:"219",affected:"879,778 people",intensity:.65,points:[[-.7,1.5],[-.85,.2],[-.5,-1.45],[.2,-1.7]]},
 {year:"2025",deaths:"646",affected:"About 2.2 million",intensity:1,points:[[-.65,1.4],[.45,1.3],[.1,.25],[-.55,-.65],[.3,-1.4]]},
] as const;

function Island(){
 const shape=useMemo(()=>{const s=new Shape();const[first,...rest]=SRI_LANKA_OUTLINE;s.moveTo(first[0],first[1]);rest.forEach(([x,y])=>s.lineTo(x,y));s.closePath();return s},[]);
 return <group rotation={[-Math.PI/2,0,.035]}><mesh castShadow receiveShadow><extrudeGeometry args={[shape,{depth:.34,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.055,bevelThickness:.07}]}/><meshStandardMaterial color="#0c3945" metalness={.2} roughness={.5} emissive="#062833" emissiveIntensity={.58}/><Edges threshold={8} color="#54e8ef"/></mesh><mesh position={[0,0,.43]}><shapeGeometry args={[shape,24]}/><meshStandardMaterial color="#27715f" roughness={.66} transparent opacity={.96}/></mesh><mesh position={[-.15,-.2,.47]} scale={[.72,.72,1]}><shapeGeometry args={[shape,18]}/><meshStandardMaterial color="#3b8060" roughness={.78} transparent opacity={.28}/></mesh><mesh position={[-.2,-.34,.5]} scale={[.42,.42,1]}><shapeGeometry args={[shape,14]}/><meshStandardMaterial color="#6c9c66" roughness={.8} transparent opacity={.24}/></mesh></group>;
}

function Water({intensity}:{intensity:number}){
 const water=useRef<Mesh>(null);
 useFrame(({clock})=>{if(water.current){water.current.position.y=-.38+intensity*.22+Math.sin(clock.elapsedTime*.9)*.025;water.current.rotation.z=Math.sin(clock.elapsedTime*.18)*.01}});
 return <mesh ref={water} position={[0,-.3,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[7,80]}/><meshStandardMaterial color={intensity>.8?"#0a79a6":"#08618d"} transparent opacity={.54+intensity*.18} metalness={.25} roughness={.13}/></mesh>;
}

function Beacon({x,z,index}:{x:number;z:number;index:number}){
 const ring=useRef<Mesh>(null),light=useRef<Mesh>(null);
 useFrame(({clock})=>{const pulse=1+((clock.elapsedTime*.62+index*.23)%1)*1.8;if(ring.current){ring.current.scale.setScalar(pulse);const material=ring.current.material as {opacity:number};material.opacity=Math.max(0,.65-(pulse-1)*.32)}if(light.current)light.current.position.y=.42+Math.sin(clock.elapsedTime*2.2+index)*.12});
 return <group position={[x,.05,z]}><mesh ref={ring} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.13,.2,32]}/><meshBasicMaterial color="#ff7888" transparent opacity={.65}/></mesh><mesh ref={light} position={[0,.45,0]}><sphereGeometry args={[.085,18,18]}/><meshStandardMaterial color="#ff95a1" emissive="#ff304f" emissiveIntensity={3}/></mesh><mesh position={[0,.2,0]}><cylinderGeometry args={[.018,.055,.42,12]}/><meshBasicMaterial color="#ff6c7f" transparent opacity={.7}/></mesh></group>;
}

function Rain({intensity}:{intensity:number}){
 const field=useRef<Group>(null),count=Math.round(28+intensity*95);
 useFrame((_,delta)=>{field.current?.children.forEach((drop,index)=>{drop.position.y-=delta*(4+intensity*4);if(drop.position.y<-1){drop.position.y=5+(index%7)*.24}})});
 return <group ref={field}>{Array.from({length:count},(_,index)=><mesh key={index} position={[(index*1.71)%8-4,(index*2.43)%6-1,(index*.93)%7-3.5]} rotation={[0,0,.11]}><boxGeometry args={[.012,.3+intensity*.18,.012]}/><meshBasicMaterial color="#7cecff" transparent opacity={.32+intensity*.22}/></mesh>)}</group>;
}

function StoryWorld({active,reduced}:{active:number;reduced:boolean}){
 const root=useRef<Group>(null),event=events[active];
 useFrame(({pointer})=>{if(root.current){root.current.rotation.y+=(pointer.x*.13-root.current.rotation.y)*.025;root.current.rotation.x+=(-pointer.y*.035-root.current.rotation.x)*.025}});
 return <><fog attach="fog" args={["#020c16",8,23]}/><ambientLight intensity={.8}/><directionalLight position={[4,7,4]} intensity={2.7} color="#d6fbff"/><pointLight position={[0,3,1]} intensity={7+event.intensity*5} distance={12} color="#25ddef"/><Stars radius={25} depth={18} count={450} factor={2}/><group ref={root}><Water intensity={event.intensity}/><Island/>{event.points.map(([x,z],index)=><Beacon key={x+":"+z} x={x} z={z} index={index}/>)}</group><Rain intensity={event.intensity}/><Sparkles count={50} scale={[8,4,7]} size={1.4} speed={.35} color="#76e7f7"/><OrbitControls enablePan={false} enableZoom={false} autoRotate={!reduced} autoRotateSpeed={.3} minPolarAngle={.85} maxPolarAngle={1.55}/></>;
}

export default function ImpactScene({active}:{active:number}){
 const event=events[active],reduced=useReducedMotion()??false;
 return <div className="impact-scene" aria-label={"Geographically accurate animated 3D Sri Lanka flood story for "+event.year}><Canvas frameloop={reduced?"demand":"always"} dpr={[1,1.4]} camera={{position:[0,5.4,8.4],fov:42}} shadows gl={{antialias:true,powerPreference:"high-performance"}}><StoryWorld active={active} reduced={reduced}/></Canvas><div className="impact-scene-data"><small>Selected chapter</small><strong>{event.year}</strong><span><b>{event.deaths}</b> recorded deaths</span><span>{event.affected} affected</span></div><a className="impact-map-source" href="https://www.naturalearthdata.com/downloads/50m-cultural-vectors/" target="_blank" rel="noreferrer">Accurate Sri Lanka coastline · Natural Earth 1:50m ↗</a><div className="impact-legend"><i/> Animated event locations · not a live hazard map</div></div>;
}
