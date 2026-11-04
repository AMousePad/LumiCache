import { afterAll,beforeAll,expect,test } from "bun:test";
import { Window } from "happy-dom";
import { policySettings } from "../src/ui/settings";
import { filtered,healthPill,renderFindings } from "../src/ui/findings";
import { classifyDepth } from "../src/health/depth";
import { validateSettings } from "../src/settings";
import type { Finding,HealthReport } from "../src/health/types";
import type { Classification,Settings } from "../src/shared";
const window=new Window(), old=globalThis.document;
beforeAll(()=>{globalThis.document=window.document as unknown as Document;});
afterAll(()=>{globalThis.document=old;window.happyDOM.abort();});
const rows:Finding[]=[{id:"safe",category:"Depth Mutable",group:"Preset · Main",item:"Recent note",level:"depth",depth:5,title:"Depth 5",source:"Preset",detail:"",suggestion:"",problematic:false},
 {id:"bad",category:"Depth Mutable",group:"World info · Lore",item:"Deep note",level:"depth",depth:6,title:"Depth 6",source:"World info",detail:"",suggestion:"",problematic:true},
 {id:"risk",category:"Regex",level:"risk",title:"Runtime operation",source:"Regex",detail:"",suggestion:""},
 {id:"issue",category:"World info",level:"issue",title:"Keyword activation",source:"World info",detail:"",suggestion:""}];
test("settings display depth five and blank token cap, and preserve explicit zero",()=>{
 const patches:Partial<Settings>[]=[]; const root=policySettings({mode:"pause"},false,p=>patches.push(p));
 const depth=root.querySelector<HTMLInputElement>('[aria-label="Acceptable depth"]')!, tokens=root.querySelector<HTMLInputElement>('[aria-label="History token limit"]')!;
 expect(depth.value).toBe("5");expect(tokens.value).toBe("");expect(root.querySelector<HTMLInputElement>('[role="switch"]')!.checked).toBe(false);
 tokens.value="0";tokens.dispatchEvent(new window.Event("change") as unknown as Event);(root.querySelector("button") as HTMLButtonElement).click();expect(patches.at(-1)).toMatchObject({acceptableTokens:0});
 tokens.value="";tokens.dispatchEvent(new window.Event("change") as unknown as Event);depth.value="4";depth.dispatchEvent(new window.Event("change") as unknown as Event);(root.querySelector("button") as HTMLButtonElement).click();expect(patches.at(-1)).toMatchObject({acceptableTokens:null});
 root.setBusy(true);expect(depth.disabled).toBe(true);root.setBusy(false);expect(depth.value).toBe("4");expect(depth.disabled).toBe(false);
 depth.value="-1";depth.dispatchEvent(new window.Event("change") as unknown as Event);expect(patches).toHaveLength(2);
});
test("pill categories are independent accessible toggles; disabled filters leave counts intact",()=>{
 let hidden:Classification[]=[];
 const toggle=(category:Classification)=>{hidden=hidden.includes(category)?hidden.filter(c=>c!==category):[...hidden,category];};
 const pill=healthPill(rows,false,hidden,toggle);const buttons=Array.from(pill.querySelectorAll("button"));
 expect(buttons.map(b=>b.getAttribute("aria-pressed"))).toEqual(["true","true","true","true"]);
 buttons[2].click();expect(filtered(rows,hidden).map(r=>r.id)).toEqual(["risk","issue"]);
 const next=healthPill(rows,false,hidden,toggle);expect(next.textContent).toContain("2 Depth Mutable");expect(next.querySelector('[data-focus="filter-depth"]')!.getAttribute("aria-pressed")).toBe("false");
 buttons[0].click();buttons[1].click();expect(filtered(rows,hidden)).toEqual([]);
 (next.querySelector('[data-focus="filter-depth"]') as HTMLButtonElement).click();expect(filtered(rows,hidden).map(r=>r.id)).toEqual(["safe","bad"]);
});
test("depth findings keep hierarchy and provide a green tick or red X with accessible meaning",()=>{
 const root=renderFindings(rows,new Set(["Depth Mutable"]));
 expect(root.querySelector(".lc-depth-group .lc-group-name")!.textContent).toBe("Depth Mutable");
 expect(root.querySelectorAll(".lc-depth-pass")).toHaveLength(1);expect(root.querySelectorAll(".lc-depth-fail")).toHaveLength(1);
 expect(root.querySelector(".lc-depth-pass")!.getAttribute("aria-label")).toBe("Within configured tolerance");
 expect(root.textContent).toContain("Preset · Main");expect(root.textContent).toContain("World info · Lore");
});
test("depth classification applies custom limits and treats unverified token positions as problematic",async()=>{
 const report:HealthReport={chatId:"chat",at:0,preset:"Main",model:"model",provider:"test",findings:structuredClone(rows),entriesScanned:0,blocksScanned:2};
 await classifyDepth(report,{mode:"pause",acceptableDepth:6},[]);expect(report.findings.filter(r=>r.level==="depth").every(r=>!r.problematic)).toBe(true);
 await classifyDepth(report,{mode:"pause",acceptableDepth:6,acceptableTokens:100},[]);expect(report.findings.filter(r=>r.level==="depth").every(r=>r.problematic)).toBe(true);
 const history=Array.from({length:8},()=>({role:"user" as const,content:"text",__isChatHistory:true}));
 await classifyDepth(report,{mode:"pause",acceptableDepth:6,acceptableTokens:100},history,{tokens:{countMessages:async (m:unknown[])=>({total_tokens:m.length*20,approximate:true})}} as never);
 expect(report.findings[0]).toMatchObject({problematic:false,depthTokens:100,tokenEstimate:true});expect(report.findings[1]).toMatchObject({problematic:true,depthTokens:120});
});
test("Variabled gets its own filter, section and blue marks, and is not counted as a risk or issue", () => {
  const checks: Finding[] = [{ id: "plain", category: "Variabled", group: "Preset · Main", groupId: "Preset:main", item: "Style", level: "variabled", title: "Variable check", source: "Preset", detail: "", suggestion: "" }];
  const hiddenNone = healthPill(checks, false, [], () => {});
  expect(hiddenNone.textContent).toContain("0 Risks"); expect(hiddenNone.textContent).toContain("0 Issues"); expect(hiddenNone.textContent).toContain("1 Variabled");
  expect(hiddenNone.querySelector('[data-focus="filter-variabled"]')!.className).toContain("lc-variabled-ink");
  expect(filtered(checks, ["variabled"])).toEqual([]); expect(filtered(checks, ["risk", "issue", "depth"])).toEqual(checks);
  const root = renderFindings(checks, new Set(["Variabled"]));
  expect(root.querySelector(".lc-variabled-group .lc-group-name")!.textContent).toBe("Variabled");
  expect(root.querySelector(".lc-count-variabled")).not.toBeNull(); expect(root.querySelector(".lc-dot-variabled")).not.toBeNull();
  expect(validateSettings({ mode: "warn", hiddenCategories: ["variabled"] }).hiddenCategories).toEqual(["variabled"]);
});
