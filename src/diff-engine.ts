import { diffArrays, diffWordsWithSpace } from "diff";

export const PAGE_ROWS = 100;
export const ROW_CHARACTERS = 1024;
const WORD_DIFF_CHARACTERS = 256_000, WORD_DIFF_MS = 80, WORD_DIFF_MIN_COMMON = 0.2;
export interface DiffRow { kind: "equal" | "add" | "remove"; text: string; oldLine?: number; newLine?: number; oldColumn?: number; newColumn?: number; spans?: [number, number][] }
export interface DiffFold { kind: "fold"; id: number; rows: number; characters: number }
export interface DiffPage { items: (DiffRow | DiffFold)[]; cursor: number; total: number; next?: number; previous?: number; nextChange?: number; note?: string }
interface Run { kind: DiffRow["kind"]; start: number; end: number; other: number; partner?: Run; changed?: [number, number][] | null }
interface Section { run: Run; first: number; count: number; fold: boolean; cursor: number }

// Index offsets, not DOM nodes or copies of every line. Long lines are split into
// bounded display fragments; CRLF and surrogate pairs remain intact.
export class TextIndex {
  readonly starts: Uint32Array;
  readonly lines: Uint32Array;
  readonly columns: Uint32Array;
  constructor(readonly text: string) {
    const scan = (visit?: (row: number, offset: number, line: number, column: number) => void) => {
      let row = 0, position = 0, line = 1, lineStart = 0, newline = text.indexOf("\n");
      visit?.(0, 0, 1, 1);
      while (position < text.length) {
        let end = Math.min(text.length, position + ROW_CHARACTERS, newline < 0 ? Infinity : newline + 1);
        if (end < text.length && (text.charCodeAt(end - 1) === 13 && text.charCodeAt(end) === 10 || text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff)) end--;
        if (end === newline + 1) { line++; lineStart = end; newline = text.indexOf("\n", end); }
        position = end;
        if (++row > 2_000_000) throw new Error("This message exceeds two million display fragments. Split it into smaller prompt messages to inspect its diff.");
        visit?.(row, position, line, position - lineStart + 1);
      }
      return row + 1;
    };
    const count = scan();
    this.starts = new Uint32Array(count); this.lines = new Uint32Array(count); this.columns = new Uint32Array(count);
    scan((row, offset, line, column) => { this.starts[row] = offset; this.lines[row] = line; this.columns[row] = column; });
  }
  at(offset: number): number {
    let low = 0, high = this.starts.length - 1;
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (this.starts[mid] <= offset) low = mid; else high = mid - 1; }
    return low;
  }
  location(offset: number) {
    const index = this.at(offset), line = this.lines[index];
    return { line, column: this.columns[index] + offset - this.starts[index] };
  }
  count(start: number, end: number) { return end <= start ? 0 : this.at(end - 1) - this.at(start) + 1; }
  range(start: number, end: number, row: number): [number, number] {
    const index = this.at(start) + row;
    return [Math.max(start, this.starts[index]), Math.min(end, this.starts[index + 1])];
  }
}
function tokens(text: string): string[] | undefined {
  const result: string[] = []; let start = 0, newline = text.indexOf("\n");
  while (start < text.length) {
    if (result.length >= 200_000) return undefined;
    let end = Math.min(text.length, start + ROW_CHARACTERS, newline < 0 ? Infinity : newline + 1);
    if (end < text.length && (text.charCodeAt(end - 1) === 13 && text.charCodeAt(end) === 10 || text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff)) end--;
    if (end === newline + 1) newline = text.indexOf("\n", end);
    result.push(text.slice(start, end)); start = end;
  }
  return result;
}
export class DiffPlan {
  readonly before: TextIndex;
  readonly after: TextIndex;
  readonly sections: Section[] = [];
  readonly total: number;
  readonly note?: string;
  constructor(oldText: string, newText: string) {
    this.before = new TextIndex(oldText); this.after = new TextIndex(newText);
    let prefix = 0, suffix = 0;
    const min = Math.min(oldText.length, newText.length);
    while (prefix < min && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
    while (suffix < min - prefix && oldText.charCodeAt(oldText.length - suffix - 1) === newText.charCodeAt(newText.length - suffix - 1)) suffix++;
    // Prefer whole lines around a change, but never pull a multi-megabyte line
    // into one row just to provide context.
    if (oldText !== newText) {
      const lineStart = prefix ? oldText.lastIndexOf("\n", prefix - 1) + 1 : 0;
      if (prefix - lineStart <= ROW_CHARACTERS) prefix = lineStart;
      const end = oldText.length - suffix, newline = oldText.indexOf("\n", end);
      if (newline >= 0 && newline + 1 - end <= ROW_CHARACTERS) suffix = oldText.length - newline - 1;
      else if (suffix <= ROW_CHARACTERS) suffix = 0;
    }
    // Never split a UTF-16 character or a CRLF at the edge of a changed range.
    const split = (s: string, n: number) => n > 0 && n < s.length && (s.charCodeAt(n - 1) === 13 && s.charCodeAt(n) === 10 || s.charCodeAt(n - 1) >= 0xd800 && s.charCodeAt(n - 1) <= 0xdbff && s.charCodeAt(n) >= 0xdc00 && s.charCodeAt(n) <= 0xdfff);
    if (split(oldText, prefix) || split(newText, prefix)) prefix--;
    if (split(oldText, oldText.length - suffix) || split(newText, newText.length - suffix)) suffix--;
    const runs: Run[] = [];
    if (prefix) runs.push({ kind: "equal", start: 0, end: prefix, other: 0 });
    const oldMiddle = oldText.slice(prefix, oldText.length - suffix), newMiddle = newText.slice(prefix, newText.length - suffix);
    // Work is bounded independently of prompt size. Trim exact shared edges first;
    // then align fragments. A timeout produces an explicit, lossless replacement.
    const oldTokens = tokens(oldMiddle), newTokens = tokens(newMiddle);
    const parts = oldTokens && newTokens && oldTokens.length + newTokens.length <= 200_000
      ? diffArrays(oldTokens, newTokens, { timeout: 80, maxEditLength: 1000 }) : undefined;
    let a = prefix, b = prefix;
    if (parts) for (const part of parts) {
      const length = part.value.reduce((n, token) => n + token.length, 0);
      if (!length) continue;
      if (part.added) { runs.push({ kind: "add", start: b, end: b + length, other: a }); b += length; }
      else if (part.removed) { runs.push({ kind: "remove", start: a, end: a + length, other: b }); a += length; }
      else { runs.push({ kind: "equal", start: a, end: a + length, other: b }); a += length; b += length; }
    } else {
      if (oldMiddle.length) runs.push({ kind: "remove", start: prefix, end: oldText.length - suffix, other: prefix });
      if (newMiddle.length) runs.push({ kind: "add", start: prefix, end: newText.length - suffix, other: prefix });
      this.note = "This large changed region is shown as a replacement because detailed alignment reached its work limit. All text remains available in bounded pages; unchanged text inside this region may appear on both sides.";
    }
    if (suffix) runs.push({ kind: "equal", start: oldText.length - suffix, end: oldText.length, other: newText.length - suffix });
    for (let i = 0; i + 1 < runs.length; i++) if (runs[i].kind === "remove" && runs[i + 1].kind === "add") { runs[i].partner = runs[i + 1]; runs[i + 1].partner = runs[i]; }
    let cursor = 0;
    const add = (run: Run, first: number, count: number, fold: boolean) => {
      if (!count) return;
      this.sections.push({ run, first, count, fold, cursor }); cursor += fold ? 1 : count;
    };
    for (const [i, run] of runs.entries()) {
      const count = this.index(run).count(run.start, run.end);
      if (run.kind !== "equal") { add(run, 0, count, false); continue; }
      const head = i ? Math.min(3, count) : 0;
      const tail = i < runs.length - 1 ? Math.min(3, count - head) : 0;
      add(run, 0, head, false); add(run, head, count - head - tail, true); add(run, count - tail, tail, false);
    }
    this.total = cursor;
  }
  private index(run: Run) { return run.kind === "add" ? this.after : this.before; }
  /** Word ranges for a replaced run, computed once on first view. Unrelated text gets none. */
  private wordChanges(run: Run): [number, number][] | null {
    if (run.changed !== undefined) return run.changed;
    const partner = run.partner;
    if (!partner) return run.changed = null;
    const removed = run.kind === "remove" ? run : partner, added = run.kind === "remove" ? partner : run;
    removed.changed = added.changed = null;
    const oldText = this.before.text.slice(removed.start, removed.end), newText = this.after.text.slice(added.start, added.end);
    if (oldText.length > WORD_DIFF_CHARACTERS || newText.length > WORD_DIFF_CHARACTERS) return null;
    const parts = diffWordsWithSpace(oldText, newText, { timeout: WORD_DIFF_MS });
    if (!parts) return null;
    const oldRanges: [number, number][] = [], newRanges: [number, number][] = [];
    let a = removed.start, b = added.start, common = 0;
    const push = (ranges: [number, number][], text: string, start: number, end: number) => {
      const last = ranges.at(-1);
      // Joining across a lone space keeps a rewritten phrase as one highlight.
      if (last && /^[ \t]{0,2}$/.test(text.slice(last[1], start))) last[1] = end; else ranges.push([start, end]);
    };
    for (const part of parts) {
      const size = part.value.length;
      if (part.removed) { push(oldRanges, this.before.text, a, a + size); a += size; }
      else if (part.added) { push(newRanges, this.after.text, b, b + size); b += size; }
      else { common += size; a += size; b += size; }
    }
    if (common / Math.max(oldText.length, newText.length, 1) < WORD_DIFF_MIN_COMMON) return null;
    removed.changed = oldRanges; added.changed = newRanges;
    return run.changed!;
  }
  private spans(run: Run, text: string, start: number, end: number): [number, number][] | undefined {
    const ranges = this.wordChanges(run); if (!ranges?.length) return;
    let low = 0, high = ranges.length;
    while (low < high) { const mid = (low + high) >> 1; if (ranges[mid][1] <= start) low = mid + 1; else high = mid; }
    const result: [number, number][] = [];
    for (let i = low; i < ranges.length && ranges[i][0] < end; i++) result.push([Math.max(ranges[i][0], start) - start, Math.min(ranges[i][1], end) - start]);
    // A fully changed row already reads as changed from its background.
    const visible = text.replace(/\r?\n$/, "").length;
    if (!result.length || result.length === 1 && result[0][0] === 0 && result[0][1] >= visible) return;
    return result;
  }
  private row(section: Section, row: number): DiffRow {
    const { run } = section, index = this.index(run);
    const [start, end] = index.range(run.start, run.end, section.first + row), location = index.location(start);
    const next = run.kind === "equal" ? this.after.location(run.other + start - run.start) : location;
    const text = index.text.slice(start, end), spans = run.kind === "equal" ? undefined : this.spans(run, text, start, end);
    return { kind: run.kind, text, ...(spans ? { spans } : {}),
      ...(run.kind !== "add" ? { oldLine: location.line, oldColumn: location.column } : {}),
      ...(run.kind !== "remove" ? { newLine: next.line, newColumn: next.column } : {}) };
  }
  page(cursor = 0, fold?: number, limit = PAGE_ROWS): DiffPage {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_ROWS) throw new Error("Invalid diff page size.");
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Invalid diff page.");
    const selected = fold === undefined ? undefined : this.sections[fold];
    if (fold !== undefined && (!selected || !selected.fold)) throw new Error("This context section is unavailable.");
    const total = selected ? selected.count : this.total;
    if (cursor > Math.max(0, total - 1)) throw new Error("This diff page is outside the available range.");
    const items: DiffPage["items"] = [];
    const end = Math.min(total, cursor + limit);
    if (selected) for (let i = cursor; i < end; i++) items.push(this.row(selected, i));
    else for (const [id, section] of this.sections.entries()) {
      if (section.cursor >= end) break;
      const size = section.fold ? 1 : section.count;
      if (section.cursor + size <= cursor) continue;
      if (section.fold) {
        const index = this.index(section.run), [start] = index.range(section.run.start, section.run.end, section.first);
        const [, finish] = index.range(section.run.start, section.run.end, section.first + section.count - 1);
        items.push({ kind: "fold", id, rows: section.count, characters: finish - start });
      } else for (let i = Math.max(0, cursor - section.cursor); i < Math.min(section.count, end - section.cursor); i++) items.push(this.row(section, i));
    }
    return { items, cursor, total, ...(end < total ? { next: end } : {}), ...(cursor ? { previous: Math.max(0, cursor - limit) } : {}),
      ...(!selected ? { note: this.note, nextChange: this.sections.find(s => !s.fold && s.run.kind !== "equal" && s.cursor >= end)?.cursor } : {}) };
  }
}
