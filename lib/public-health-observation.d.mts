/** Source-unverified public device/collector display only. */
export interface PublicEspObservation {
 readonly label:string; readonly state:string; readonly signalDbm:number|null;
 readonly physicalLinkVerified:false; readonly deviceIdentityVerified:false;
}
export interface PublicRainObservation {
 readonly category:string; readonly categoryLabel:string;
 readonly currentMm:number|null; readonly dailyMm:number|null;
 readonly waterDepthCm:number|null; readonly adcValue:number|null;
 readonly gaugeWeightGrams:null; readonly gaugeLabel:string;
 readonly sensorLabel:string; readonly calibrationLimited:boolean;
 readonly calibrationLabel:string; readonly physicalRainVerified:false;
 readonly calibratedMeasurementVerified:false; readonly canDeclareNormal:false;
 readonly canSendAlert:false;
}
export declare function describePublicEspObservation(input?:Readonly<{
 esp?:unknown; inventory?:unknown; freshness?:string;
}>):PublicEspObservation;
export declare function describePublicRainObservation(input?:Readonly<{
 rain?:unknown; device?:unknown; freshness?:string;
}>):PublicRainObservation;
