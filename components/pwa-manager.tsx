"use client";
import {useEffect} from "react";
export function PwaManager(){
  useEffect(()=>{
    if("caches" in window){caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key)))).catch(()=>undefined);}
    if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(regs=>Promise.all(regs.map(reg=>reg.unregister()))).catch(()=>undefined);}
  },[]);
  return null;
}
