import type {FirebaseApp,FirebaseOptions} from "firebase/app";

export declare const PUBLIC_MONITOR_APP_NAME: "floodguard-public-monitor";
export declare function getScopedPublicMonitorApp(args:{
  databaseURL:string;
  getApps:()=>FirebaseApp[];
  initializeApp:(options:FirebaseOptions,name?:string)=>FirebaseApp;
}):FirebaseApp;
