import { createApp, h, ref } from 'vue';
import CaptureAreaWorkspace from '../../src/renderer/src/components/CaptureAreaWorkspace.vue';
const frame = document.createElement('canvas'); frame.width=1000; frame.height=600;
const ctx = frame.getContext('2d')!;
ctx.fillStyle='#182b35'; ctx.fillRect(0,0,1000,600); ctx.fillStyle='#53636d'; ctx.fillRect(0,300,1000,300);
ctx.strokeStyle='#83919a'; for(let i=0;i<12;i++){ctx.beginPath();ctx.moveTo(500,300);ctx.lineTo(i*100,600);ctx.stroke();}
const state=ref<any>({runId:'fixture-run',mode:'off',availability:'inactive',calibrationVersion:1,roiVersion:0,floorHeight:0,worldAxes:'XZ',worldPolygon:[],worldSegments:[],source:null,
 cameras:[{cameraId:7,streamId:0,label:'Left camera',deviceKey:'left',width:1000,height:600,segments:[],position:[0,2,0],rotation:[1,0,0,0,-1,0,0,0,-1],intrinsics:[500,0,500,0,500,300,0,0,1]},{cameraId:9,streamId:1,label:'Right camera',deviceKey:'right',width:1000,height:600,segments:[],position:[2,2,0],rotation:[1,0,0,0,-1,0,0,0,-1],intrinsics:[500,0,500,0,500,300,0,0,1]}]});
const rotation=ref(0);
(window as any).testRotation=(value:number)=>rotation.value=value;
(window as any).testRecalibrate=()=>state.value={...state.value,calibrationVersion:state.value.calibrationVersion+1,availability:'needs_review'};
(window as any).testApplied=0;
function response(edit:any){
 const polygon=edit.mode==='automatic'?[[-2,-8],[3,-8],[3,-2],[-2,-2]]:edit.worldPolygon??[];
 const worldSegments=polygon.map((p:any,i:number,all:any)=>[...p,...all[(i+1)%all.length]]);
 return {...state.value,mode:edit.mode,worldPolygon:polygon,worldSegments,source:null,availability:edit.mode==='off'?'inactive':'active',cameras:state.value.cameras.map((c:any)=>{
  const project=(x:number,z:number)=>[500+(x-c.position[0])*500/-z,300+1000/-z];
  return {...c,segments:worldSegments.map((s:any)=>[...project(s[0],s[1]),...project(s[2],s[3])])};
 })};
}
const positions:number[]=[],colors:number[]=[];
for(let x=-3;x<=4;x+=.08)for(let z=-9;z<=1;z+=.08){positions.push(x,.02,z);colors.push(80+Math.round((x+3)*10),105,120);}
for(let x=-3;x<=4;x+=.08)for(let y=0;y<3;y+=.08){positions.push(x,y,-9);colors.push(155,130,95);}
(window as any).testSceneLoads=0;
(window as any).irisStarter={roiScene:async(key:any)=>{
 (window as any).testSceneLoads++;
 if(key.calibrationVersion!==1)return {ok:false,error:'Scene is stale after recalibration'};
 return {ok:true,scene:{...key,positions:new Float32Array(positions),colors:new Uint8Array(colors),originalPointCount:positions.length/3}};
},roiPreview:async(edit:any)=>({ok:true,state:response(edit)}),roiApply:async(edit:any)=>{
 (window as any).testApplied++; (window as any).testLastEdit=edit; const next=response(edit);next.roiVersion++;return {ok:true,state:next};
}};
(window as any).testDisconnect=()=>state.value=null;
createApp({setup:()=>()=>h(CaptureAreaWorkspace,{state:state.value,saved:null,error:'',getFrame:()=>frame,rotationFor:()=>rotation.value,onApplied:(v:any)=>state.value=v})}).mount('#app');
