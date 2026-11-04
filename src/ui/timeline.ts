import type { StepTimeline, TimelineRow, TurnKind, TurnStatus } from "../health/types";
import { button, el } from "./elements";

export const KIND_LABELS: Record<TurnKind, string> = { system: "System prompt", character: "Character", persona: "Persona", world: "World info", story: "Story", injection: "Injection", memory: "Memory", extension: "Extension", other: "Other" };
export const STATUS_LABELS: Record<TurnStatus, string> = { base: "", kept: "", new: "New", rewritten: "Re-written", changed: "Changed", added: "Added", removed: "Removed" };
export const isProblem = (row: TimelineRow) => row.status === "changed" || row.status === "added" || row.status === "removed";
export const tokens = (characters: number) => { const value = Math.round(characters / 4); return `~${value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : value} tok`; };
export const turnName = (row: TimelineRow) => row.kind === "story" && row.chatIndex !== undefined ? `Turn ${row.chatIndex + 1} · ${row.label}` : row.label;
const rowHeight = (characters: number) => Math.round(46 + Math.min(34, Math.max(0, Math.log10(Math.max(1, characters)) - 2) * 12));
const breakText = (tolerated: boolean) => tolerated ? "Change starts here, inside your allowed tail." : "Cache breaks here. Everything below gets written again.";

