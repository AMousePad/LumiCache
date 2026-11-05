import { describe,expect,test } from "bun:test";
import type { LlmMessageDTO } from "lumiverse-spindle-types";
import { Guard } from "../src/guard";
import { preserve,tailStart } from "../src/consistency";
import { validateSettings } from "../src/settings";
import { context } from "./fixtures";
const h=(id:number,content=`History ${id}`):LlmMessageDTO=>({role:id%2?"user":"assistant",content,__isChatHistory:true,sourceMessageId:`h${id}`,sourceIndexInChat:id});
const instruction=(content="Stable"):LlmMessageDTO=>({role:"system",content});
const force=validateSettings({mode:"pause",forceConsistency:true,acceptableDepth:0});
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
async function sent(guard:Guard,messages:LlmMessageDTO[],settings=force,success=true) { const c=context(); const result=await guard.inspect(messages,c,settings); guard.finish(c.userId,c.generationId,success);return result; }
describe("cache consistency",()=>{
 test("legacy settings migrate to blank depth, ignored token limit and opt-in mutations",()=>{
  expect(validateSettings({mode:"pause"})).toMatchObject({acceptableDepth:null,acceptableTokens:null,forceConsistency:false,refreshEnabled:true});
  for(const invalid of [{acceptableDepth:-1},{acceptableTokens:"100"},{refreshEvery:0},{forceConsistency:"true"},{hiddenCategories:["bogus"]}]) expect(()=>validateSettings({mode:"pause",...invalid})).toThrow();
  expect(validateSettings({mode:"warn",acceptableDepth:null,acceptableTokens:0}).acceptableTokens).toBe(0);
 });
 test("whole-message token bounds intersect depth, and blank tokens perform no counting",async()=>{
  const messages=[instruction(),h(1,"a".repeat(100)),h(2,"b".repeat(1000)),h(3,"c".repeat(100))];
  const count=async(m:LlmMessageDTO[])=>({total_tokens:m.reduce((n,x)=>n+String(x.content).length,0),approximate:true});
  expect(await tailStart(messages,validateSettings({mode:"pause",acceptableTokens:200}),context(),count)).toEqual({index:3,approximate:true});
  expect((await tailStart(messages,validateSettings({mode:"pause"}),context(),async()=>{throw Error("must not count");})).index).toBe(2);
 });
 test("out-of-range injections move to the end or allowed boundary, retaining order",async()=>{
  const input=[instruction(),h(1),instruction("A"),instruction("B"),...Array.from({length:7},(_,i)=>h(i+2))];
  const end=await preserve(null,input,validateSettings({...force,acceptableDepth:2}),context());
  expect(end.messages.slice(-2).map(m=>m.content)).toEqual(["A","B"]);expect(end.relocated).toBe(2);
  const boundary=await preserve(null,input,validateSettings({...force,acceptableDepth:2,overflowPlacement:"boundary"}),context());
  expect(boundary.messages.slice(-4).map(m=>m.content)).toEqual(["A","B","History 7","History 8"]);
 });
 test("strict mode restores instructions, edits, deletions, order and multimodal data without editing inputs",async()=>{
  const guard=new Guard(()=>{}), media=h(2);media.content=[{type:"image",mime_type:"image/png",data:"original-data"}];
  const baseline=await sent(guard,[instruction(),h(1),media,instruction("Original injection")]);
  const current=[instruction("New instructions"),h(1,"Edited"),h(3),h(4),instruction("Fresh injection")];
  const copy=structuredClone(current), output=await sent(guard,current);
  expect(output.slice(0,baseline.length)).toEqual(baseline);
  expect(output.slice(baseline.length).map(m=>m.content)).toEqual(["History 3","History 4","Fresh injection"]);
  expect(current).toEqual(copy);
  const again=await sent(guard,current);expect(again).toEqual(output);
 });
 test("history stays immutable inside the tolerated tail, while its injection may move",async()=>{
  const guard=new Guard(()=>{}), policy=validateSettings({...force,acceptableDepth:1});
  await sent(guard,[instruction(),h(1),instruction("I"),h(2)],policy);
  const output=await sent(guard,[instruction("Changed"),h(1,"edit"),h(2,"edit"),h(3),instruction("I"),h(4)],policy);
  expect(output.map(m=>m.content)).toEqual(["Stable","History 1","History 2","History 3","I","History 4"]);
  expect(guard.view("user","chat").check?.policy?.accepted).toBe(true);
 });
 test("monitoring tolerates moving guidance but still pauses edited history",async()=>{
  const guard=new Guard(()=>{}), policy=validateSettings({mode:"pause",acceptableDepth:1});
  await sent(guard,[instruction(),h(1),instruction("I"),h(2)],policy);
  await sent(guard,[instruction(),h(1),h(2),h(3),instruction("I"),h(4)],policy);
  expect(guard.view("user","chat").check?.policy?.action).toBe("tolerated");
  const c=context(), pending=guard.inspect([instruction(),h(1),h(2),h(3),instruction("I"),h(4,"edit")],c,policy);await flush();
  const check=guard.view("user","chat").check!;expect(check.status).toBe("waiting");guard.decide("user","browser",check.id,false);await expect(pending).rejects.toThrow();
 });
 test("periodic refresh counts successful replies, not failures or dry runs",async()=>{
  const guard=new Guard(()=>{}), policy=validateSettings({...force,refreshEnabled:true,refreshEvery:2});
  await sent(guard,[instruction(),h(1)],policy);
  await sent(guard,[instruction("Changed"),h(1),h(2)],policy,false);
  await guard.inspect([instruction("Changed"),h(1)],context({isDryRun:true}),policy);
  const second=await sent(guard,[instruction("Changed"),h(1),h(2)],policy);expect(second[0].content).toBe("Stable");
  await sent(guard,[instruction("Changed"),h(1,"edit"),h(2),h(3)],policy,false);expect(guard.view("user","chat").check?.policy?.action).toBe("refresh");
  const refresh=await sent(guard,[instruction("Changed"),h(1,"edit"),h(2),h(3)],policy);expect(refresh[0].content).toBe("Changed");
  const fourth=await sent(guard,[instruction("Next change"),h(1,"later"),h(2),h(3),h(4)],policy);expect(fourth[0].content).toBe("Changed");expect(fourth[1].content).toBe("edit");
 });
 test("the newest message always reaches the model at any depth, while older edits stay frozen",async()=>{
  for(const acceptableDepth of [0,2]){
   const policy=validateSettings({...force,mode:"warn",acceptableDepth});
   const edited=new Guard(()=>{});await sent(edited,[instruction(),h(1),h(2),h(3)],policy);
   expect((await sent(edited,[instruction(),h(1,"later"),h(2),h(3,"OOC")],policy)).map(m=>m.content)).toEqual(["Stable","History 1","History 2","OOC"]);
   const replaced=new Guard(()=>{});await sent(replaced,[instruction(),h(1),h(2),h(3)],policy);
   const swap:LlmMessageDTO={...h(3,"OOC"),sourceMessageId:"fresh"};
   for(let swipe=0;swipe<2;swipe++) expect((await sent(replaced,[instruction(),h(1),h(2),swap],policy)).map(m=>m.content)).toEqual(["Stable","History 1","History 2","OOC"]);
   const rewound=new Guard(()=>{});await sent(rewound,[instruction(),h(1),h(2),h(3)],policy);
   expect((await sent(rewound,[instruction(),h(1)],policy)).map(m=>m.content)).toEqual(["Stable","History 1"]);
  }
 });
 test("an edited or swiped message frees itself and everything newer, and only older messages stay frozen",async()=>{
  for(const acceptableDepth of [0,2]){
   const policy=validateSettings({...force,mode:"warn",acceptableDepth}), guard=new Guard(()=>{});
   const contents=(m:LlmMessageDTO[])=>m.map(x=>x.content);
   const changed=[instruction("Changed"),h(1,"old edit"),h(2,"swiped"),h(3,"later edit"),h(4,"newest")];
   await sent(guard,[instruction(),h(1),h(2),h(3),h(4,"newest")],policy);
   expect(contents(await sent(guard,changed,policy))).toEqual(["Stable","History 1","History 2","History 3","newest"]);
   guard.release("user","chat","h1");guard.release("user","chat","missing");
   const same=[instruction(),h(1),h(2,"swiped"),h(3),h(4,"newest")];
   expect(contents(await sent(guard,same,policy))).toEqual(["Stable","History 1","History 2","History 3","newest"]);
   guard.release("user","chat","h2");
   const expected=["Stable","History 1","swiped","later edit","newest"];
   expect(contents(await sent(guard,changed,policy,false))).toEqual(expected);
   expect(contents(await sent(guard,changed,policy))).toEqual(expected);
   expect(contents(await sent(guard,[instruction(),h(1),h(2,"again"),h(3),h(4,"newest")],policy))).toEqual(expected);
  }
 });
 test("leaving an epoch releases the frozen prompt once and brings the timed refresh back",async()=>{
  const guard=new Guard(()=>{}), policy=validateSettings({...force,refreshEnabled:true,refreshEvery:100});
  const send=async(messages:LlmMessageDTO[],epoch:string|null)=>{const c=context();const out=await guard.inspect(messages,c,policy,epoch);guard.finish(c.userId,c.generationId,true);return out[0].content;};
  await send([instruction("Codex"),h(1)],"codex:1");
  expect(await send([instruction("No codex"),h(1)],"no-codex:1")).toBe("No codex");
  expect(await send([instruction("Mode off"),h(1)],null)).toBe("Mode off");
  expect(await send([instruction("Frozen again"),h(1)],null)).toBe("Mode off");
  expect(await send([instruction("Mode on"),h(1)],"codex:")).toBe("Mode on");
 });
 test("missing history identity fails closed and releases the busy state",async()=>{
  const guard=new Guard(()=>{});await expect(sent(guard,[{role:"user",content:"No identity",__isChatHistory:true}])).rejects.toThrow("source message IDs");
  await sent(guard,[instruction(),h(1)]);
 });
 test("a connection change still requires review, even when a refresh is due",async()=>{
  const guard=new Guard(()=>{}), policy=validateSettings({...force,refreshEnabled:true,refreshEvery:1});await sent(guard,[instruction(),h(1)],policy);
  const base=context(), c=context({mainDispatch:{...base.mainDispatch,descriptor:{...base.mainDispatch.descriptor!,model:"different"}}});
  const pending=guard.inspect([instruction("New"),h(1)],c,policy);await flush();const check=guard.view("user","chat").check!;
  expect(check.status).toBe("waiting");guard.decide("user","browser",check.id,false);await expect(pending).rejects.toThrow();
 });
});
