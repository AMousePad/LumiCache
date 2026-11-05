import { DEFAULT_ACCEPTABLE_DEPTH, type Settings } from "../shared";
import { validateSettings } from "../settings";
import { button,el } from "./elements";
export function policySettings(value: Settings, busy: boolean, save: (patch: Partial<Settings>) => void): HTMLElement & { setBusy(value: boolean): void } {
  const initial=validateSettings(value), draft={...initial}, root=el("div","lc-policy-settings");
  const fields:HTMLInputElement[]=[], state=el("span","lc-muted");state.setAttribute("role","status");
  const apply=button("Save settings",()=>{
    if(fields.some(input=>!input.checkValidity())) { fields.find(input=>!input.checkValidity())?.reportValidity();return; }
    const {hiddenCategories:_filters,...patch}=draft;save(patch);
  },"lc-primary");apply.dataset.setting="save";
  const update=()=>{const dirty=JSON.stringify(draft)!==JSON.stringify(initial), valid=fields.every(input=>input.checkValidity());apply.disabled=busy||!dirty||!valid;state.textContent=!valid?"Enter valid whole numbers":dirty?"Unsaved changes":"";};
  const section=(title:string)=>{const group=el("fieldset","lc-settings-group");group.append(el("legend","",title));root.append(group);return group;};
  const select=(parent:HTMLElement,key:"mode"|"overflowPlacement",title:string,options:[string,string][])=>{
    const row=el("label","lc-setting-row"), input=el("select","lc-select");input.dataset.setting=key;input.setAttribute("aria-label",title);input.disabled=busy;
    for(const [value,label] of options){const option=el("option","",label);option.value=value;input.append(option);}input.value=draft[key];
    input.addEventListener("change",()=>{Object.assign(draft,{[key]:input.value});update();});row.append(el("span","",title),input);parent.append(row);return row;
  };
  const number=(parent:HTMLElement,key:"acceptableDepth"|"acceptableTokens"|"refreshEvery"|"autoRefreshMinutes"|"autoRefreshLimit",title:string,placeholder:string)=>{const required=key!=="acceptableDepth"&&key!=="acceptableTokens";
    const row=el("label","lc-setting-row"), input=el("input","lc-number");input.type="number";input.min=required?"1":"0";input.max=key==="acceptableTokens"?"2000000":key==="autoRefreshMinutes"?"1440":key==="autoRefreshLimit"?"1000":"100000";input.step="1";input.required=required;
    input.value=draft[key]===null?"":String(draft[key]);input.placeholder=placeholder;input.disabled=busy;input.dataset.setting=key;input.setAttribute("aria-label",title);fields.push(input);
    const changed=()=>{Object.assign(draft,{[key]:input.value===""?null:Number(input.value)});update();};input.addEventListener("input",changed);input.addEventListener("change",changed);
    row.append(el("span","",title),input);parent.append(row);return row;
  };
  const toggle=(parent:HTMLElement,key:"forceConsistency"|"refreshEnabled"|"autoRefreshEnabled",title:string,subtitle:string,changed:()=>void)=>{
    const label=el("label","lc-setting-row lc-switch-row"), copy=el("span","lc-setting-copy"), input=el("input","lc-switch");
    input.type="checkbox";input.checked=draft[key];input.disabled=busy;input.setAttribute("role","switch");input.setAttribute("aria-label",title);input.dataset.setting=key;
    input.addEventListener("change",()=>{draft[key]=input.checked;changed();update();});copy.append(el("strong","",title),el("small","lc-muted",subtitle));label.append(copy,input);parent.append(label);
  };
  select(root,"mode","Cache-break behavior",[["pause","Pause and review"],["warn","Warn and send"],["off","Off"]]);
  const tail=section("Mutable tail");number(tail,"acceptableDepth","Acceptable depth",String(DEFAULT_ACCEPTABLE_DEPTH));number(tail,"acceptableTokens","History token limit","Not considered");tail.append(el("p","lc-muted",`Depth counts history messages from the most recent. Blank depth uses the default of ${DEFAULT_ACCEPTABLE_DEPTH}. A blank token limit is ignored, and a set limit co-applies with depth.`));
  const force=section("Consistency");let destination:HTMLElement,refresh:HTMLElement;
  toggle(force,"forceConsistency","Force cache consistency","Restore prior prompt content before sending.",()=>{destination.hidden=refresh.hidden=!draft.forceConsistency;});
  destination=select(force,"overflowPlacement","Move out-of-range injections",[["end","After the last message"],["boundary","At the allowed boundary"]]);destination.hidden=!draft.forceConsistency;
  refresh=section("Periodic refresh");refresh.hidden=!draft.forceConsistency;let interval:HTMLElement;
  toggle(refresh,"refreshEnabled","Allow scheduled cache breaks","Apply current prompt changes after a set number of replies.",()=>{interval.hidden=!draft.refreshEnabled;});
  interval=number(refresh,"refreshEvery","Successful replies between refreshes","20");interval.hidden=!draft.refreshEnabled;
  const idle=section("Keep Cache Warm");let idleFields:HTMLElement[]=[];
  toggle(idle,"autoRefreshEnabled","Keep Cache Warm","Periodically resends the chat's last prompt to prevent cache expiry.",()=>{idleFields.forEach(field=>{field.hidden=!draft.autoRefreshEnabled;});});
  idleFields=[number(idle,"autoRefreshMinutes","Minutes between refreshes","10"),number(idle,"autoRefreshLimit","Maximum refreshes after each reply","3"),el("p","lc-muted","Starts after a successful reply. Set the interval ~30s shorter than your provider's cache lifetime. You can also turn this on or off from the input bar drawer.")];
  idle.append(idleFields[2]!);idleFields.forEach(field=>{field.hidden=!draft.autoRefreshEnabled;});
  const actions=el("div","lc-settings-actions");actions.append(state,apply);root.append(actions);update();
  return Object.assign(root,{setBusy(value:boolean){busy=value;root.querySelectorAll<HTMLInputElement|HTMLSelectElement>("input,select").forEach(input=>{input.disabled=value;});update();}});
}
