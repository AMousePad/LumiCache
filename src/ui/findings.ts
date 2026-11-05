import type { Finding, FindingCategory } from "../health/types";
import { button, el, externalLink } from "./elements";
import { icon } from "./icons";
import type { Classification } from "../shared";

export function actionable(rows: Finding[]) { return rows.filter(row => ["risk", "issue", "observed", "depth", "variabled"].includes(row.level)); }
export function filtered(rows: Finding[], hidden: Classification[]) { return actionable(rows).filter(r => !hidden.includes(r.level === "depth" || r.level === "variabled" || r.level === "risk" ? r.level : "issue")); }
export function counts(rows: Finding[]) {
  return { risks: rows.filter(row => row.level === "risk").length, issues: rows.filter(row => row.level === "issue" || row.level === "observed").length };
}
const countLabel = (risks: number, issues: number) => `${risks} ${risks === 1 ? "risk" : "risks"}, ${issues} ${issues === 1 ? "issue" : "issues"}`;
export function healthPill(rows: Finding[], checking = false, hidden: Classification[] = [], toggle?: (category: Classification) => void): HTMLElement {
  const { risks, issues } = counts(rows), pill = el("div", "lc-health-pill"); pill.setAttribute("aria-label", countLabel(risks, issues));
  pill.setAttribute("role", toggle ? "group" : "status");
  if (toggle) pill.setAttribute("aria-label", "Filter finding classifications");
  const parts: [Classification,string,string][] = [["risk",`${risks} ${risks === 1 ? "Risk" : "Risks"}`,"lc-risk-ink"],["issue",`${issues} ${issues === 1 ? "Issue" : "Issues"}`,"lc-issue-ink"],["depth",`${rows.filter(r=>r.level==="depth").length} Depth Mutable`,"lc-depth-ink"],["variabled",`${rows.filter(r=>r.level==="variabled").length} Variabled`,"lc-variabled-ink"]];
  for (const [category,label,ink] of parts) {
    if (pill.childElementCount) { const divider = el("span", "lc-pill-divider", "|"); divider.setAttribute("aria-hidden","true"); pill.append(divider); }
    const part = toggle ? button(label,()=>toggle(category),`lc-pill-toggle ${ink}`) : el("span",`lc-pill-part ${ink}`,label);
    if (toggle) { part.setAttribute("aria-pressed",String(!hidden.includes(category))); part.dataset.focus=`filter-${category}`; part.title=`${hidden.includes(category)?"Show":"Hide"} ${category === "depth" ? "Depth Mutable" : category === "variabled" ? "Variabled" : category === "risk" ? "Risks" : "Issues"}. Display filter only; sending protection stays active.`; }
    pill.append(part);
  }
  if (checking) { pill.classList.add("lc-updating"); pill.setAttribute("aria-busy", "true"); }
  return pill;
}
const CATEGORIES: FindingCategory[] = ["Depth Mutable", "Variabled", "World info", "Preset", "Compose", "Regex", "History", "Character", "Persona", "Context", "Connection", "Simulation"];
const ICONS = { "Depth Mutable": "layers", Variabled: "sliders", "World info": "book", Preset: "sliders", Compose: "sliders", Regex: "diff", History: "layers", Character: "person", Persona: "person", Context: "layers", Connection: "plug", Simulation: "play" } as const;
export function renderFindings(rows: Finding[], open: Set<string>): HTMLElement {
  const root = el("div", "lc-groups");
  const disclosures = (key: string, className: string, summary: HTMLElement, body: HTMLElement) => {
    summary.dataset.focus = `finding-${encodeURIComponent(key)}`;
    const details = el("details", className); details.open = open.has(key); details.append(summary, body);
    details.addEventListener("toggle", () => { if (details.open) open.add(key); else open.delete(key); }); return details;
  };
  const badge = (findings: Finding[]) => {
    const { risks, issues } = counts(findings), depths = findings.filter(r=>r.level==="depth").length, variabled = findings.filter(r=>r.level==="variabled").length, node = el("span", `lc-count ${depths ? "lc-count-depth" : issues ? "lc-count-issue" : variabled && !risks ? "lc-count-variabled" : ""}`, String(risks + issues + depths + variabled));
    node.setAttribute("aria-label", depths ? `${depths} depth mutable items, ${findings.filter(r=>r.level==="depth"&&r.problematic).length} outside tolerance` : variabled && !risks && !issues ? `${variabled} variable ${variabled === 1 ? "check" : "checks"}` : countLabel(risks, issues)); return node;
  };
  const renderItems = (findings: Finding[], prefix: string) => {
    const list = el("div", "lc-findings-list"), items = new Map<string, Finding[]>();
    for (const row of findings) { const key = row.itemId ?? row.item ?? row.id; items.set(key, [...items.get(key) ?? [], row]); }
    let shown = 0; const entries = [...items];
    const pageKey = `pages:${prefix}:`, previous = [...open].find(key => key.startsWith(pageKey));
    const initial = previous ? Math.max(30, Number(previous.slice(pageKey.length)) || 30) : 30;
    const more = button("Show more", () => { append(); for (const key of open) if (key.startsWith(pageKey)) open.delete(key); open.add(`${pageKey}${shown}`); }, "lc-text-button");
    more.dataset.focus = `more-${encodeURIComponent(prefix)}`;
    const append = () => {
      more.remove();
      const end = shown ? shown + 30 : initial;
      for (const [id, rows] of entries.slice(shown, end)) {
        const first = rows[0], summary = el("summary", "lc-finding-summary"), copy = el("span", "lc-row-copy");
        copy.append(el("strong", "", first.item || first.title));
        const reasons = el("span", "lc-reasons");
        for (const row of rows) reasons.append(el("span", `lc-reason ${row.level === "depth" ? "lc-depth-ink" : row.level === "variabled" ? "lc-variabled-ink" : row.level === "risk" ? "" : "lc-issue-ink"}`, row.evidence?.[0]?.startsWith("{{") ? `${row.title} · ${row.evidence.map(value => value.length <= 45 ? value : value.replace(/::.*/, "}}")).join(", ")}` : row.title));
        if (first.item) copy.append(reasons);
        const indicator = first.level === "depth" ? el("span",`lc-depth-status ${first.problematic ? "lc-depth-fail" : "lc-depth-pass"}`) : el("span", `lc-dot ${rows.every(row => row.level === "variabled") ? "lc-dot-variabled" : rows.some(row => row.level !== "risk" && row.level !== "variabled") ? "lc-dot-issue" : ""}`);
        if (first.level === "depth") { indicator.append(icon(first.problematic ? "x" : "check")); indicator.setAttribute("role","img"); indicator.setAttribute("aria-label",first.problematic ? "Outside configured tolerance" : "Within configured tolerance"); indicator.title=indicator.getAttribute("aria-label")!; }
        summary.append(indicator, copy, icon("chevron", "lc-chevron"));
        const body = el("div", "lc-finding-body");
        for (const row of rows) {
          const reason = el("div", "lc-explanation");
          if (rows.length > 1) reason.append(el("strong", "", row.evidence?.[0]?.startsWith("{{") ? `${row.title} · ${row.evidence.map(value => value.length <= 45 ? value : value.replace(/::.*/, "}}")).join(", ")}` : row.title));
          if (row.evidence?.length) { const evidence = el("div", "lc-evidence"); for (const text of row.evidence) evidence.append(el("code", "", text)); reason.append(evidence); }
          const detail = el("p", "", row.detail);
          if (row.link) { detail.append(" "); detail.append(externalLink(row.link.label, row.link.url)); }
          reason.append(detail, el("p", "lc-fix", row.suggestion)); body.append(reason);
        }
        list.append(disclosures(`${prefix}/${id}`, "lc-finding-row", summary, body));
      }
      shown = end;
      if (shown < entries.length) { more.textContent = `Show ${Math.min(30, entries.length - shown)} more`; list.append(more); }
    };
    append(); return list;
  };
  // Pinned rows stay small until clicked, so they don't crowd out the rest.
  for (const row of actionable(rows).filter(row => row.pinned)) {
    const summary = el("summary", "lc-pinned-summary"), body = el("div", "lc-pinned-body");
    summary.append(el("span", row.level === "risk" ? "lc-dot" : "lc-dot lc-dot-issue"), el("strong", "", row.title), icon("chevron", "lc-chevron"));
    body.append(...(row.item ? [el("small", "lc-muted", row.item)] : []), el("p", "", row.detail), el("p", "lc-fix", row.suggestion));
    root.append(disclosures(`pinned/${row.id}`, `lc-pinned lc-pinned-${row.level === "risk" ? "risk" : "issue"}`, summary, body));
  }
  for (const category of CATEGORIES) {
    const selected = actionable(rows).filter(row => !row.pinned && (row.category ?? (row.level === "observed" ? "Simulation" : "Context")) === category);
    if (!selected.length) continue;
    const summary = el("summary", "lc-group-summary");
    summary.append(icon(ICONS[category], "lc-group-icon"), el("span", "lc-group-name", category), badge(selected), icon("chevron", "lc-chevron"));
    const body = el("div", "lc-group-body"), groups = new Map<string, Finding[]>();
    for (const row of selected) { const key = row.groupId ?? row.group ?? ""; groups.set(key, [...groups.get(key) ?? [], row]); }
    for (const [id, group] of groups) {
      if (!id || category === "Preset" && groups.size === 1) { body.append(renderItems(group, category)); continue; }
      const title = el("summary", "lc-subgroup-summary"), copy = el("span", "lc-row-copy");
      copy.append(el("strong", "", group[0].group || id));
      const affected = new Set(group.map(row => row.itemId ?? row.item ?? row.id)).size;
      copy.append(el("small", "lc-muted", `${affected} ${category === "World info" ? affected === 1 ? "entry" : "entries" : affected === 1 ? "item" : "items"}`));
      title.append(copy, badge(group), icon("chevron", "lc-chevron"));
      body.append(disclosures(`${category}/${id}`, "lc-subgroup", title, renderItems(group, `${category}/${id}`)));
    }
    root.append(disclosures(category, `lc-group ${category === "Depth Mutable" ? "lc-depth-group" : category === "Variabled" ? "lc-variabled-group" : ""}`, summary, body));
  }
  return root;
}