export interface TimelineView { root: HTMLElement; attached(): void; dispose(): void }
/** The rail is the list's scrollbar, so a colored band always lines up with the turns it stands for. */
export function renderTimeline(data: StepTimeline, open: (row: TimelineRow) => void): TimelineView {
  const root = el("div", `lc-tl${data.tolerated ? " lc-tl-tolerated" : ""}`), head = el("div", "lc-tl-head"), legend = el("div", "lc-tl-legend");
  const body = el("div", "lc-tl-body"), rail = el("div", "lc-rail"), list = el("div", "lc-tl-list"), thumb = el("div", "lc-rail-thumb");
  list.id = `lc-tl-${Math.random().toString(36).slice(2)}`; list.tabIndex = 0; list.setAttribute("aria-label", "Prompt timeline, first message to last");
  for (const kind of Object.keys(KIND_LABELS) as TurnKind[]) {
    if (!data.rows.some(row => row.parts.some(part => part.kind === kind) || row.kind === kind)) continue;
    const item = el("span", "lc-tl-key"); item.dataset.kind = kind; item.append(el("i"), KIND_LABELS[kind]); legend.append(item);
  }
  head.append(legend);
  const nodes: HTMLElement[] = [], problems: HTMLElement[] = [];
  let breakTop: HTMLElement | undefined;
  for (const row of data.rows) {
    if (row.root) { breakTop = el("div", "lc-tl-break", breakText(data.tolerated)); list.append(breakTop); }
    const node = button("", () => open(row), "lc-turn"); node.dataset.status = row.status; node.dataset.kind = row.kind;
    node.style.minHeight = `${rowHeight(row.characters)}px`;
    const stripe = el("span", "lc-turn-stripe");
    for (const part of row.parts.length ? row.parts : [{ kind: row.kind, share: 1, label: row.label }]) { const piece = el("i"); piece.dataset.kind = part.kind; piece.style.flexGrow = String(Math.max(0.04, part.share)); stripe.append(piece); }
    const copy = el("span", "lc-turn-copy"), title = el("span", "lc-turn-title");
    title.append(el("span", "lc-turn-kind", KIND_LABELS[row.kind]), el("span", "lc-turn-name", turnName(row)));
    copy.append(title, el("span", "lc-turn-preview", row.preview));
    const meta = el("span", "lc-turn-meta");
    if (STATUS_LABELS[row.status]) meta.append(el("span", "lc-turn-status", STATUS_LABELS[row.status]));
    meta.append(el("span", "lc-turn-size", tokens(row.characters)));
    node.append(stripe, copy, meta);
    node.setAttribute("aria-label", [`Message ${(row.newIndex ?? row.oldIndex ?? 0) + 1}`, KIND_LABELS[row.kind], turnName(row), STATUS_LABELS[row.status], "Open details"].filter(Boolean).join(", "));
    list.append(node); nodes.push(node);
    if (isProblem(row)) problems.push(node);
  }
  // Runs of one kind share a band, which keeps the rail small on long chats.
  const bands: { first: number; last: number; row: TimelineRow; node: HTMLElement }[] = [];
  data.rows.forEach((row, index) => {
    const last = bands.at(-1);
    if (last && !isProblem(row) && !isProblem(last.row) && last.row.kind === row.kind) { last.last = index; return; }
    const band = el("div", `lc-rail-band${isProblem(row) ? " lc-rail-problem" : ""}`); band.dataset.kind = row.kind;
    bands.push({ first: index, last: index, row, node: band }); rail.append(band);
  });
  const lost = el("div", "lc-rail-lost"); lost.hidden = !breakTop; rail.append(lost, thumb);
  rail.setAttribute("role", "scrollbar"); rail.setAttribute("aria-orientation", "vertical"); rail.setAttribute("aria-controls", list.id); rail.setAttribute("aria-label", "Prompt overview"); rail.tabIndex = 0;
  let position: number | undefined, placed = false;
  const syncThumb = () => {
    const height = rail.clientHeight, full = list.scrollHeight; if (!height || !full) return;
    thumb.style.top = `${list.scrollTop / full * height}px`; thumb.style.height = `${Math.max(14, list.clientHeight / full * height)}px`;
    const range = full - list.clientHeight;
    rail.setAttribute("aria-valuenow", String(range > 0 ? Math.round(list.scrollTop / range * 100) : 0));
  };
  const layout = () => {
    const height = rail.clientHeight, full = list.scrollHeight; if (!height || !full) return;
    for (const band of bands) {
      const start = nodes[band.first], end = nodes[band.last], top = start.offsetTop / full * height;
      band.node.style.top = `${top}px`;
      band.node.style.height = `${Math.max(isProblem(band.row) ? 4 : 1, (end.offsetTop + end.offsetHeight - start.offsetTop) / full * height)}px`;
      band.node.title = band.first === band.last ? turnName(band.row) : `${KIND_LABELS[band.row.kind]} · ${band.last - band.first + 1} messages`;
    }
    if (breakTop) { const top = breakTop.offsetTop / full * height; lost.style.top = `${top}px`; lost.style.height = `${Math.max(0, height - top)}px`; }
    syncThumb();
  };
  const attached = () => {
    if (!list.clientHeight) return;
    if (position !== undefined) list.scrollTop = position;
    else if (!placed) {
      // Open on the evidence rather than on the system prompt.
      placed = true;
      if (breakTop) list.scrollTop = Math.max(0, breakTop.offsetTop - 12);
    }
    layout();
  };
  list.addEventListener("scroll", () => { position = list.scrollTop; syncThumb(); });
  let grab: number | undefined;
  const moveTo = (y: number) => {
    const bounds = rail.getBoundingClientRect(); if (!bounds.height) return;
    const thumbHeight = thumb.offsetHeight;
    list.scrollTop = (y - bounds.top - (grab ?? thumbHeight / 2)) / bounds.height * list.scrollHeight;
  };
  rail.addEventListener("pointerdown", event => {
    event.preventDefault(); rail.focus({ preventScroll: true });
    const bounds = thumb.getBoundingClientRect();
    grab = event.clientY >= bounds.top && event.clientY <= bounds.bottom ? event.clientY - bounds.top : undefined;
    rail.setPointerCapture?.(event.pointerId); rail.dataset.dragging = "true"; moveTo(event.clientY);
    if (grab === undefined) grab = thumb.offsetHeight / 2;
  });
  rail.addEventListener("pointermove", event => { if (rail.dataset.dragging) moveTo(event.clientY); });
  const release = () => { delete rail.dataset.dragging; grab = undefined; };
  rail.addEventListener("pointerup", release); rail.addEventListener("pointercancel", release);
  rail.addEventListener("wheel", event => { event.preventDefault(); list.scrollTop += event.deltaY; }, { passive: false });
  rail.addEventListener("keydown", event => {
    const page = list.clientHeight * 0.9;
    const moves: Record<string, number> = { ArrowUp: list.scrollTop - 60, ArrowDown: list.scrollTop + 60, PageUp: list.scrollTop - page, PageDown: list.scrollTop + page, Home: 0, End: list.scrollHeight };
    if (!(event.key in moves)) return;
    event.preventDefault(); list.scrollTop = moves[event.key];
  });
  if (problems.length) {
    const nav = el("div", "lc-tl-nav"); let current = -1;
    const count = el("span", "lc-muted", `${problems.length} ${problems.length === 1 ? "change" : "changes"}`);
    const go = (step: number) => {
      current = (current + step + problems.length) % problems.length; const node = problems[current];
      list.scrollTop = Math.max(0, node.offsetTop - 40); count.textContent = `${current + 1} of ${problems.length}`; node.focus({ preventScroll: true });
    };
    const previous = button("↑", () => go(-1), "lc-tl-step"), next = button("↓", () => go(1), "lc-tl-step");
    previous.setAttribute("aria-label", "Previous change"); next.setAttribute("aria-label", "Next change");
    nav.append(count, previous, next); head.append(nav);
  }
  body.append(rail, list); root.append(head, body);
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(attached);
  observer?.observe(list); observer?.observe(rail);
  return { root, attached, dispose: () => observer?.disconnect() };
}
