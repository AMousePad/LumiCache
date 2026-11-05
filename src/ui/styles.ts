export const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg>`;
export const STYLES = `
:has(> div > [data-spindle-drawer-tab] > .lc-root) { padding-top:0!important; padding-left:0!important; padding-right:0!important; }
[data-spindle-drawer-tab]:has(> .lc-root) { height:100%; min-height:0; }
.lc-root {
  --lc-text:var(--lumiverse-text,#eee9f3); --lc-muted:var(--lumiverse-text-muted,#b7afc5);
  --lc-accent:var(--lumiverse-primary-text,var(--lumiverse-primary,#b9a2ed)); --lc-primary:var(--lumiverse-primary,#b9a2ed);
  --lc-bg:var(--lumiverse-bg,#15121c); --lc-panel:var(--lumiverse-bg-elevated,#211c29);
  --lc-line:var(--lumiverse-border,#38323f); --lc-soft:color-mix(in srgb,var(--lc-text) 5%,var(--lc-bg));
  --lc-risk:color-mix(in srgb,var(--lc-text) 55%,var(--lumiverse-warning,#d8aa55));
  --lc-issue:color-mix(in srgb,var(--lc-text) 35%,var(--lumiverse-danger,#e78898));
  color:var(--lc-text); background:var(--lc-bg); font:13px/1.5 var(--lumiverse-font-family,system-ui,sans-serif);
  display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; container-type:inline-size;
}
.lc-root *, .lc-root *::before, .lc-root *::after { box-sizing:border-box; }
.lc-root [hidden] { display:none!important; }
.lc-root h3 { font-size:14px; font-weight:600; letter-spacing:-.2px; margin:0; }
.lc-root p { margin:8px 0; }
.lc-root .lc-muted { color:var(--lc-muted); font-size:11px; line-height:1.6; }
.lc-icon { width:17px; height:17px; flex:none; }
.lc-app-toolbar { display:flex; align-items:center; gap:8px; flex:none; padding:12px; border-bottom:1px solid var(--lc-line); }
.lc-tabs { display:flex; flex:1; min-width:0; gap:3px; padding:3px; border:1px solid color-mix(in srgb,var(--lc-line) 75%,transparent); border-radius:13px; background:var(--lc-soft); }
.lc-button,.lc-select { font:inherit; color:inherit; border:1px solid var(--lc-line); background:var(--lc-panel); border-radius:10px; padding:8px 12px; line-height:1.35; }
.lc-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; cursor:pointer; min-height:36px; transition:background .15s,border-color .15s,color .15s; }
.lc-button:hover:not(:disabled) { border-color:var(--lc-accent); background:color-mix(in srgb,var(--lc-accent) 8%,var(--lc-panel)); }
.lc-button:disabled { opacity:.5; cursor:default; }
.lc-tab { flex:1; padding:8px 5px; min-height:36px; background:transparent; border-color:transparent; font-size:12px; font-weight:550; color:var(--lc-muted); white-space:nowrap; }
.lc-tab[aria-selected=true] { color:var(--lc-accent); background:var(--lc-panel); border-color:color-mix(in srgb,var(--lc-accent) 22%,var(--lc-line)); box-shadow:0 1px 5px #00000015; }
.lc-icon-button { width:36px; padding:8px; border-color:transparent; background:transparent; flex:none; color:var(--lc-muted); }
.lc-icon-button[aria-expanded=true] { color:var(--lc-accent); background:var(--lc-soft); }
.lc-primary { color:var(--lumiverse-primary-contrast,#191220); background:var(--lc-primary); border-color:transparent; font-weight:600; }
.lc-primary:hover:not(:disabled) { color:var(--lumiverse-primary-contrast,#191220); background:var(--lc-primary); filter:brightness(1.08); }
.lc-quiet-button { background:transparent; border-color:transparent; color:var(--lc-muted); font-size:11px; padding:7px 9px; }
.lc-text-button { border-color:transparent; background:transparent; color:var(--lc-accent); font-size:12px; }
.lc-root :is(button,input,select,summary,[tabindex]):focus-visible { outline:2px solid var(--lc-accent); outline-offset:3px; }
.lc-content:focus-visible { outline-offset:-3px!important; }
.lc-content { flex:1; min-width:0; min-height:0; overflow:auto; padding:18px 14px 28px; scrollbar-width:thin; scrollbar-color:var(--lc-line) transparent; }
.lc-app-error { padding:0 14px; flex:none; }
.lc-app-error:empty { display:none; }
.lc-settings { flex:none; padding:12px 16px; border-bottom:1px solid var(--lc-line); background:var(--lc-soft); max-height:65%; overflow:auto; scrollbar-width:thin; }
.lc-policy-settings { display:grid; gap:14px; }
.lc-settings-actions { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.lc-root .lc-count-depth { color:var(--lc-muted); background:var(--lc-soft); }
.lc-settings-group { min-width:0; margin:0; padding:12px; border:1px solid var(--lc-line); border-radius:12px; display:grid; gap:12px; }
.lc-settings-group legend { color:var(--lc-muted); font-size:11px; font-weight:600; padding:0 6px; }
.lc-setting-copy { display:flex; flex-direction:column; gap:3px; min-width:0; }
.lc-setting-copy strong { font-weight:550; }
.lc-setting-row > span { min-width:0; }
.lc-setting-row > select { max-width:55%; }
.lc-number { width:112px; flex:none; font:inherit; color:var(--lc-text); background:var(--lc-panel); border:1px solid var(--lc-line); border-radius:8px; padding:8px; }
.lc-number::placeholder { font-size:10px; color:var(--lc-muted); opacity:1; }
.lc-switch { appearance:none; width:36px; height:22px; flex:none; border:1px solid var(--lc-line); border-radius:20px; background:var(--lc-panel); position:relative; cursor:pointer; transition:background .15s; }
.lc-switch::after { content:""; position:absolute; width:14px; height:14px; border-radius:50%; top:3px; left:3px; background:var(--lc-muted); transition:transform .15s; }
.lc-switch:checked { background:var(--lc-primary); border-color:var(--lc-primary); }
.lc-switch:checked::after { transform:translateX(14px); background:var(--lumiverse-primary-contrast,#191220); }
.lc-switch:disabled { opacity:.5; cursor:default; }
.lc-policy-status { font-size:11px; color:var(--lc-accent); padding:9px 12px; background:var(--lc-soft); border-radius:10px; }
.lc-setting-row { display:flex; align-items:center; gap:10px; justify-content:space-between; font-size:12px; }
.lc-select { min-width:0; max-width:100%; font-size:12px; padding:8px; }
.lc-select option { background:var(--lc-panel); color:var(--lc-text); }
.lc-section-toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:18px; min-height:36px; }
.lc-health-pill { display:inline-flex; align-items:center; flex-wrap:wrap; gap:2px; max-width:100%; padding:4px; border:1px solid var(--lc-line); border-radius:20px; background:var(--lc-soft); font-size:12px; font-weight:550; font-variant-numeric:tabular-nums; }
.lc-pill-toggle { border:0; border-radius:16px; background:transparent; padding:7px 9px; min-height:34px; font-size:11px; }
.lc-pill-toggle[aria-pressed=false] { opacity:.5; text-decoration:line-through; }
.lc-pill-toggle[aria-pressed=true] { background:var(--lc-panel); box-shadow:0 1px 3px #00000012; }
.lc-pill-part { padding:5px 8px; }
.lc-depth-ink,.lc-depth-group .lc-group-icon { color:var(--lc-muted); }
.lc-count-depth { color:var(--lc-muted); background:var(--lc-soft); }
.lc-depth-status { display:inline-flex; flex:none; margin-top:1px; }
.lc-depth-status .lc-icon { width:16px; height:16px; stroke-width:2; }
.lc-depth-fail { color:var(--lumiverse-danger,#e78898); }
.lc-depth-pass { color:var(--lumiverse-success,#79c99e); }
.lc-pill-divider { color:var(--lc-line); font-weight:400; }
.lc-pill-part { white-space:nowrap; }
.lc-risk-ink { color:var(--lc-risk); }
.lc-variabled-ink,.lc-variabled-group .lc-group-icon { color:#5b9dff; }
.lc-dot-variabled { background:#5b9dff; }
.lc-count-variabled { color:#5b9dff; background:color-mix(in srgb,#5b9dff 14%,transparent); }
.lc-issue-ink { color:var(--lc-issue); }
.lc-updating { opacity:.65; }
.lc-health-pending { font-size:12px; color:var(--lc-muted); padding:9px 0; }
.lc-groups { display:flex; flex-direction:column; gap:10px; }
.lc-group { border:1px solid var(--lc-line); border-radius:13px; background:color-mix(in srgb,var(--lc-panel) 55%,var(--lc-bg)); overflow:hidden; }
.lc-root summary { cursor:pointer; list-style:none; }
.lc-root summary::-webkit-details-marker { display:none; }
.lc-group-summary,.lc-subgroup-summary,.lc-finding-summary { display:flex; align-items:center; gap:10px; min-height:48px; padding:12px; }
.lc-group-summary:hover,.lc-subgroup-summary:hover,.lc-finding-summary:hover { background:color-mix(in srgb,var(--lc-accent) 5%,transparent); }
.lc-group-icon { color:var(--lc-accent); width:18px; height:18px; }
.lc-group-name { flex:1; font-size:13px; font-weight:600; letter-spacing:.1px; }
.lc-count { display:inline-grid; place-items:center; min-width:25px; height:24px; padding:0 7px; font-size:11px; font-variant-numeric:tabular-nums; border-radius:8px; color:var(--lc-risk); background:color-mix(in srgb,var(--lc-risk) 9%,transparent); }
.lc-count-issue { color:var(--lc-issue); background:color-mix(in srgb,var(--lc-issue) 9%,transparent); }
.lc-chevron { width:13px; height:13px; color:var(--lc-muted); transition:transform .16s; }
details[open] > summary > .lc-chevron { transform:rotate(90deg); }
.lc-group[open] > .lc-group-summary { border-bottom:1px solid var(--lc-line); }
.lc-group-body { padding:4px 10px 8px; }
.lc-subgroup + .lc-subgroup { border-top:1px solid var(--lc-line); }
.lc-subgroup-summary { padding:10px 3px; }
.lc-subgroup > .lc-findings-list { border-left:1px solid var(--lc-line); margin-left:8px; padding-left:9px; }
.lc-row-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
.lc-row-copy strong { font-size:12px; font-weight:550; overflow-wrap:anywhere; }
.lc-row-copy small { font-size:10px; }
.lc-finding-row + .lc-finding-row { border-top:1px solid color-mix(in srgb,var(--lc-line) 60%,transparent); }
.lc-finding-summary { padding:11px 4px; gap:8px; align-items:flex-start; }
.lc-finding-summary > .lc-chevron { margin-top:4px; }
.lc-dot { width:5px; height:5px; border-radius:50%; background:var(--lc-risk); flex:none; margin-top:7px; }
.lc-dot-issue { background:var(--lc-issue); }
.lc-reasons { display:flex; flex-wrap:wrap; gap:3px 8px; color:var(--lc-muted); font-size:10px; }
.lc-reason { overflow-wrap:anywhere; }
.lc-finding-body { padding:0 17px 12px; font-size:12px; }
.lc-finding-body p { margin:5px 0; }
.lc-explanation + .lc-explanation { margin-top:14px; }
.lc-explanation > strong { font-size:11px; font-weight:600; }
.lc-fix { color:var(--lc-muted); }
.lc-evidence { display:flex; flex-wrap:wrap; gap:5px; margin:7px 0; }
.lc-evidence code { color:var(--lc-accent); background:var(--lc-soft); border-radius:6px; padding:3px 6px; font:11px/1.5 ui-monospace,Consolas,monospace; overflow-wrap:anywhere; }
.lc-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; min-height:220px; padding:28px 16px; gap:9px; }
.lc-empty-icon { width:42px; height:42px; padding:10px; box-sizing:content-box; border:1px solid color-mix(in srgb,var(--lc-accent) 20%,var(--lc-line)); border-radius:20px; background:var(--lc-soft); color:var(--lc-accent); margin-bottom:6px; }
.lc-empty p { margin:0; max-width:240px; }
.lc-skeleton { display:grid; gap:10px; }
.lc-skeleton > div { height:50px; border-radius:13px; background:linear-gradient(100deg,var(--lc-soft) 30%,color-mix(in srgb,var(--lc-text) 9%,var(--lc-bg)) 50%,var(--lc-soft) 70%); background-size:200% 100%; animation:lc-shimmer 1.8s ease-in-out infinite; }
.lc-inline-status { color:var(--lc-muted); font-size:11px; }
.lc-error { color:var(--lc-issue); white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; }
.lc-error-detail { border-left:2px solid var(--lc-issue); padding:8px 12px; margin:12px 0; color:var(--lc-issue); font-size:12px; }
.lc-error-detail > summary { font-weight:600; }
.lc-progress-card { display:flex; align-items:center; gap:12px; padding:18px 14px; border:1px solid var(--lc-line); border-radius:13px; font-size:12px; }
.lc-progress-card > span { flex:1; }
.lc-spin { animation:lc-spin 1.5s linear infinite; }
.lc-run-details { border-top:1px solid var(--lc-line); margin-top:14px; font-size:12px; }
.lc-run-details > summary { padding:12px 0; color:var(--lc-muted); display:flex; justify-content:space-between; align-items:center; }
.lc-run-details > summary::after { content:'+'; font-size:16px; }
.lc-run-details[open] > summary::after { content:'−'; }
.lc-details-body { padding:0 0 12px; }
.lc-details-body summary { padding:8px 0; color:var(--lc-accent); }
.lc-review-status { display:flex; align-items:center; gap:8px; color:var(--lc-risk); font-size:13px; font-weight:550; margin-bottom:12px; }
.lc-prefix-caption { margin:4px 0 12px!important; }
.lc-modal { display:block; height:auto; padding:18px; container-type:normal; }
.lc-actions { display:flex; justify-content:flex-end; gap:8px; position:sticky; bottom:0; padding:14px 0 4px; background:var(--lc-bg); }
.lc-review-expiry { text-align:right; margin:5px 0 0!important; }
.lc-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.lc-toolbar label { display:inline-flex; align-items:center; gap:5px; }
.lc-toolbar input[type=checkbox] { accent-color:var(--lc-primary); }
.lc-diff-options > summary { font-size:11px; color:var(--lc-muted); padding:6px 0; }
.lc-diff-options .lc-toolbar { padding:8px 0; }
.lc-change { border:1px solid var(--lc-line); border-radius:10px; margin:10px 0; overflow:hidden; }
.lc-change > summary { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:11px 12px; font-size:12px; font-weight:550; }
.lc-change > summary::after { content:'⌄'; color:var(--lc-muted); }
.lc-change[open] > summary::after { transform:rotate(180deg); }
.lc-diff,.lc-raw { font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace; tab-size:4; white-space:pre-wrap; overflow-wrap:anywhere; margin:0; padding:12px; }
.lc-raw { max-height:420px; overflow:auto; scrollbar-width:thin; scrollbar-color:var(--lc-line) transparent; }
.lc-diff { padding:0; white-space:normal; --lc-num:1; }
.lc-diff-row { display:grid; grid-template-columns:calc(var(--lc-num) * 1ch + 8px) minmax(0,1fr); width:100%; font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace; }
.lc-line-number { user-select:none; color:var(--lc-muted); text-align:right; padding:0 4px 0 2px; font-size:10px; font-variant-numeric:tabular-nums; }
.lc-line-text { white-space:pre-wrap; overflow-wrap:anywhere; padding:0 6px; min-height:19px; min-width:0; }
.lc-word { color:inherit; border-radius:2px; background:transparent; }
.lc-add .lc-word { background:color-mix(in srgb,#399c66 48%,transparent); }
.lc-remove .lc-word { background:color-mix(in srgb,#c85b69 52%,transparent); }
.lc-more { height:1px; }
.lc-fold { background:color-mix(in srgb,var(--lc-accent) 6%,var(--lc-bg)); padding:5px; }
.lc-fold > .lc-button { width:100%; white-space:normal; text-align:left; justify-content:flex-start; border-color:transparent; background:transparent; font-size:11px; }
.lc-add { background:color-mix(in srgb,#399c66 16%,transparent); color:var(--lc-text); border-left:2px solid #55ba81; }
.lc-remove { background:color-mix(in srgb,#c85b69 16%,transparent); color:var(--lc-text); border-left:2px solid #da7c89; }
.lc-context { color:var(--lc-muted); border-left:2px solid transparent; }
.lc-reference { color:var(--lc-text); }
.lc-pair { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; padding:12px; }
.lc-pair strong { color:var(--lc-muted); font-size:11px; }
.lc-raw { background:var(--lc-soft); border:1px solid var(--lc-line); border-radius:7px; }
.lc-full { border-top:1px solid var(--lc-line); }
.lc-health { display:flex; flex-direction:column; min-height:100%; }
.lc-health:has(> .lc-sim) { height:100%; }
.lc-link { color:var(--lc-accent); text-decoration:underline; text-underline-offset:2px; }
.lc-promo { margin:auto 0 0!important; padding-top:16px; color:var(--lc-muted); font-size:11px; line-height:1.6; }
.lc-promo strong { color:var(--lc-text); font-weight:600; }
.lc-root {
  --k-system:#8f8cf0; --k-character:#e58fc0; --k-persona:#d3a062; --k-world:#46b6a2; --k-story:#7f8c9c;
  --k-injection:#e39b37; --k-memory:#5aa7e6; --k-extension:#b48cf0; --k-other:#8d8d8d;
  --lc-bad:var(--lumiverse-danger,#e05a6d); --lc-ok:var(--lumiverse-success,#55ba81); --lc-warn:var(--lumiverse-warning,#d8aa55);
}
[data-kind=system] { --k:var(--k-system); } [data-kind=character] { --k:var(--k-character); } [data-kind=persona] { --k:var(--k-persona); }
[data-kind=world] { --k:var(--k-world); } [data-kind=story] { --k:var(--k-story); } [data-kind=injection] { --k:var(--k-injection); }
[data-kind=memory] { --k:var(--k-memory); } [data-kind=extension] { --k:var(--k-extension); } [data-kind=other] { --k:var(--k-other); }
.lc-live-title { display:flex; flex-direction:column; min-width:0; }
.lc-sim { display:flex; flex-direction:column; flex:1 0 auto; min-height:0; gap:10px; }
.lc-sim > .lc-section-toolbar { margin-bottom:0; }
.lc-verdict { display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; padding:10px 12px; border-radius:11px; border:1px solid var(--lc-line); font-size:13px; }
.lc-verdict strong { font-weight:600; }
.lc-verdict-bad { border-color:color-mix(in srgb,var(--lc-bad) 45%,var(--lc-line)); background:color-mix(in srgb,var(--lc-bad) 9%,transparent); }
.lc-verdict-bad .lc-icon { color:var(--lc-bad); }
.lc-verdict-good { border-color:color-mix(in srgb,var(--lc-ok) 40%,var(--lc-line)); background:color-mix(in srgb,var(--lc-ok) 8%,transparent); }
.lc-verdict-good .lc-icon { color:var(--lc-ok); }
.lc-tests { display:flex; flex-direction:column; gap:6px; }
.lc-test-group { display:flex; flex-wrap:wrap; align-items:center; gap:5px; }
.lc-test-group-name { flex:0 0 100%; color:var(--lc-muted); font-size:10px; font-weight:600; }
.lc-test { min-height:32px; padding:5px 10px; font-size:11px; border-radius:16px; gap:6px; background:transparent; }
.lc-test > i { width:7px; height:7px; border-radius:50%; background:var(--lc-ok); }
.lc-test-broken > i { background:var(--lc-bad); }
.lc-test-allowed > i { background:var(--lc-warn); }
.lc-test[aria-pressed=true] { background:var(--lc-panel); border-color:var(--lc-accent); font-weight:600; }
.lc-test-card { padding:0 2px; }
.lc-test-card p { margin:3px 0; }
.lc-test-purpose { color:var(--lc-muted); font-size:11px; }
.lc-test-result { font-size:12px; font-weight:550; overflow-wrap:anywhere; }
.lc-meter { display:flex; height:6px; gap:1px; border-radius:3px; overflow:hidden; margin:7px 0 4px; background:var(--lc-soft); }
.lc-meter > i { flex:0 0 0; min-width:0; }
.lc-meter-kept { background:var(--lc-ok); } .lc-meter-lost { background:var(--lc-bad); } .lc-meter-new { background:var(--lc-accent); }
.lc-meter-risk .lc-meter-kept { background:repeating-linear-gradient(135deg,var(--lc-bad) 0 3px,var(--lc-ok) 3px 8px); }
.lc-meter-copy-risk { color:var(--lc-bad); }
.lc-tl { display:flex; flex-direction:column; flex:1 1 auto; min-height:400px; gap:7px; }
.lc-tl-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.lc-tl-legend { display:flex; flex-wrap:wrap; gap:3px 9px; min-width:0; }
.lc-tl-key { display:inline-flex; align-items:center; gap:4px; font-size:10px; color:var(--lc-muted); overflow-wrap:anywhere; }
.lc-tl-key > i { flex:none; width:8px; height:8px; border-radius:2px; background:var(--k); }
.lc-tl-nav { display:flex; align-items:center; gap:3px; flex:none; }
.lc-tl-nav .lc-muted { margin-right:3px; white-space:nowrap; }
.lc-tl-step { width:28px; min-height:28px; padding:0; }
.lc-tl-body { display:flex; flex:1 1 0; min-height:0; gap:6px; }
.lc-rail { position:relative; flex:none; width:34px; border:1px solid var(--lc-line); border-radius:8px; overflow:hidden; background:var(--lc-soft); cursor:grab; touch-action:none; user-select:none; }
.lc-rail[data-dragging] { cursor:grabbing; }
.lc-rail-band { position:absolute; left:0; right:0; background:color-mix(in srgb,var(--k) 72%,var(--lc-bg)); }
.lc-rail-problem { background:var(--k); box-shadow:inset 0 0 0 1px var(--lc-bad),inset -9px 0 0 var(--lc-bad); z-index:2; }
.lc-tl-tolerated .lc-rail-problem { box-shadow:inset 0 0 0 1px var(--lc-warn),inset -9px 0 0 var(--lc-warn); }
.lc-rail-lost { position:absolute; left:0; right:0; z-index:1; pointer-events:none; background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--lc-bad) 40%,transparent) 0 3px,transparent 3px 7px); }
.lc-tl-tolerated .lc-rail-lost { background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--lc-warn) 35%,transparent) 0 3px,transparent 3px 7px); }
.lc-rail-thumb { position:absolute; left:0; right:0; z-index:3; pointer-events:none; border:2px solid var(--lc-text); border-radius:5px; background:color-mix(in srgb,var(--lc-text) 16%,transparent); }
.lc-tl-list { position:relative; flex:1; min-width:0; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:3px; padding-right:2px; scrollbar-width:none; }
.lc-tl-list::-webkit-scrollbar { display:none; }
.lc-tl-break { flex:none; margin:6px 0 3px; padding:6px 8px; border-radius:7px; font-size:11px; font-weight:600; color:var(--lc-bad); background:color-mix(in srgb,var(--lc-bad) 12%,transparent); }
.lc-tl-tolerated .lc-tl-break { color:var(--lc-warn); background:color-mix(in srgb,var(--lc-warn) 12%,transparent); }
.lc-turn { flex:none; display:flex; align-items:stretch; justify-content:flex-start; gap:8px; width:100%; padding:0 8px 0 0; border-radius:8px; text-align:left; overflow:hidden; background:color-mix(in srgb,var(--lc-panel) 60%,var(--lc-bg)); }
.lc-turn-stripe { flex:none; width:6px; display:flex; flex-direction:column; }
.lc-turn-stripe > i { flex:1 1 0; min-height:2px; background:var(--k); }
.lc-turn-copy { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center; gap:1px; padding:5px 0; }
.lc-turn-title { display:flex; align-items:baseline; gap:6px; min-width:0; }
.lc-turn-kind { flex:none; font-size:10px; font-weight:600; color:color-mix(in srgb,var(--k) 75%,var(--lc-text)); }
.lc-turn-name { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:11px; font-weight:550; }
.lc-turn-preview { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:10px; color:var(--lc-muted); }
.lc-turn-meta { flex:none; display:flex; flex-direction:column; align-items:flex-end; justify-content:center; gap:2px; font-size:10px; color:var(--lc-muted); }
.lc-turn-status { font-weight:600; }
.lc-turn[data-status=rewritten] { opacity:.62; }
.lc-turn[data-status=new] .lc-turn-status { color:var(--lc-accent); }
.lc-turn:is([data-status=changed],[data-status=added],[data-status=removed]) { border-color:var(--lc-bad); background:color-mix(in srgb,var(--lc-bad) 11%,var(--lc-panel)); }
.lc-turn:is([data-status=changed],[data-status=added],[data-status=removed]) .lc-turn-status { color:var(--lc-bad); }
.lc-tl-tolerated .lc-turn:is([data-status=changed],[data-status=added],[data-status=removed]) { border-color:var(--lc-warn); background:color-mix(in srgb,var(--lc-warn) 11%,var(--lc-panel)); }
.lc-tl-tolerated .lc-turn:is([data-status=changed],[data-status=added],[data-status=removed]) .lc-turn-status { color:var(--lc-warn); }
.lc-review .lc-tl { flex:none; height:min(62vh,640px); margin-bottom:10px; }
/* Leaves room for the review controls, so the modal does not scroll around its own list. */
.lc-modal .lc-review .lc-tl { min-height:260px; height:calc(min(760px,90vh) - 290px); }
.lc-sbs-tools { display:flex; align-items:center; gap:6px; margin-bottom:6px; font-size:12px; }
.lc-turn-modal { display:flex; flex-direction:column; gap:10px; }
.lc-turn-modal p { margin:0; }
.lc-turn-why { font-size:12px; }
.lc-turn-why-bad { color:var(--lc-issue); font-weight:550; }
.lc-turn-sources,.lc-turn-notes { display:flex; flex-wrap:wrap; align-items:center; gap:4px 10px; font-size:11px; }
.lc-turn-notes { flex-direction:column; align-items:flex-start; }
.lc-turn-sources strong,.lc-turn-notes strong { font-weight:600; font-size:11px; }
.lc-sbs-root { display:flex; flex-direction:column; gap:6px; min-width:0; }
.lc-sbs-heads { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; font-size:11px; color:var(--lc-muted); }
.lc-sbs { --lc-num:1; border:1px solid var(--lc-line); border-radius:8px; overflow:hidden; font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace; tab-size:4; }
.lc-sbs .lc-sbs { border:0; border-radius:0; }
.lc-sbs-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:var(--lc-line); }
.lc-sbs-single .lc-sbs-row { grid-template-columns:minmax(0,1fr); }
.lc-sbs-cell { display:grid; grid-template-columns:calc(var(--lc-num) * 1ch + 8px) minmax(0,1fr); background:var(--lc-bg); min-width:0; }
.lc-sbs-cell.lc-add { background:color-mix(in srgb,#399c66 16%,var(--lc-bg)); border-left:0; }
.lc-sbs-cell.lc-remove { background:color-mix(in srgb,#c85b69 16%,var(--lc-bg)); border-left:0; }
.lc-sbs-cell.lc-context { border-left:0; }
.lc-sbs-empty { background:var(--lc-soft); }
.lc-warm-icon { width:100%; height:100%; transform-origin:center; }
.lc-root.lc-warm-banner { flex-direction:row; align-items:center; gap:8px; height:auto; min-height:auto; margin:0 0 6px; padding:5px 6px 5px 10px; border:1px solid var(--lc-line); border-radius:10px; background:var(--lc-panel); font-size:12px; container-type:normal; }
.lc-root.lc-warm-banner[hidden] { display:none; }
.lc-warm-banner .lc-icon { width:15px; height:15px; color:var(--lc-accent); }
.lc-warm-text { flex:1; min-width:0; color:var(--lc-muted); }
.lc-warm-banner .lc-button { min-height:28px; padding:3px 10px; font-size:12px; flex:none; }
.lc-root.lc-warm-modal { height:auto; gap:10px; padding:4px 2px; background:transparent; }
.lc-warm-status { display:flex; align-items:center; gap:8px; font-weight:600; }
.lc-warm-status .lc-icon { color:var(--lc-accent); }
@keyframes lc-spin { to { transform:rotate(360deg); } }
@keyframes lc-shimmer { to { background-position:-200% 0; } }
@container (max-width:340px) { .lc-tab .lc-icon { display:none; } .lc-app-toolbar { padding:10px 8px; gap:4px; } .lc-content { padding:14px 10px 24px; } .lc-tab { font-size:11px; } .lc-group-summary { padding:11px; } }
@media(max-width:600px) { .lc-pair { grid-template-columns:1fr; } .lc-actions .lc-button { flex:1; } }
@media(prefers-reduced-motion:reduce) { .lc-root *, .lc-root *::after { animation:none!important; transition:none!important; } }
`;
