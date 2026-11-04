import type { Check, Snapshot } from "../shared";
import { errorText } from "../shared";
import type { DiffFold, DiffPage, DiffRow } from "../diff-engine";
import type { MessageChange } from "../prompt-store";
import type { Bridge } from "./bridge";
import { button, el } from "./elements";
type Client = Pick<Bridge, "call">;

const markWhitespace = (text: string) => text.replaceAll(" ", "·").replaceAll("\t", "⇥").replaceAll("\r", "␍").replaceAll("\n", "↵\n");
const painted = new WeakMap<HTMLElement, { text: string; spans?: [number, number][] }>();
/** Marks only the changed words, the way git word diff does. Text stays text nodes, never markup. */
function paint(node: HTMLElement, text: string, spans: [number, number][] | undefined, whitespace: boolean) {
  painted.set(node, { text, spans });
  const show = (value: string) => whitespace ? markWhitespace(value) : value;
  if (!spans?.length) { node.textContent = show(text); return; }
  node.replaceChildren();
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start > cursor) node.append(show(text.slice(cursor, start)));
    node.append(el("mark", "lc-word", show(text.slice(start, end))));
    cursor = end;
  }
  if (cursor < text.length) node.append(show(text.slice(cursor)));
}
/** Runs the next load when its marker scrolls into view, so long diffs read as one continuous list. */
function whenVisible(host: HTMLElement, load: () => Promise<void>) {
  const marker = el("div", "lc-more"); marker.setAttribute("aria-hidden", "true"); host.append(marker);
  const run = () => { void load().finally(() => marker.remove()); };
  if (typeof IntersectionObserver === "undefined") { run(); return; }
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect(); run();
  }, { rootMargin: "600px 0px" });
  observer.observe(marker);
}
const lineNumber = (row: DiffRow) => row.newLine ?? row.oldLine;
/** Long lines split into fragments, and only a line's first fragment carries its number. */
const startsLine = (row: DiffRow) => (row.newColumn ?? row.oldColumn ?? 1) <= 1;
function widen(host: HTMLElement, value: number | undefined) {
  if (value === undefined) return;
  const digits = String(value).length;
  if (digits > Number(host.style.getPropertyValue("--lc-num") || 0)) host.style.setProperty("--lc-num", String(digits));
}
function foldLabel(item: DiffFold) { return `Expand context · ${item.characters.toLocaleString()} unchanged characters`; }

