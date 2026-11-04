import assert from "node:assert/strict";
import type { Operations } from "../src/shared";
type API=(path:string,method?:string,body?:unknown,allow404?:boolean)=>Promise<any>;
export async function testConsistencyHost({api,rpc,connectionId,requests,pass}:{api:API;rpc:<K extends keyof Operations>(operation:K,input:Operations[K]["input"])=>Promise<Operations[K]["output"]>;connectionId:string;requests:unknown[];pass(message:string):void}) {
 const character=await api("/api/v1/characters","POST",{name:"Consistency fixture",first_mes:"Original opening."});
 const chat=await api("/api/v1/chats","POST",{character_id:character.id,name:"Frozen prefix verification"});
 const base={enabled:true,role:"system",position:"pre_history",depth:0,isLocked:false,color:null,injectionTrigger:[],group:null};
 const preset=await api("/api/v1/presets","POST",{name:"Consistency fixture",provider:"loom",prompt_order:[
  {...base,id:"system",name:"Frozen instructions",content:"ORIGINAL INSTRUCTIONS",marker:null},
  {...base,id:"history",name:"History",content:"",marker:"chat_history"},
  {...base,id:"note",name:"Moving note",content:"MOVING NOTE",marker:null,position:"in_history",depth:2},
 ]});
 await api(`/api/v1/preset-profiles/chat/${chat.id}`,"PUT",{preset_id:preset.id,block_states:{}});
 for(let i=0;i<6;i++) await api(`/api/v1/chats/${chat.id}/messages`,"POST",{is_user:i%2===0,name:i%2===0?"User":"Assistant",content:`Original history ${i}.`});
 const settings={mode:"pause" as const,forceConsistency:true,acceptableDepth:0,acceptableTokens:null,overflowPlacement:"end" as const,refreshEnabled:true,refreshEvery:2};
 await rpc("settings",settings);
 async function generate(content:string) {
  await api(`/api/v1/chats/${chat.id}/messages`,"POST",{is_user:true,name:"User",content});
  await api("/api/v1/generate","POST",{chat_id:chat.id,connection_id:connectionId,preset_id:preset.id,generation_type:"normal"});
  const deadline=Date.now()+30000;
  while((await api(`/api/v1/generate/status/${chat.id}`)).active) { if(Date.now()>deadline)throw Error("Consistency host generation did not finish");await Bun.sleep(25); }
  const view=await rpc("load",{chatId:chat.id});assert.equal(view.check?.status,"completed",JSON.stringify(view.check));return requests.at(-1) as any;
 }
 const first=await generate("First immutable request.");
 assert.equal(first.messages.at(-1).content,"MOVING NOTE");
 pass("force consistency relocates native depth guidance after the last message");
 const before=await api(`/api/v1/chats/${chat.id}/messages?full=true`), edited=before.data.find((m:any)=>m.content==="Original history 0.");
 assert(edited);await api(`/api/v1/chats/${chat.id}/messages/${edited.id}`,"PUT",{content:"VISIBLE EDIT"});
 const current=await api(`/api/v1/presets/${preset.id}`);current.prompt_order[0].content="UPDATED INSTRUCTIONS";
 await api(`/api/v1/presets/${preset.id}`,"PUT",{expected_cache_revision:current.cache_revision,prompt_order:current.prompt_order});
 const second=await generate("Second immutable request.");
 assert.deepEqual(second.messages.slice(0,first.messages.length),first.messages,"provider-facing frozen prefix changed");
 assert((await api(`/api/v1/chats/${chat.id}/messages?full=true`)).data.some((m:any)=>m.id===edited.id&&m.content==="VISIBLE EDIT"));
 pass("real host preserves the entire prior provider prompt while visible chat and preset edits remain untouched");
 const third=await generate("Scheduled refresh request.");
 assert(JSON.stringify(third.messages).includes("UPDATED INSTRUCTIONS"));assert(JSON.stringify(third.messages).includes("VISIBLE EDIT"));
 assert.equal((await rpc("load",{chatId:chat.id})).check?.policy?.action,"refresh");
 pass("scheduled refresh applies pending edits after exactly two successful native replies");
 await rpc("settings",{mode:"pause",acceptableDepth:5,acceptableTokens:null});
 let health=await rpc("audit",{chatId:chat.id,connectionId});
 assert(health.findings.some(f=>f.id==="depth-note"&&f.level==="depth"&&!f.problematic));
 await rpc("settings",{mode:"pause",acceptableDepth:1,acceptableTokens:null});health=await rpc("audit",{chatId:chat.id,connectionId});
 assert(health.findings.some(f=>f.id==="depth-note"&&f.problematic));
 pass("native health classifies depth guidance against the configured tolerance");
 await rpc("settings",{mode:"pause",acceptableDepth:5,acceptableTokens:0});health=await rpc("audit",{chatId:chat.id,connectionId});
 assert(health.findings.some(f=>f.id==="depth-note"&&f.problematic));
 pass("optional token limits never report an out-of-range or unverifiable depth as acceptable");
 await rpc("settings",{mode:"pause"});
 return {chatId:chat.id,presetId:preset.id};
}