export function renderPrompt(snapshot: Snapshot, client: Client): HTMLElement {
  return renderMessages(undefined, snapshot, client);
}
export function renderDiff(check: Check, client: Client): HTMLElement {
  if (!check.before) return el("p", "lc-muted", "Send a reply to inspect the cache diff.");
  const root = el("div", "lc-diffs");
  if (check.comparison.routeChanged) {
    const detail = el("details", "lc-change"); detail.open = true; detail.append(el("summary", "", "Connection / model changed"));
    const pair = el("div", "lc-pair");
    for (const [label, value] of [["Before", check.before.route], ["After", check.after.route]]) {
      const panel = el("div"); panel.append(el("strong", "", label), el("pre", "lc-raw", JSON.stringify(JSON.parse(value), null, 2))); pair.append(panel);
    }
    detail.append(pair); root.append(detail);
  }
  root.append(renderMessages(check.before, check.after, client, check.comparison.firstMessage)); return root;
}
function renderMessages(before: Snapshot | undefined, after: Snapshot, client: Client, firstMessage?: number | null): HTMLElement {
  const root = el("div", "lc-diffs"), toolbar = el("div", "lc-toolbar"), list = el("div");
  let showWhitespace = false, includeUnchanged = false, revision = 0;
  const whitespace = el("input"); whitespace.type = "checkbox";
  const field = el("label", "lc-muted"); field.append(whitespace, document.createTextNode("Show whitespace")); toolbar.append(field);
  const include = el("input"); include.type = "checkbox";
  const includeField = el("label", "lc-muted"); includeField.append(include, document.createTextNode("Include unchanged messages")); toolbar.append(includeField);
  includeField.hidden = !before;
  const display = el("details", "lc-diff-options"); display.append(el("summary", "", "Display options"), toolbar); root.append(display, list);
  whitespace.addEventListener("change", () => {
    showWhitespace = whitespace.checked;
    for (const node of root.querySelectorAll<HTMLElement>(".lc-line-text")) { const value = painted.get(node); if (value) paint(node, value.text, value.spans, showWhitespace); }
  });
  include.addEventListener("change", () => { includeUnchanged = include.checked; void load(); });
  function line(row: DiffRow, host: HTMLElement) {
    const kind = before ? row.kind : "context";
    const node = el("div", `lc-diff-row lc-${kind}${before ? "" : " lc-reference"}`);
    const number = lineNumber(row); widen(host, number);
    const gutter = el("span", "lc-line-number", startsLine(row) && number !== undefined ? String(number) : "");
    if (row.oldLine !== undefined && row.newLine !== undefined && row.oldLine !== row.newLine) gutter.title = `Line ${row.oldLine} before, ${row.newLine} now`;
    const sign = kind === "add" ? "+ " : kind === "remove" ? "− " : "  ";
    const value = el("span", "lc-line-text"); paint(value, `${sign}${row.text}`, row.spans?.map(([start, end]) => [start + sign.length, end + sign.length]), showWhitespace);
    node.append(gutter, value); return node;
  }
  function showPage(host: HTMLElement, id: string, first: DiffPage, fold?: number) {
    host.replaceChildren();
    if (first.note) host.append(el("p", "lc-muted", first.note));
    const rows = el("div", "lc-diff"); host.append(rows); let collapsePrevious: (() => void) | undefined;
    const append = (page: DiffPage) => {
      for (const item of page.items) {
        if (item.kind !== "fold") { rows.append(line(item, rows)); continue; }
        const holder = el("div", "lc-fold"), context = el("div");
        let opened = false, loading = false;
        const collapse = () => { context.replaceChildren(); opened = false; expand.setAttribute("aria-expanded", "false"); };
        const expand = button(foldLabel(item), () => {
          if (opened) { collapse(); return; }
          if (loading) return; loading = true; expand.disabled = true;
          void client.call("diffPage", { id, fold: item.id, cursor: 0 }).then(next => {
            collapsePrevious?.(); collapsePrevious = collapse;
            opened = true; expand.setAttribute("aria-expanded", "true"); showPage(context, id, next, item.id);
          }).catch(error => context.replaceChildren(el("p", "lc-error", errorText(error)))).finally(() => { loading = false; expand.disabled = false; });
        });
        expand.setAttribute("aria-expanded", "false"); holder.append(expand, context); rows.append(holder);
      }
      if (page.next === undefined) return;
      whenVisible(rows, () => client.call("diffPage", { id, cursor: page.next!, fold }).then(append).catch(error => { rows.append(el("p", "lc-error", errorText(error))); }));
    };
    append(first);
  }
  function message(change: MessageChange, open: boolean) {
    const details = el("details", "lc-change"), body = el("div", "lc-message-diff");
    const identity = `message ${(change.newIndex ?? change.oldIndex ?? 0) + 1}`;
    details.append(el("summary", "", `${change.role[0].toUpperCase() + change.role.slice(1)} · ${identity}${before && change.kind === "added" ? " · added" : before && change.kind === "removed" ? " · removed" : ""}`), body);
    let rendered = false, request = 0;
    const show = () => {
      if (!details.open) { request++; rendered = false; body.replaceChildren(); return; }
      if (rendered) return; rendered = true; const active = ++request;
      for (const part of change.headerChanged ? ["header", "body"] as const : ["body"] as const) {
        const panel = el("div"); if (part === "header") body.append(el("h3", "", "Message metadata changed"));
        panel.append(el("p", "lc-muted", "Loading diff…")); body.append(panel);
        void client.call("diffOpen", { before: before?.reference, after: after.reference!, oldIndex: change.oldIndex, newIndex: change.newIndex, part }).then(result => {
          if (active === request) showPage(panel, result.id, result.page);
        }).catch(error => { if (active === request) panel.replaceChildren(el("p", "lc-error", errorText(error))); });
      }
    };
    details.addEventListener("toggle", show); if (open) { details.open = true; show(); } return details;
  }
  async function load() {
    const current = ++revision; list.replaceChildren(el("p", "lc-muted", "Loading changed messages…"));
    try {
      if (!after.reference || before && !before.reference) throw new Error("Prompt reference unavailable. Refresh the cache check.");
      const first = await client.call("diffList", { before: before?.reference, after: after.reference, cursor: 0, includeUnchanged });
      if (current !== revision) return;
      list.replaceChildren();
      if (first.unchanged) list.append(el("p", "lc-muted", `${first.unchanged.toLocaleString()} unchanged messages${includeUnchanged ? " included" : " hidden"}`));
      if (first.note) list.append(el("p", "lc-muted", first.note));
      const items = el("div"); list.append(items);
      const append = (page: typeof first) => {
        for (const item of page.items) items.append(message(item, page.cursor === 0 && (page.total === 1 || (before ? item.oldIndex !== undefined && item.oldIndex === firstMessage : item.newIndex === 0))));
        if (page.next === undefined) return;
        whenVisible(list, async () => {
          try {
            const next = await client.call("diffList", { before: before?.reference, after: after.reference!, cursor: page.next, includeUnchanged });
            if (current === revision) append(next);
          } catch (error) { if (current === revision) list.append(el("p", "lc-error", errorText(error))); }
        });
      };
      append(first);
    } catch (error) { if (current === revision) list.replaceChildren(el("p", "lc-error", errorText(error))); }
  }
  void load(); return root;
}

export interface TurnDiffTarget { oldIndex?: number; newIndex?: number; headerChanged?: boolean; same?: boolean }
/** One message, before and after in two columns. A message on one side only gets a single column. */
export function renderTurnDiff(before: Snapshot | undefined, after: Snapshot, target: TurnDiffTarget, client: Client): HTMLElement {
  const root = el("div", "lc-sbs-root");
  const paired = !!before && target.oldIndex !== undefined && target.newIndex !== undefined && !target.same;
  const onlyBefore = target.newIndex === undefined;
  let showWhitespace = false;
  if (paired) {
    const toggle = el("input"); toggle.type = "checkbox";
    const field = el("label", "lc-muted lc-sbs-tools"); field.append(toggle, document.createTextNode("Show whitespace")); root.append(field);
    toggle.addEventListener("change", () => {
      showWhitespace = toggle.checked;
      for (const node of root.querySelectorAll<HTMLElement>(".lc-line-text")) { const value = painted.get(node); if (value) paint(node, value.text, value.spans, showWhitespace); }
    });
  }
  function stream(host: HTMLElement, id: string, first: DiffPage, fold?: number) {
    const rows = el("div", `lc-sbs${paired ? "" : " lc-sbs-single"}`); host.append(rows);
    let waiting: HTMLElement[] = [];
    const cell = (row?: DiffRow) => {
      const node = el("div", `lc-sbs-cell${row && paired ? ` lc-${row.kind === "equal" ? "context" : row.kind}` : ""}${row ? "" : " lc-sbs-empty"}`);
      if (!row) return node;
      const number = paired && row.kind === "remove" ? row.oldLine : lineNumber(row); widen(rows, number);
      const text = el("span", "lc-line-text"); paint(text, row.text, paired ? row.spans : undefined, showWhitespace);
      node.append(el("span", "lc-line-number", startsLine(row) && number !== undefined ? String(number) : ""), text); return node;
    };
    const add = (row: DiffRow) => {
      if (!paired) { const line = el("div", "lc-sbs-row"); line.append(cell(row)); rows.append(line); return; }
      if (row.kind === "add" && waiting.length) { const line = waiting.shift()!; line.lastElementChild!.replaceWith(cell(row)); return; }
      const line = el("div", "lc-sbs-row"); rows.append(line);
      if (row.kind === "remove") { line.append(cell(row), cell()); waiting.push(line); return; }
      waiting = [];
      if (row.kind === "add") line.append(cell(), cell(row)); else line.append(cell(row), cell(row));
    };
    const expandFold = (item: DiffFold, holder: HTMLElement, control?: HTMLButtonElement) => {
      void client.call("diffPage", { id, fold: item.id, cursor: 0 }).then(next => { control?.remove(); stream(holder, id, next, item.id); })
        .catch(error => holder.append(el("p", "lc-error", errorText(error))));
    };
    const append = (page: DiffPage) => {
      for (const item of page.items) {
        if (item.kind !== "fold") { add(item); continue; }
        waiting = [];
        const holder = el("div", "lc-fold"); rows.append(holder);
        if (page.items.length === 1 && page.next === undefined) { expandFold(item, holder); continue; }
        const control = button(foldLabel(item), () => { control.disabled = true; expandFold(item, holder, control); }); holder.append(control);
      }
      if (page.next === undefined) return;
      whenVisible(rows, () => client.call("diffPage", { id, cursor: page.next!, fold }).then(append).catch(error => { rows.append(el("p", "lc-error", errorText(error))); }));
    };
    append(first);
  }
  const open = (part: "body" | "header", host: HTMLElement) => {
    const loading = el("p", "lc-muted", "Loading…"); host.append(loading);
    const reference = onlyBefore ? before?.reference : after.reference, index = onlyBefore ? target.oldIndex : target.newIndex;
    const input = paired ? { before: before!.reference, after: after.reference!, oldIndex: target.oldIndex, newIndex: target.newIndex, part } : { after: reference!, newIndex: index, part };
    void client.call("diffOpen", input).then(result => {
      loading.remove();
      if (result.page.note) host.append(el("p", "lc-muted", result.page.note));
      stream(host, result.id, result.page);
    }).catch(error => loading.replaceWith(el("p", "lc-error", errorText(error))));
  };
  if (paired) {
    const heads = el("div", "lc-sbs-heads"); heads.append(el("strong", "", "Before"), el("strong", "", "Now")); root.append(heads);
    if (target.headerChanged) { const panel = el("div"); root.append(el("h3", "", "Message metadata changed"), panel); open("header", panel); root.append(el("h3", "", "Message text")); }
  }
  const panel = el("div"); root.append(panel); open("body", panel);
  return root;
}
