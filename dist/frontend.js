// src/shared.ts
var DEFAULT_ACCEPTABLE_DEPTH = 2;
var DEFAULT_SETTINGS = {
  mode: "warn",
  acceptableDepth: null,
  acceptableTokens: null,
  forceConsistency: false,
  overflowPlacement: "end",
  refreshEnabled: true,
  refreshEvery: 20,
  autoRefreshEnabled: false,
  autoRefreshMinutes: 10,
  autoRefreshLimit: 3,
  cacheTtl: true,
  hiddenCategories: []
};
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/settings.ts
function validateSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid cache settings.");
  const v = value;
  const result = { ...DEFAULT_SETTINGS, ...v };
  if (!["pause", "warn", "off"].includes(result.mode))
    throw new Error("Choose Pause, Warn or Off for LumiCache.");
  for (const [key, max] of [["acceptableDepth", 1e5], ["acceptableTokens", 2000000], ["refreshEvery", 1e5], ["autoRefreshMinutes", 1440], ["autoRefreshLimit", 1000]]) {
    const n = result[key];
    const required = key !== "acceptableDepth" && key !== "acceptableTokens";
    if (!required && n === null)
      continue;
    if (typeof n !== "number" || !Number.isInteger(n) || n < (required ? 1 : 0) || n > max)
      throw new Error(`Invalid ${key}: enter a whole number${required ? " greater than zero" : " or leave the limit blank"}.`);
  }
  for (const key of ["forceConsistency", "refreshEnabled", "autoRefreshEnabled", "cacheTtl"])
    if (typeof result[key] !== "boolean")
      throw new Error(`Invalid ${key}.`);
  if (!["end", "boundary"].includes(result.overflowPlacement))
    throw new Error("Choose a valid injection destination.");
  if (!Array.isArray(result.hiddenCategories) || result.hiddenCategories.some((k) => !["risk", "issue", "depth", "variabled"].includes(k)))
    throw new Error("Invalid category filters.");
  return {
    mode: result.mode,
    acceptableDepth: result.acceptableDepth,
    acceptableTokens: result.acceptableTokens,
    forceConsistency: result.forceConsistency,
    overflowPlacement: result.overflowPlacement,
    refreshEnabled: result.refreshEnabled,
    refreshEvery: result.refreshEvery,
    autoRefreshEnabled: result.autoRefreshEnabled,
    autoRefreshMinutes: result.autoRefreshMinutes,
    autoRefreshLimit: result.autoRefreshLimit,
    cacheTtl: result.cacheTtl,
    hiddenCategories: [...new Set(result.hiddenCategories)]
  };
}

// src/cache-ttl.ts
var TTL_PROVIDERS = "Kimi K3 and K3.1 Pro on Moonshot (1 hour), and OpenAI GPT-4.1, GPT-5, GPT-5.1, GPT-5.2, GPT-5.4 and GPT-5.5 (24 hours)";

// src/ui/elements.ts
function el(tag, className = "", text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined)
    node.textContent = text;
  return node;
}
function externalLink(label, url) {
  const node = el("a", "lc-link", label);
  node.href = url;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}
function button(label, action, className = "") {
  const node = el("button", `lc-button ${className}`, label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

// src/ui/settings.ts
function policySettings(value, busy, save) {
  const initial = validateSettings(value), draft = { ...initial }, root = el("div", "lc-policy-settings");
  const fields = [], state = el("span", "lc-muted");
  state.setAttribute("role", "status");
  const apply = button("Save settings", () => {
    if (fields.some((input) => !input.checkValidity())) {
      fields.find((input) => !input.checkValidity())?.reportValidity();
      return;
    }
    const { hiddenCategories: _filters, ...patch } = draft;
    save(patch);
  }, "lc-primary");
  apply.dataset.setting = "save";
  const update = () => {
    const dirty = JSON.stringify(draft) !== JSON.stringify(initial), valid = fields.every((input) => input.checkValidity());
    apply.disabled = busy || !dirty || !valid;
    state.textContent = !valid ? "Enter valid whole numbers" : dirty ? "Unsaved changes" : "";
  };
  const section = (title) => {
    const group = el("fieldset", "lc-settings-group");
    group.append(el("legend", "", title));
    root.append(group);
    return group;
  };
  const select = (parent, key, title, options) => {
    const row = el("label", "lc-setting-row"), input = el("select", "lc-select");
    input.dataset.setting = key;
    input.setAttribute("aria-label", title);
    input.disabled = busy;
    for (const [value, label] of options) {
      const option = el("option", "", label);
      option.value = value;
      input.append(option);
    }
    input.value = draft[key];
    input.addEventListener("change", () => {
      Object.assign(draft, { [key]: input.value });
      update();
    });
    row.append(el("span", "", title), input);
    parent.append(row);
    return row;
  };
  const number = (parent, key, title, placeholder) => {
    const required = key !== "acceptableDepth" && key !== "acceptableTokens";
    const row = el("label", "lc-setting-row"), input = el("input", "lc-number");
    input.type = "number";
    input.min = required ? "1" : "0";
    input.max = key === "acceptableTokens" ? "2000000" : key === "autoRefreshMinutes" ? "1440" : key === "autoRefreshLimit" ? "1000" : "100000";
    input.step = "1";
    input.required = required;
    input.value = draft[key] === null ? "" : String(draft[key]);
    input.placeholder = placeholder;
    input.disabled = busy;
    input.dataset.setting = key;
    input.setAttribute("aria-label", title);
    fields.push(input);
    const changed = () => {
      Object.assign(draft, { [key]: input.value === "" ? null : Number(input.value) });
      update();
    };
    input.addEventListener("input", changed);
    input.addEventListener("change", changed);
    row.append(el("span", "", title), input);
    parent.append(row);
    return row;
  };
  const toggle = (parent, key, title, subtitle, changed) => {
    const label = el("label", "lc-setting-row lc-switch-row"), copy = el("span", "lc-setting-copy"), input = el("input", "lc-switch");
    input.type = "checkbox";
    input.checked = draft[key];
    input.disabled = busy;
    input.setAttribute("role", "switch");
    input.setAttribute("aria-label", title);
    input.dataset.setting = key;
    input.addEventListener("change", () => {
      draft[key] = input.checked;
      changed();
      update();
    });
    copy.append(el("strong", "", title), el("small", "lc-muted", subtitle));
    label.append(copy, input);
    parent.append(label);
  };
  select(root, "mode", "Cache-break behavior", [["pause", "Pause and review"], ["warn", "Warn and send"], ["off", "Off"]]);
  const tail = section("Mutable tail");
  number(tail, "acceptableDepth", "Acceptable depth", String(DEFAULT_ACCEPTABLE_DEPTH));
  number(tail, "acceptableTokens", "History token limit", "Not considered");
  tail.append(el("p", "lc-muted", `Depth counts history messages from the most recent. Blank depth uses the default of ${DEFAULT_ACCEPTABLE_DEPTH}. A blank token limit is ignored, and a set limit co-applies with depth.`));
  const force = section("Consistency");
  let destination, refresh;
  toggle(force, "forceConsistency", "Force cache consistency", "Restore prior prompt content before sending.", () => {
    destination.hidden = refresh.hidden = !draft.forceConsistency;
  });
  destination = select(force, "overflowPlacement", "Move out-of-range injections", [["end", "After the last message"], ["boundary", "At the allowed boundary"]]);
  destination.hidden = !draft.forceConsistency;
  refresh = section("Periodic refresh");
  refresh.hidden = !draft.forceConsistency;
  let interval;
  toggle(refresh, "refreshEnabled", "Allow scheduled cache breaks", "Apply current prompt changes after a set number of replies.", () => {
    interval.hidden = !draft.refreshEnabled;
  });
  interval = number(refresh, "refreshEvery", "Successful replies between refreshes", "20");
  interval.hidden = !draft.refreshEnabled;
  const lifetime = section("Cache lifetime");
  toggle(lifetime, "cacheTtl", "Set long cache lifetime", "Asks supported providers to keep your cache longer after your last request. Cache writes can cost more.", () => {});
  lifetime.append(el("p", "lc-muted", `Supported: ${TTL_PROVIDERS}. Anthropic and NanoGPT Claude connections set this in their own connection settings. Health warns at the top when your provider's cache lifetime may be too short.`));
  const idle = section("Keep Cache Warm");
  let idleFields = [];
  toggle(idle, "autoRefreshEnabled", "Keep Cache Warm", "Periodically resends the chat's last prompt to prevent cache expiry.", () => {
    idleFields.forEach((field) => {
      field.hidden = !draft.autoRefreshEnabled;
    });
  });
  idleFields = [number(idle, "autoRefreshMinutes", "Minutes between refreshes", "10"), number(idle, "autoRefreshLimit", "Maximum refreshes after each reply", "3"), el("p", "lc-muted", "Starts after a successful reply. Set the interval ~30s shorter than your provider's cache lifetime. You can also turn this on or off from the input bar drawer.")];
  idle.append(idleFields[2]);
  idleFields.forEach((field) => {
    field.hidden = !draft.autoRefreshEnabled;
  });
  const actions = el("div", "lc-settings-actions");
  actions.append(state, apply);
  root.append(actions);
  update();
  return Object.assign(root, { setBusy(value) {
    busy = value;
    root.querySelectorAll("input,select").forEach((input) => {
      input.disabled = value;
    });
    update();
  } });
}

// src/ui/bridge.ts
class BackendReplyError extends Error {
}

class Bridge {
  ctx;
  pending = new Map;
  unsubscribe;
  disposed = false;
  constructor(ctx) {
    this.ctx = ctx;
    this.unsubscribe = ctx.onBackendMessage((raw) => {
      const message = raw;
      if (message?.type !== "reply")
        return;
      const request = this.pending.get(message.id);
      if (!request)
        return;
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      if (message.error)
        request.reject(new BackendReplyError(message.error));
      else
        request.resolve(message.value);
    });
  }
  call(operation, input) {
    if (this.disposed)
      return Promise.reject(new Error("Extension unloaded."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = operation === "simulate" ? 300000 : operation === "audit" || operation === "prepareSimulation" ? 120000 : 15000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("LumiCache did not respond. Check the connection and extension permissions."));
      }, timeout);
      this.pending.set(id, { resolve: (value) => resolve(value), reject, timer });
      try {
        this.ctx.sendToBackend({ type: "request", id, operation, input });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  dispose() {
    this.disposed = true;
    this.unsubscribe();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Extension unloaded."));
    }
    this.pending.clear();
  }
}

// src/ui/diff.ts
var markWhitespace = (text) => text.replaceAll(" ", "·").replaceAll("\t", "⇥").replaceAll("\r", "␍").replaceAll(`
`, `↵
`);
var painted = new WeakMap;
function paint(node, text, spans, whitespace) {
  painted.set(node, { text, spans });
  const show = (value) => whitespace ? markWhitespace(value) : value;
  if (!spans?.length) {
    node.textContent = show(text);
    return;
  }
  node.replaceChildren();
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start > cursor)
      node.append(show(text.slice(cursor, start)));
    node.append(el("mark", "lc-word", show(text.slice(start, end))));
    cursor = end;
  }
  if (cursor < text.length)
    node.append(show(text.slice(cursor)));
}
function whenVisible(host, load) {
  const marker = el("div", "lc-more");
  marker.setAttribute("aria-hidden", "true");
  host.append(marker);
  const run = () => {
    load().finally(() => marker.remove());
  };
  if (typeof IntersectionObserver === "undefined") {
    run();
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting))
      return;
    observer.disconnect();
    run();
  }, { rootMargin: "600px 0px" });
  observer.observe(marker);
}
var lineNumber = (row) => row.newLine ?? row.oldLine;
var startsLine = (row) => (row.newColumn ?? row.oldColumn ?? 1) <= 1;
function widen(host, value) {
  if (value === undefined)
    return;
  const digits = String(value).length;
  if (digits > Number(host.style.getPropertyValue("--lc-num") || 0))
    host.style.setProperty("--lc-num", String(digits));
}
function foldLabel(item) {
  return `Expand context · ${item.characters.toLocaleString()} unchanged characters`;
}
function renderPrompt(snapshot, client) {
  return renderMessages(undefined, snapshot, client);
}
function renderDiff(check, client) {
  if (!check.before)
    return el("p", "lc-muted", "Send a reply to inspect the cache diff.");
  const root = el("div", "lc-diffs");
  if (check.comparison.routeChanged) {
    const detail = el("details", "lc-change");
    detail.open = true;
    detail.append(el("summary", "", "Connection / model changed"));
    const pair = el("div", "lc-pair");
    for (const [label, value] of [["Before", check.before.route], ["After", check.after.route]]) {
      const panel = el("div");
      panel.append(el("strong", "", label), el("pre", "lc-raw", JSON.stringify(JSON.parse(value), null, 2)));
      pair.append(panel);
    }
    detail.append(pair);
    root.append(detail);
  }
  root.append(renderMessages(check.before, check.after, client, check.comparison.firstMessage));
  return root;
}
function renderMessages(before, after, client, firstMessage) {
  const root = el("div", "lc-diffs"), toolbar = el("div", "lc-toolbar"), list = el("div");
  let showWhitespace = false, includeUnchanged = false, revision = 0;
  const whitespace = el("input");
  whitespace.type = "checkbox";
  const field = el("label", "lc-muted");
  field.append(whitespace, document.createTextNode("Show whitespace"));
  toolbar.append(field);
  const include = el("input");
  include.type = "checkbox";
  const includeField = el("label", "lc-muted");
  includeField.append(include, document.createTextNode("Include unchanged messages"));
  toolbar.append(includeField);
  includeField.hidden = !before;
  const display = el("details", "lc-diff-options");
  display.append(el("summary", "", "Display options"), toolbar);
  root.append(display, list);
  whitespace.addEventListener("change", () => {
    showWhitespace = whitespace.checked;
    for (const node of root.querySelectorAll(".lc-line-text")) {
      const value = painted.get(node);
      if (value)
        paint(node, value.text, value.spans, showWhitespace);
    }
  });
  include.addEventListener("change", () => {
    includeUnchanged = include.checked;
    load();
  });
  function line(row, host) {
    const kind = before ? row.kind : "context";
    const node = el("div", `lc-diff-row lc-${kind}${before ? "" : " lc-reference"}`);
    const number = lineNumber(row);
    widen(host, number);
    const gutter = el("span", "lc-line-number", startsLine(row) && number !== undefined ? String(number) : "");
    if (row.oldLine !== undefined && row.newLine !== undefined && row.oldLine !== row.newLine)
      gutter.title = `Line ${row.oldLine} before, ${row.newLine} now`;
    const sign = kind === "add" ? "+ " : kind === "remove" ? "− " : "  ";
    const value = el("span", "lc-line-text");
    paint(value, `${sign}${row.text}`, row.spans?.map(([start, end]) => [start + sign.length, end + sign.length]), showWhitespace);
    node.append(gutter, value);
    return node;
  }
  function showPage(host, id, first, fold) {
    host.replaceChildren();
    if (first.note)
      host.append(el("p", "lc-muted", first.note));
    const rows = el("div", "lc-diff");
    host.append(rows);
    let collapsePrevious;
    const append = (page) => {
      for (const item of page.items) {
        if (item.kind !== "fold") {
          rows.append(line(item, rows));
          continue;
        }
        const holder = el("div", "lc-fold"), context = el("div");
        let opened = false, loading = false;
        const collapse = () => {
          context.replaceChildren();
          opened = false;
          expand.setAttribute("aria-expanded", "false");
        };
        const expand = button(foldLabel(item), () => {
          if (opened) {
            collapse();
            return;
          }
          if (loading)
            return;
          loading = true;
          expand.disabled = true;
          client.call("diffPage", { id, fold: item.id, cursor: 0 }).then((next) => {
            collapsePrevious?.();
            collapsePrevious = collapse;
            opened = true;
            expand.setAttribute("aria-expanded", "true");
            showPage(context, id, next, item.id);
          }).catch((error) => context.replaceChildren(el("p", "lc-error", errorText(error)))).finally(() => {
            loading = false;
            expand.disabled = false;
          });
        });
        expand.setAttribute("aria-expanded", "false");
        holder.append(expand, context);
        rows.append(holder);
      }
      if (page.next === undefined)
        return;
      whenVisible(rows, () => client.call("diffPage", { id, cursor: page.next, fold }).then(append).catch((error) => {
        rows.append(el("p", "lc-error", errorText(error)));
      }));
    };
    append(first);
  }
  function message(change, open) {
    const details = el("details", "lc-change"), body = el("div", "lc-message-diff");
    const identity = `message ${(change.newIndex ?? change.oldIndex ?? 0) + 1}`;
    details.append(el("summary", "", `${change.role[0].toUpperCase() + change.role.slice(1)} · ${identity}${before && change.kind === "added" ? " · added" : before && change.kind === "removed" ? " · removed" : ""}`), body);
    let rendered = false, request = 0;
    const show = () => {
      if (!details.open) {
        request++;
        rendered = false;
        body.replaceChildren();
        return;
      }
      if (rendered)
        return;
      rendered = true;
      const active = ++request;
      for (const part of change.headerChanged ? ["header", "body"] : ["body"]) {
        const panel = el("div");
        if (part === "header")
          body.append(el("h3", "", "Message metadata changed"));
        panel.append(el("p", "lc-muted", "Loading diff…"));
        body.append(panel);
        client.call("diffOpen", { before: before?.reference, after: after.reference, oldIndex: change.oldIndex, newIndex: change.newIndex, part }).then((result) => {
          if (active === request)
            showPage(panel, result.id, result.page);
        }).catch((error) => {
          if (active === request)
            panel.replaceChildren(el("p", "lc-error", errorText(error)));
        });
      }
    };
    details.addEventListener("toggle", show);
    if (open) {
      details.open = true;
      show();
    }
    return details;
  }
  async function load() {
    const current = ++revision;
    list.replaceChildren(el("p", "lc-muted", "Loading changed messages…"));
    try {
      if (!after.reference || before && !before.reference)
        throw new Error("Prompt reference unavailable. Refresh the cache check.");
      const first = await client.call("diffList", { before: before?.reference, after: after.reference, cursor: 0, includeUnchanged });
      if (current !== revision)
        return;
      list.replaceChildren();
      if (first.unchanged)
        list.append(el("p", "lc-muted", `${first.unchanged.toLocaleString()} unchanged messages${includeUnchanged ? " included" : " hidden"}`));
      if (first.note)
        list.append(el("p", "lc-muted", first.note));
      const items = el("div");
      list.append(items);
      const append = (page) => {
        for (const item of page.items)
          items.append(message(item, page.cursor === 0 && (page.total === 1 || (before ? item.oldIndex !== undefined && item.oldIndex === firstMessage : item.newIndex === 0))));
        if (page.next === undefined)
          return;
        whenVisible(list, async () => {
          try {
            const next = await client.call("diffList", { before: before?.reference, after: after.reference, cursor: page.next, includeUnchanged });
            if (current === revision)
              append(next);
          } catch (error) {
            if (current === revision)
              list.append(el("p", "lc-error", errorText(error)));
          }
        });
      };
      append(first);
    } catch (error) {
      if (current === revision)
        list.replaceChildren(el("p", "lc-error", errorText(error)));
    }
  }
  load();
  return root;
}
function renderTurnDiff(before, after, target, client) {
  const root = el("div", "lc-sbs-root");
  const paired = !!before && target.oldIndex !== undefined && target.newIndex !== undefined && !target.same;
  const onlyBefore = target.newIndex === undefined;
  let showWhitespace = false;
  if (paired) {
    const toggle = el("input");
    toggle.type = "checkbox";
    const field = el("label", "lc-muted lc-sbs-tools");
    field.append(toggle, document.createTextNode("Show whitespace"));
    root.append(field);
    toggle.addEventListener("change", () => {
      showWhitespace = toggle.checked;
      for (const node of root.querySelectorAll(".lc-line-text")) {
        const value = painted.get(node);
        if (value)
          paint(node, value.text, value.spans, showWhitespace);
      }
    });
  }
  function stream(host, id, first, fold) {
    const rows = el("div", `lc-sbs${paired ? "" : " lc-sbs-single"}`);
    host.append(rows);
    let waiting = [];
    const cell = (row) => {
      const node = el("div", `lc-sbs-cell${row && paired ? ` lc-${row.kind === "equal" ? "context" : row.kind}` : ""}${row ? "" : " lc-sbs-empty"}`);
      if (!row)
        return node;
      const number = paired && row.kind === "remove" ? row.oldLine : lineNumber(row);
      widen(rows, number);
      const text = el("span", "lc-line-text");
      paint(text, row.text, paired ? row.spans : undefined, showWhitespace);
      node.append(el("span", "lc-line-number", startsLine(row) && number !== undefined ? String(number) : ""), text);
      return node;
    };
    const add = (row) => {
      if (!paired) {
        const line = el("div", "lc-sbs-row");
        line.append(cell(row));
        rows.append(line);
        return;
      }
      if (row.kind === "add" && waiting.length) {
        const line = waiting.shift();
        line.lastElementChild.replaceWith(cell(row));
        return;
      }
      const line = el("div", "lc-sbs-row");
      rows.append(line);
      if (row.kind === "remove") {
        line.append(cell(row), cell());
        waiting.push(line);
        return;
      }
      waiting = [];
      if (row.kind === "add")
        line.append(cell(), cell(row));
      else
        line.append(cell(row), cell(row));
    };
    const expandFold = (item, holder, control) => {
      client.call("diffPage", { id, fold: item.id, cursor: 0 }).then((next) => {
        control?.remove();
        stream(holder, id, next, item.id);
      }).catch((error) => holder.append(el("p", "lc-error", errorText(error))));
    };
    const append = (page) => {
      for (const item of page.items) {
        if (item.kind !== "fold") {
          add(item);
          continue;
        }
        waiting = [];
        const holder = el("div", "lc-fold");
        rows.append(holder);
        if (page.items.length === 1 && page.next === undefined) {
          expandFold(item, holder);
          continue;
        }
        const control = button(foldLabel(item), () => {
          control.disabled = true;
          expandFold(item, holder, control);
        });
        holder.append(control);
      }
      if (page.next === undefined)
        return;
      whenVisible(rows, () => client.call("diffPage", { id, cursor: page.next, fold }).then(append).catch((error) => {
        rows.append(el("p", "lc-error", errorText(error)));
      }));
    };
    append(first);
  }
  const open = (part, host) => {
    const loading = el("p", "lc-muted", "Loading…");
    host.append(loading);
    const reference = onlyBefore ? before?.reference : after.reference, index = onlyBefore ? target.oldIndex : target.newIndex;
    const input = paired ? { before: before.reference, after: after.reference, oldIndex: target.oldIndex, newIndex: target.newIndex, part } : { after: reference, newIndex: index, part };
    client.call("diffOpen", input).then((result) => {
      loading.remove();
      if (result.page.note)
        host.append(el("p", "lc-muted", result.page.note));
      stream(host, result.id, result.page);
    }).catch((error) => loading.replaceWith(el("p", "lc-error", errorText(error))));
  };
  if (paired) {
    const heads = el("div", "lc-sbs-heads");
    heads.append(el("strong", "", "Before"), el("strong", "", "Now"));
    root.append(heads);
    if (target.headerChanged) {
      const panel = el("div");
      root.append(el("h3", "", "Message metadata changed"), panel);
      open("header", panel);
      root.append(el("h3", "", "Message text"));
    }
  }
  const panel = el("div");
  root.append(panel);
  open("body", panel);
  return root;
}

// src/ui/styles.ts
var ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg>`;
var STYLES = `
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
.lc-pinned { display:flex; gap:9px; padding:10px 12px; border:1px solid var(--lc-issue); border-radius:9px; background:color-mix(in srgb,var(--lc-issue) 9%,transparent); }
.lc-pinned-risk { border-color:var(--lc-risk); background:color-mix(in srgb,var(--lc-risk) 9%,transparent); }
.lc-pinned .lc-row-copy { display:flex; flex-direction:column; gap:3px; min-width:0; }
.lc-pinned p { margin:0; font-size:12px; overflow-wrap:anywhere; }
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

// src/ui/timeline.ts
var KIND_LABELS = { system: "System prompt", character: "Character", persona: "Persona", world: "World info", story: "Story", injection: "Injection", memory: "Memory", extension: "Extension", other: "Other" };
var STATUS_LABELS = { base: "", kept: "", new: "New", rewritten: "Recached", changed: "Changed", added: "Added", removed: "Removed" };
var isProblem = (row) => row.status === "changed" || row.status === "added" || row.status === "removed";
var tokens = (characters) => {
  const value = Math.round(characters / 4);
  return `~${value >= 1000 ? `${(value / 1000).toFixed(value >= 1e4 ? 0 : 1)}k` : value} tok`;
};
var turnName = (row) => row.kind === "story" && row.chatIndex !== undefined ? `Turn ${row.chatIndex + 1} · ${row.label}` : row.label;
var rowHeight = (characters) => Math.round(46 + Math.min(34, Math.max(0, Math.log10(Math.max(1, characters)) - 2) * 12));
var breakText = (tolerated) => tolerated ? "Change starts here, inside your allowed tail." : "Cache breaks here. Because this is outside your tail, your entire context is at risk of cache invalidation.";
function renderTimeline(data, open) {
  const root = el("div", `lc-tl${data.tolerated ? " lc-tl-tolerated" : ""}`), head = el("div", "lc-tl-head"), legend = el("div", "lc-tl-legend");
  const body = el("div", "lc-tl-body"), rail = el("div", "lc-rail"), list = el("div", "lc-tl-list"), thumb = el("div", "lc-rail-thumb");
  list.id = `lc-tl-${Math.random().toString(36).slice(2)}`;
  list.tabIndex = 0;
  list.setAttribute("aria-label", "Prompt timeline, first message to last");
  for (const kind of Object.keys(KIND_LABELS)) {
    if (!data.rows.some((row) => row.parts.some((part) => part.kind === kind) || row.kind === kind))
      continue;
    const item = el("span", "lc-tl-key");
    item.dataset.kind = kind;
    item.append(el("i"), KIND_LABELS[kind]);
    legend.append(item);
  }
  head.append(legend);
  const nodes = [], problems = [];
  let breakTop;
  for (const row of data.rows) {
    if (row.root) {
      breakTop = el("div", "lc-tl-break", breakText(data.tolerated));
      list.append(breakTop);
    }
    const node = button("", () => open(row), "lc-turn");
    node.dataset.status = row.status;
    node.dataset.kind = row.kind;
    node.style.minHeight = `${rowHeight(row.characters)}px`;
    const stripe = el("span", "lc-turn-stripe");
    for (const part of row.parts.length ? row.parts : [{ kind: row.kind, share: 1, label: row.label }]) {
      const piece = el("i");
      piece.dataset.kind = part.kind;
      piece.style.flexGrow = String(Math.max(0.04, part.share));
      stripe.append(piece);
    }
    const copy = el("span", "lc-turn-copy"), title = el("span", "lc-turn-title");
    title.append(el("span", "lc-turn-kind", KIND_LABELS[row.kind]), el("span", "lc-turn-name", turnName(row)));
    copy.append(title, el("span", "lc-turn-preview", row.preview));
    const meta = el("span", "lc-turn-meta");
    if (STATUS_LABELS[row.status])
      meta.append(el("span", "lc-turn-status", STATUS_LABELS[row.status]));
    meta.append(el("span", "lc-turn-size", tokens(row.characters)));
    node.append(stripe, copy, meta);
    node.setAttribute("aria-label", [`Message ${(row.newIndex ?? row.oldIndex ?? 0) + 1}`, KIND_LABELS[row.kind], turnName(row), STATUS_LABELS[row.status], "Open details"].filter(Boolean).join(", "));
    list.append(node);
    nodes.push(node);
    if (isProblem(row))
      problems.push(node);
  }
  const bands = [];
  data.rows.forEach((row, index) => {
    const last = bands.at(-1);
    if (last && !isProblem(row) && !isProblem(last.row) && last.row.kind === row.kind) {
      last.last = index;
      return;
    }
    const band = el("div", `lc-rail-band${isProblem(row) ? " lc-rail-problem" : ""}`);
    band.dataset.kind = row.kind;
    bands.push({ first: index, last: index, row, node: band });
    rail.append(band);
  });
  const lost = el("div", "lc-rail-lost");
  lost.hidden = !breakTop;
  rail.append(lost, thumb);
  rail.setAttribute("role", "scrollbar");
  rail.setAttribute("aria-orientation", "vertical");
  rail.setAttribute("aria-controls", list.id);
  rail.setAttribute("aria-label", "Prompt overview");
  rail.tabIndex = 0;
  let position, placed = false;
  const syncThumb = () => {
    const height = rail.clientHeight, full = list.scrollHeight;
    if (!height || !full)
      return;
    thumb.style.top = `${list.scrollTop / full * height}px`;
    thumb.style.height = `${Math.max(14, list.clientHeight / full * height)}px`;
    const range = full - list.clientHeight;
    rail.setAttribute("aria-valuenow", String(range > 0 ? Math.round(list.scrollTop / range * 100) : 0));
  };
  const layout = () => {
    const height = rail.clientHeight, full = list.scrollHeight;
    if (!height || !full)
      return;
    for (const band of bands) {
      const start = nodes[band.first], end = nodes[band.last], top = start.offsetTop / full * height;
      band.node.style.top = `${top}px`;
      band.node.style.height = `${Math.max(isProblem(band.row) ? 4 : 1, (end.offsetTop + end.offsetHeight - start.offsetTop) / full * height)}px`;
      band.node.title = band.first === band.last ? turnName(band.row) : `${KIND_LABELS[band.row.kind]} · ${band.last - band.first + 1} messages`;
    }
    if (breakTop) {
      const top = breakTop.offsetTop / full * height;
      lost.style.top = `${top}px`;
      lost.style.height = `${Math.max(0, height - top)}px`;
    }
    syncThumb();
  };
  const attached = () => {
    if (!list.clientHeight)
      return;
    if (position !== undefined)
      list.scrollTop = position;
    else if (!placed) {
      placed = true;
      if (breakTop)
        list.scrollTop = Math.max(0, breakTop.offsetTop - 12);
    }
    layout();
  };
  list.addEventListener("scroll", () => {
    position = list.scrollTop;
    syncThumb();
  });
  let grab;
  const moveTo = (y) => {
    const bounds = rail.getBoundingClientRect();
    if (!bounds.height)
      return;
    const thumbHeight = thumb.offsetHeight;
    list.scrollTop = (y - bounds.top - (grab ?? thumbHeight / 2)) / bounds.height * list.scrollHeight;
  };
  rail.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    rail.focus({ preventScroll: true });
    const bounds = thumb.getBoundingClientRect();
    grab = event.clientY >= bounds.top && event.clientY <= bounds.bottom ? event.clientY - bounds.top : undefined;
    rail.setPointerCapture?.(event.pointerId);
    rail.dataset.dragging = "true";
    moveTo(event.clientY);
    if (grab === undefined)
      grab = thumb.offsetHeight / 2;
  });
  rail.addEventListener("pointermove", (event) => {
    if (rail.dataset.dragging)
      moveTo(event.clientY);
  });
  const release = () => {
    delete rail.dataset.dragging;
    grab = undefined;
  };
  rail.addEventListener("pointerup", release);
  rail.addEventListener("pointercancel", release);
  rail.addEventListener("wheel", (event) => {
    event.preventDefault();
    list.scrollTop += event.deltaY;
  }, { passive: false });
  rail.addEventListener("keydown", (event) => {
    const page = list.clientHeight * 0.9;
    const moves = { ArrowUp: list.scrollTop - 60, ArrowDown: list.scrollTop + 60, PageUp: list.scrollTop - page, PageDown: list.scrollTop + page, Home: 0, End: list.scrollHeight };
    if (!(event.key in moves))
      return;
    event.preventDefault();
    list.scrollTop = moves[event.key];
  });
  if (problems.length) {
    const nav = el("div", "lc-tl-nav");
    let current = -1;
    const count = el("span", "lc-muted", `${problems.length} ${problems.length === 1 ? "change" : "changes"}`);
    const go = (step) => {
      current = (current + step + problems.length) % problems.length;
      const node = problems[current];
      list.scrollTop = Math.max(0, node.offsetTop - 40);
      count.textContent = `${current + 1} of ${problems.length}`;
      node.focus({ preventScroll: true });
    };
    const previous = button("↑", () => go(-1), "lc-tl-step"), next = button("↓", () => go(1), "lc-tl-step");
    previous.setAttribute("aria-label", "Previous change");
    next.setAttribute("aria-label", "Next change");
    nav.append(count, previous, next);
    head.append(nav);
  }
  body.append(rail, list);
  root.append(head, body);
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(attached);
  observer?.observe(list);
  observer?.observe(rail);
  return { root, attached, dispose: () => observer?.disconnect() };
}

// src/health/copy.ts
function simulationCopy(source, ticket) {
  if (source.chat.id !== ticket.sourceChatId || source.messages.at(-1)?.id !== ticket.lastMessageId)
    throw new Error("The source chat changed during simulation setup. Retry with the latest history.");
  if (!source.chat.character_id)
    throw new Error("Simulation currently requires a character chat. Cache health checks also work for temporary chats.");
  const metadata = structuredClone(source.chat.metadata);
  const anchorIndex = source.messages.findIndex((message) => message.id === metadata.context_history_anchor_message_id);
  for (const key of ["_swipe_variable_state", "branched_from", "branch_at_message", "another_one_applied_variables", "another_one_fork", "context_history_anchor_message_id"])
    delete metadata[key];
  metadata.lumicache_simulation = ticket.id;
  metadata.lumicache_simulation_source = ticket.sourceChatId;
  metadata.lumicache_simulation_anchor = anchorIndex;
  let omittedAudio = 0;
  const messages = source.messages.map((message) => {
    const extra = structuredClone(message.extra ?? {});
    delete extra.variableStateBySwipe;
    if (Array.isArray(extra.attachments))
      extra.attachments = extra.attachments.filter((attachment) => {
        if (attachment && typeof attachment === "object" && attachment.type === "audio") {
          omittedAudio++;
          return false;
        }
        return true;
      });
    return {
      is_user: message.is_user,
      name: message.name,
      content: message.content,
      send_date: message.send_date,
      swipes: message.swipes,
      swipe_id: message.swipe_id,
      swipe_dates: message.swipe_dates,
      extra
    };
  });
  metadata.lumicache_omitted_audio = omittedAudio;
  return { character_id: source.chat.character_id, chat: { name: ticket.branchName, metadata }, messages };
}

// src/health/macro-catalog.ts
var names = (text) => new Set(text.trim().split(/\s+/));
var CLOCK = names("time date weekday isotime isodate datetimeformat chatage chat_age");
var TURN = names(`
  messagecount message_count lastmessageid last_message_id lastmessage last_message lastusermessage last_user_message
  lastcharmessage last_char_message lastbotmessage lastmessagename last_message_name input userinput user_input
  loomlastusermessage loomlastcharmessage loomlastmessagename lumiamessagecount lumiaooctrigger
  firstincludedmessageid first_included_message_id firstdisplayedmessageid first_displayed_message_id
  lastswipeid last_swipe_id currentswipeid current_swipe_id rejectedswipe rejected_swipe rejectedgeneration regeneratedmessage
  lastgenerationtype last_generation_type messagesby messages_by msgby
`);
var FOCUS = names(`
  chargroupfocused charfocused char_group_focused chargroupfocuseddescription charfocuseddescription char_group_focused_description
  chargroupfocusedpersonality charfocusedpersonality char_group_focused_personality groupothers group_others
  grouplastspeaker group_last_speaker
`);
var ROOM_TURN = names("currentplayer current_player currentturn current_turn");
var FETCHED = "Lumiverse fetches this for each generation, so it can differ between sends.";
var LORE = "This is filled by whichever lore entries activate.";
var RETRIEVED = new Map([
  ...[...names(`
    memories memoriesraw memoriesactive memoriescount longtermmemory chatmemory ltm
    databank databankraw databankactive databankcount databankmemory documents knowledgebank
    entities entityfacts relationships arc memorysalience cortexactive entitycount charactercolors
    websearchcontext web_search_context lumiacouncildeliberation loomcouncilresult
  `)].map((name) => [name, FETCHED]),
  ["loomsummary", "This changes each time Loom writes a new summary."],
  ["outlet", LORE],
  ["wi_marker", LORE],
  ["wimarker", LORE]
]);
var SETTINGS = names("ismobile is_mobile usercolormode user_color_mode colormode color_mode hasextension has_extension");
var CARD = names(`
  char charname description chardescription personality charpersonality scenario charscenario original
  mesexamples mes_examples examplemessages mesexamplesraw mes_examples_raw system charprompt charsystem charsystemprompt
  charposthistoryinstructions char_post_history_instructions charinstruction jailbreak charjailbreak
  chardepthprompt char_depth_prompt depth_prompt charcreatornotes char_creator_notes creatornotes
  charversion char_version charcreator char_creator firstmessage firstmes first_message
  chartags char_tags charactertags tags tag tagat tag_at chartagat nthtag tagcount tag_count tags_count numtags chartagcount hastag has_tag chartag char_tag tagged
`);
var FIXED = new Set([...CARD, ...names(`
  user notchar not_char group groupnotmuted group_not_muted groupmembercount group_member_count
  isgroupchat is_group_chat groupcardmode group_card_mode isnarrator is_narrator
  ismultiplayer is_multiplayer ismultiplayerroom is_multiplayer_room playercount player_count playerscount players_count
  players player_names playernames hostname host_name chatid chat_id
  persona userpersona persona_outlet personaoutlet
  sub subjectivepronoun personasubjectivepronoun obj objectivepronoun personaobjectivepronoun
  poss possessivepronoun personapossessivepronoun ref reflexivepronoun personareflexivepronoun
  poss_p possessivepronounstandalone personapossessivepronounstandalone
  model maxprompt maxprompttokens max_prompt maxcontext maxcontexttokens max_context maxresponse maxresponsetokens max_response
  reasoningprefix reasoning_prefix reasoningsuffix reasoning_suffix mcptools mcp_tools mcptoolsactive mcp_tools_active
  promptblockrole prompt_block_role blockrole promptblockposition prompt_block_position blockposition promptblockdepth prompt_block_depth blockdepth
  regexinstalled regex_installed hasregex has_regex banned space newline nl n
  lumiadef lumiabehavior lumiapersonality loomstyle loomutils loomretrofits lumiaooc lumiaoocerotic lumiaooceroticbleed
  lumiacouncilinst lumiaself lumiacouncilmodeactive lumiaquirks lumiacouncilquirks lumiastatesynthesis
  lumiacounciltoolsactive lumiacounciltoolslist loomsummaryprompt loomsovhandactive
`)]);
var PURE = names(`
  eq ne not gt lt gte lte empty isempty blank isblank number isnumber numeric integer isinteger int
  matches startswith starts_with endswith ends_with
  len length replace substr substring split join repeat wrap regex tokencount token_count tokens truncate
  calc math evaluate min max clamp abs floor ceil mod round rcounter
  range count listlength list_count includes contains inlist nth at first last slice take sort unique dedupe distinct
  reverselist reverse_list sum avg mean average listmax list_max listmin list_min bullets numbered ol enumerate
  path jsonget json_get jsonset json_set jsondelete json_delete jsonhas json_has jsonkeys json_keys
  jsonlength json_length jsonescape json_escape jsonpretty json_pretty jsonblock json_block
`);
var ABSORBING = names(`
  len length count listlength list_count sum avg mean average min max listmax list_max listmin list_min sort
  tokencount token_count tokens includes contains inlist empty isempty blank isblank number isnumber numeric integer isinteger int
`);

// src/health/macro-analysis.ts
var TRANSPARENT = new Set(["upper", "lower", "capitalize", "trim", "reverse"]);
// src/health/composition.ts
var KINDS = ["style", "utility", "retrofit"];
function compositionSnapshot(raw) {
  const input = raw;
  if (!input || input.available !== true)
    return { available: false };
  const out = { available: true, incomplete: input.incomplete === true, filters: {}, selections: [] };
  const depth = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1e6, Math.floor(value))) : fallback;
  if (input.sovereign)
    out.sovereign = { enabled: input.sovereign.enabled === true, excludeLastMessage: input.sovereign.excludeLastMessage !== false, includeMessageInPrompt: input.sovereign.includeMessageInPrompt !== false };
  for (const key of ["htmlTags", "detailsBlocks", "loomItems"]) {
    const value = input.filters?.[key];
    if (!value)
      continue;
    out.filters[key] = {
      enabled: value.enabled === true,
      keepDepth: depth(value.keepDepth, key === "loomItems" ? 5 : 3),
      keepOnly: value.keepOnly === true,
      stripFonts: value.stripFonts === true,
      fontKeepDepth: depth(value.fontKeepDepth, 3)
    };
  }
  let chars = 0;
  for (const item of Array.isArray(input.selections) ? input.selections : []) {
    if (!item || !KINDS.includes(item.kind) || typeof item.content !== "string")
      continue;
    if ((chars += item.content.length) > 2000000 || out.selections.length >= 200) {
      out.incomplete = true;
      continue;
    }
    out.selections.push({ id: String(item.id ?? "").slice(0, 200), name: String(item.name ?? "Loom item").slice(0, 300), kind: item.kind, content: item.content });
  }
  return out;
}

// src/ui/composition.ts
async function readComposition(api = nativeAPI) {
  const keys = ["sovereignHand", "contextFilters", "selectedLoomStyles", "selectedLoomUtils", "selectedLoomRetrofits"];
  try {
    const settings = await Promise.all(keys.map((key) => api(`settings/${key}`, "GET", undefined, true).then((value) => value?.value)));
    const selections = [];
    for (const [index, kind] of ["style", "utility", "retrofit"].entries())
      for (const item of Array.isArray(settings[index + 2]) ? settings[index + 2] : []) {
        selections.push({ id: item.id, name: item.name, content: item.content, kind });
      }
    return compositionSnapshot({ available: true, sovereign: settings[0], filters: settings[1], selections });
  } catch {
    return { available: false };
  }
}

// src/ui/simulation.ts
async function nativeAPI(path, method = "GET", body, allow404 = false) {
  const response = await fetch(`/api/v1/${path}`, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...body === undefined ? {} : { body: JSON.stringify(body) },
    signal: AbortSignal.timeout(60000)
  });
  if (response.status === 404 && allow404)
    return null;
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || `Lumiverse returned ${response.status}.`);
  return value;
}
async function simulate(bridge, input, prepared, api = nativeAPI) {
  const ticket = await bridge.call("prepareSimulation", { ...input, composition: input.composition ?? await readComposition(api) });
  prepared(ticket);
  let scratchId, report, primaryError;
  let profileCopied = false, submitted = false;
  try {
    const profile = await api(`preset-profiles/chat/${encodeURIComponent(input.chatId)}`, "GET", undefined, true);
    const source = await api(`chats/${encodeURIComponent(input.chatId)}/export`);
    const copy = simulationCopy(source, ticket);
    if (JSON.stringify(copy).length > 64000000)
      throw new Error("The conversation is too large to copy for this simulation (64 million characters). Cache health checks are still available.");
    const branch = await api("chats/import", "POST", copy);
    if (typeof branch.chat_id !== "string" || branch.chat_id === input.chatId || branch.name !== ticket.branchName)
      throw new Error("Lumiverse returned an unexpected simulation copy. The source chat was not modified.");
    scratchId = branch.chat_id;
    if (profile) {
      profileCopied = true;
      await api(`preset-profiles/chat/${encodeURIComponent(scratchId)}`, "PUT", {
        preset_id: profile.preset_id,
        block_states: profile.block_states,
        prompt_variables: profile.prompt_variables,
        linked_to_defaults: profile.linked_to_defaults
      });
    }
    submitted = true;
    report = await bridge.call("simulate", { id: ticket.id, scratchChatId: scratchId });
  } catch (error) {
    primaryError = error;
    if (error instanceof BackendReplyError)
      submitted = false;
  } finally {
    const cleanupErrors = [];
    if (scratchId && !submitted) {
      try {
        await api(`chats/${encodeURIComponent(scratchId)}`, "DELETE", undefined, true);
      } catch {
        cleanupErrors.push(`The temporary branch ${scratchId} could not be removed.`);
      }
    }
    if (scratchId && profileCopied && (!submitted || report)) {
      try {
        await api(`preset-profiles/chat/${encodeURIComponent(scratchId)}`, "DELETE", undefined, true);
      } catch {
        cleanupErrors.push(`The simulation's temporary preset profile ${scratchId} could not be removed.`);
      }
    }
    if (!submitted) {
      try {
        await bridge.call("cancelSimulation", { id: ticket.id });
      } catch {}
    }
    if (cleanupErrors.length) {
      if (report) {
        report.cleanupError = [report.cleanupError, ...cleanupErrors].filter(Boolean).join(`
`);
        report.scratchChatId = scratchId;
      } else
        primaryError = new Error(`${primaryError instanceof Error ? primaryError.message : "Simulation failed."}
${cleanupErrors.join(`
`)}`);
    }
  }
  if (primaryError)
    throw primaryError;
  return report;
}

// src/ui/auto-health.ts
var healthKey = (input) => input ? JSON.stringify([input.chatId, input.connectionId ?? ""]) : "";

class AutoHealth {
  options;
  version = 0;
  key = "";
  dirty = false;
  blocked = false;
  disposed = false;
  timer;
  pending;
  constructor(options) {
    this.options = options;
  }
  get running() {
    return !!this.pending;
  }
  get stale() {
    return this.dirty || this.running;
  }
  sync() {
    const key = healthKey(this.options.input());
    if (key === this.key)
      return;
    this.key = key;
    this.version++;
    this.dirty = !!key;
    this.schedule();
    this.options.changed();
  }
  invalidate() {
    this.version++;
    this.dirty = !!healthKey(this.options.input());
    this.schedule();
    this.options.changed();
  }
  refresh() {
    this.version++;
    this.dirty = true;
    this.schedule(0);
    this.options.changed();
  }
  suspend(blocked) {
    this.blocked = blocked;
    if (!blocked)
      this.schedule();
  }
  accept(report, input) {
    if (healthKey(input) !== healthKey(this.options.input()))
      return;
    this.version++;
    this.dirty = false;
    clearTimeout(this.timer);
    this.options.result(report, input);
    this.options.changed();
  }
  idle() {
    return this.pending ?? Promise.resolve();
  }
  schedule(delay = this.options.delay ?? 800) {
    clearTimeout(this.timer);
    if (this.disposed || this.blocked || this.pending || !this.dirty || !this.options.input())
      return;
    this.timer = setTimeout(() => {
      this.run();
    }, delay);
  }
  async run() {
    const input = this.options.input();
    if (this.disposed || this.blocked || this.pending || !input)
      return;
    const version = this.version, key = healthKey(input);
    this.dirty = false;
    const task = Promise.resolve().then(async () => {
      try {
        const report = await this.options.check(input);
        if (!this.disposed && version === this.version && key === healthKey(this.options.input()))
          this.options.result(report, input);
      } catch (error) {
        if (!this.disposed && version === this.version && key === healthKey(this.options.input()))
          this.options.error(error);
      }
    });
    this.pending = task;
    this.options.changed();
    await task;
    this.pending = undefined;
    if (!this.disposed) {
      this.options.changed();
      this.schedule();
    }
  }
  dispose() {
    this.disposed = true;
    this.version++;
    clearTimeout(this.timer);
  }
}

// src/ui/icons.ts
var paths = {
  shield: '<path d="m12 3 8 4v5c0 5-8 9-8 9S4 17 4 12V7l8-4Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z"/><path d="M12 6v14"/>',
  sliders: '<path d="M4 6h5m4 0h7M4 12h10m4 0h2M4 18h2m4 0h10"/><path d="M9 3v6m5 0v6M6 15v6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  play: '<path d="m9 5 11 7-11 7V5Z"/><path d="M4 5v14"/>',
  diff: '<path d="M7 3v12a4 4 0 0 0 4 4h6M17 3v7M4 6l3-3 3 3m4 10 3 3-3 3"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6a8 8 0 0 1 13 3M4.9 15a8 8 0 0 0 13 3"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  plug: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>'
};
function icon(name, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `lc-icon ${className}`);
  svg.innerHTML = paths[name];
  return svg;
}

// src/ui/findings.ts
function actionable(rows) {
  return rows.filter((row) => ["risk", "issue", "observed", "depth", "variabled"].includes(row.level));
}
function filtered(rows, hidden) {
  return actionable(rows).filter((r) => !hidden.includes(r.level === "depth" || r.level === "variabled" || r.level === "risk" ? r.level : "issue"));
}
function counts(rows) {
  return { risks: rows.filter((row) => row.level === "risk").length, issues: rows.filter((row) => row.level === "issue" || row.level === "observed").length };
}
var countLabel = (risks, issues) => `${risks} ${risks === 1 ? "risk" : "risks"}, ${issues} ${issues === 1 ? "issue" : "issues"}`;
function healthPill(rows, checking = false, hidden = [], toggle) {
  const { risks, issues } = counts(rows), pill = el("div", "lc-health-pill");
  pill.setAttribute("aria-label", countLabel(risks, issues));
  pill.setAttribute("role", toggle ? "group" : "status");
  if (toggle)
    pill.setAttribute("aria-label", "Filter finding classifications");
  const parts = [["risk", `${risks} ${risks === 1 ? "Risk" : "Risks"}`, "lc-risk-ink"], ["issue", `${issues} ${issues === 1 ? "Issue" : "Issues"}`, "lc-issue-ink"], ["depth", `${rows.filter((r) => r.level === "depth").length} Depth Mutable`, "lc-depth-ink"], ["variabled", `${rows.filter((r) => r.level === "variabled").length} Variabled`, "lc-variabled-ink"]];
  for (const [category, label, ink] of parts) {
    if (pill.childElementCount) {
      const divider = el("span", "lc-pill-divider", "|");
      divider.setAttribute("aria-hidden", "true");
      pill.append(divider);
    }
    const part = toggle ? button(label, () => toggle(category), `lc-pill-toggle ${ink}`) : el("span", `lc-pill-part ${ink}`, label);
    if (toggle) {
      part.setAttribute("aria-pressed", String(!hidden.includes(category)));
      part.dataset.focus = `filter-${category}`;
      part.title = `${hidden.includes(category) ? "Show" : "Hide"} ${category === "depth" ? "Depth Mutable" : category === "variabled" ? "Variabled" : category === "risk" ? "Risks" : "Issues"}. Display filter only; sending protection stays active.`;
    }
    pill.append(part);
  }
  if (checking) {
    pill.classList.add("lc-updating");
    pill.setAttribute("aria-busy", "true");
  }
  return pill;
}
var CATEGORIES = ["Depth Mutable", "Variabled", "World info", "Preset", "Compose", "Regex", "History", "Character", "Persona", "Context", "Connection", "Simulation"];
var ICONS = { "Depth Mutable": "layers", Variabled: "sliders", "World info": "book", Preset: "sliders", Compose: "sliders", Regex: "diff", History: "layers", Character: "person", Persona: "person", Context: "layers", Connection: "plug", Simulation: "play" };
function renderFindings(rows, open) {
  const root = el("div", "lc-groups");
  const disclosures = (key, className, summary, body) => {
    summary.dataset.focus = `finding-${encodeURIComponent(key)}`;
    const details = el("details", className);
    details.open = open.has(key);
    details.append(summary, body);
    details.addEventListener("toggle", () => {
      if (details.open)
        open.add(key);
      else
        open.delete(key);
    });
    return details;
  };
  const badge = (findings) => {
    const { risks, issues } = counts(findings), depths = findings.filter((r) => r.level === "depth").length, variabled = findings.filter((r) => r.level === "variabled").length, node = el("span", `lc-count ${depths ? "lc-count-depth" : issues ? "lc-count-issue" : variabled && !risks ? "lc-count-variabled" : ""}`, String(risks + issues + depths + variabled));
    node.setAttribute("aria-label", depths ? `${depths} depth mutable items, ${findings.filter((r) => r.level === "depth" && r.problematic).length} outside tolerance` : variabled && !risks && !issues ? `${variabled} variable ${variabled === 1 ? "check" : "checks"}` : countLabel(risks, issues));
    return node;
  };
  const renderItems = (findings, prefix) => {
    const list = el("div", "lc-findings-list"), items = new Map;
    for (const row of findings) {
      const key = row.itemId ?? row.item ?? row.id;
      items.set(key, [...items.get(key) ?? [], row]);
    }
    let shown = 0;
    const entries = [...items];
    const pageKey = `pages:${prefix}:`, previous = [...open].find((key) => key.startsWith(pageKey));
    const initial = previous ? Math.max(30, Number(previous.slice(pageKey.length)) || 30) : 30;
    const more = button("Show more", () => {
      append();
      for (const key of open)
        if (key.startsWith(pageKey))
          open.delete(key);
      open.add(`${pageKey}${shown}`);
    }, "lc-text-button");
    more.dataset.focus = `more-${encodeURIComponent(prefix)}`;
    const append = () => {
      more.remove();
      const end = shown ? shown + 30 : initial;
      for (const [id, rows] of entries.slice(shown, end)) {
        const first = rows[0], summary = el("summary", "lc-finding-summary"), copy = el("span", "lc-row-copy");
        copy.append(el("strong", "", first.item || first.title));
        const reasons = el("span", "lc-reasons");
        for (const row of rows)
          reasons.append(el("span", `lc-reason ${row.level === "depth" ? "lc-depth-ink" : row.level === "variabled" ? "lc-variabled-ink" : row.level === "risk" ? "" : "lc-issue-ink"}`, row.evidence?.[0]?.startsWith("{{") ? `${row.title} · ${row.evidence.map((value) => value.length <= 45 ? value : value.replace(/::.*/, "}}")).join(", ")}` : row.title));
        if (first.item)
          copy.append(reasons);
        const indicator = first.level === "depth" ? el("span", `lc-depth-status ${first.problematic ? "lc-depth-fail" : "lc-depth-pass"}`) : el("span", `lc-dot ${rows.every((row) => row.level === "variabled") ? "lc-dot-variabled" : rows.some((row) => row.level !== "risk" && row.level !== "variabled") ? "lc-dot-issue" : ""}`);
        if (first.level === "depth") {
          indicator.append(icon(first.problematic ? "x" : "check"));
          indicator.setAttribute("role", "img");
          indicator.setAttribute("aria-label", first.problematic ? "Outside configured tolerance" : "Within configured tolerance");
          indicator.title = indicator.getAttribute("aria-label");
        }
        summary.append(indicator, copy, icon("chevron", "lc-chevron"));
        const body = el("div", "lc-finding-body");
        for (const row of rows) {
          const reason = el("div", "lc-explanation");
          if (rows.length > 1)
            reason.append(el("strong", "", row.evidence?.[0]?.startsWith("{{") ? `${row.title} · ${row.evidence.map((value) => value.length <= 45 ? value : value.replace(/::.*/, "}}")).join(", ")}` : row.title));
          if (row.evidence?.length) {
            const evidence = el("div", "lc-evidence");
            for (const text of row.evidence)
              evidence.append(el("code", "", text));
            reason.append(evidence);
          }
          const detail = el("p", "", row.detail);
          if (row.link) {
            detail.append(" ");
            detail.append(externalLink(row.link.label, row.link.url));
          }
          reason.append(detail, el("p", "lc-fix", row.suggestion));
          body.append(reason);
        }
        list.append(disclosures(`${prefix}/${id}`, "lc-finding-row", summary, body));
      }
      shown = end;
      if (shown < entries.length) {
        more.textContent = `Show ${Math.min(30, entries.length - shown)} more`;
        list.append(more);
      }
    };
    append();
    return list;
  };
  for (const row of actionable(rows).filter((row) => row.pinned)) {
    const card = el("div", `lc-pinned lc-pinned-${row.level === "risk" ? "risk" : "issue"}`), copy = el("div", "lc-row-copy");
    card.setAttribute("role", "alert");
    copy.append(el("strong", "", row.title), ...row.item ? [el("small", "lc-muted", row.item)] : [], el("p", "", row.detail), el("p", "lc-fix", row.suggestion));
    card.append(el("span", row.level === "risk" ? "lc-dot" : "lc-dot lc-dot-issue"), copy);
    root.append(card);
  }
  for (const category of CATEGORIES) {
    const selected = actionable(rows).filter((row) => !row.pinned && (row.category ?? (row.level === "observed" ? "Simulation" : "Context")) === category);
    if (!selected.length)
      continue;
    const summary = el("summary", "lc-group-summary");
    summary.append(icon(ICONS[category], "lc-group-icon"), el("span", "lc-group-name", category), badge(selected), icon("chevron", "lc-chevron"));
    const body = el("div", "lc-group-body"), groups = new Map;
    for (const row of selected) {
      const key = row.groupId ?? row.group ?? "";
      groups.set(key, [...groups.get(key) ?? [], row]);
    }
    for (const [id, group] of groups) {
      if (!id || category === "Preset" && groups.size === 1) {
        body.append(renderItems(group, category));
        continue;
      }
      const title = el("summary", "lc-subgroup-summary"), copy = el("span", "lc-row-copy");
      copy.append(el("strong", "", group[0].group || id));
      const affected = new Set(group.map((row) => row.itemId ?? row.item ?? row.id)).size;
      copy.append(el("small", "lc-muted", `${affected} ${category === "World info" ? affected === 1 ? "entry" : "entries" : affected === 1 ? "item" : "items"}`));
      title.append(copy, badge(group), icon("chevron", "lc-chevron"));
      body.append(disclosures(`${category}/${id}`, "lc-subgroup", title, renderItems(group, `${category}/${id}`)));
    }
    root.append(disclosures(category, `lc-group ${category === "Depth Mutable" ? "lc-depth-group" : category === "Variabled" ? "lc-variabled-group" : ""}`, summary, body));
  }
  return root;
}

// src/ui/health.ts
var SOURCE_EVENTS = [
  "SETTINGS_UPDATED",
  "PRESET_CHANGED",
  "PRESET_DELETED",
  "PRESET_PROFILE_CHANGED",
  "CONNECTION_PROFILE_LOADED",
  "MAIN_API_CHANGED",
  "WORLD_BOOK_CHANGED",
  "WORLD_BOOK_LIBRARY_CHANGED",
  "WORLD_BOOK_DELETED",
  "WORLD_BOOK_ENTRY_CHANGED",
  "WORLD_BOOK_ENTRY_DELETED",
  "CHARACTER_EDITED",
  "CHARACTER_LIBRARY_CHANGED",
  "PERSONA_CHANGED",
  "REGEX_SCRIPT_CHANGED",
  "REGEX_SCRIPT_DELETED",
  "MESSAGE_SENT",
  "MESSAGE_EDITED",
  "MESSAGE_DELETED",
  "MESSAGE_SWIPED",
  "SWIPE_EDITED",
  "CHAT_CHANGED",
  "GENERATION_BREAKDOWN_READY"
];
var LUMIAGENT_URL = "https://github.com/AMousePad/LumiAgent";
var TEST_LABELS = ["Reference", "Regenerate", "New turn"];
var testState = (step) => step.comparison.kind !== "break" ? "held" : step.timeline?.tolerated ? "allowed" : "broken";
function simulationTests(result) {
  return [
    ...result.steps.flatMap((step, index) => index ? [{ lane: "steps", index, step, label: TEST_LABELS[index] ?? step.name }] : []),
    ...result.history.flatMap((step, index) => {
      const ago = result.history.length - 1 - index;
      return index ? [{ lane: "history", index, step, label: ago ? `${ago} ${ago === 1 ? "turn" : "turns"} ago` : "Latest turn" }] : [];
    })
  ];
}
function testSentence(step) {
  const data = step.timeline, first = data.rows.find((row) => row.root);
  if (data.routeChanged)
    return "The connection or model changed, so the whole prompt is recached.";
  if (first) {
    const place = `message ${(first.newIndex ?? first.oldIndex ?? 0) + 1}, ${turnName(first)}`;
    return data.tolerated ? `Changes start at ${place}. That is inside your allowed tail.` : `Cache breaks at ${place}.`;
  }
  if (step.comparison.kind === "first")
    return "This is the starting prompt the tests compare against.";
  return step.comparison.kind === "append" ? "Only new text was added at the end. Everything before it stays cached." : "Nothing changed. The whole prompt stays cached.";
}
function cacheMeter(step, settings) {
  const data = step.timeline, atRisk = testState(step) === "broken" && !data.routeChanged && data.kept > 0 && data.rewritten > 0;
  const total = Math.max(1, data.kept + data.rewritten + data.added), meter = el("div", `lc-meter${atRisk ? " lc-meter-risk" : ""}`);
  meter.setAttribute("aria-hidden", "true");
  for (const [name, value] of [["kept", data.kept], ["lost", data.rewritten], ["new", data.added]]) {
    const part = el("i", `lc-meter-${name}`);
    part.style.flexGrow = String(value);
    meter.append(part);
  }
  const share = (value) => `${Math.round(value / total * 100)}%`;
  const tail = `depth ${settings.acceptableDepth ?? DEFAULT_ACCEPTABLE_DEPTH}${settings.acceptableTokens != null ? ` and ${settings.acceptableTokens.toLocaleString()} tokens` : ""}`;
  const parts = atRisk ? [`${share(data.kept)} is consistent but at risk of invalidation due to the remaining ${share(data.rewritten)} breaking cache outside of your allowed tail of ${tail}`] : [`${share(data.kept)} cache consistent`, data.rewritten ? `${share(data.rewritten)} recached` : ""];
  return [meter, el("p", `lc-muted lc-meter-copy${atRisk ? " lc-meter-copy-risk" : ""}`, [...parts, data.added ? `${share(data.added)} new` : ""].filter(Boolean).join(" · "))];
}
var turnModal;
function closeTurnModal() {
  turnModal?.dismiss();
}
function openTurnModal(ctx, client, { row, before, after, tolerated, notes = [] }) {
  closeTurnModal();
  const position = (row.newIndex ?? row.oldIndex ?? 0) + 1;
  const modal = ctx.ui.showModal({ title: `Message ${position} · ${KIND_LABELS[row.kind]}`, width: 1100, maxHeight: 820 });
  turnModal = modal;
  modal.onDismiss(() => {
    if (turnModal === modal)
      turnModal = undefined;
  });
  const body = el("div", "lc-root lc-modal lc-turn-modal");
  body.append(el("h3", "", turnName(row)), el("p", `lc-turn-why${isProblem(row) ? " lc-turn-why-bad" : ""}`, turnSentence(row, tolerated)));
  const sources = row.sources.length ? row.sources : row.parts.map((part) => part.label);
  if (sources.length) {
    const from = el("div", "lc-turn-sources");
    from.append(el("strong", "", isProblem(row) ? "Changed part" : "Comes from"));
    for (const label of sources.slice(0, 12)) {
      const kind = row.parts.find((part) => part.label === label)?.kind ?? row.kind, chip = el("span", "lc-tl-key", label);
      chip.dataset.kind = kind;
      chip.prepend(el("i"));
      from.append(chip);
    }
    body.append(from);
  }
  if (notes.length) {
    const list = el("div", "lc-turn-notes");
    list.append(el("strong", "", "Health found"));
    for (const note of notes)
      list.append(el("p", "lc-muted", `${note.title}. ${note.suggestion}`));
    body.append(list);
  }
  const same = !isProblem(row) && row.status !== "new";
  body.append(renderTurnDiff(before ?? undefined, after, { oldIndex: row.oldIndex, newIndex: row.newIndex, headerChanged: row.headerChanged, same }, client));
  modal.root.replaceChildren(body);
}
function turnSentence(row, tolerated) {
  const place = row.root ? tolerated ? "Changes start here, inside your allowed tail. " : "Cache breaks here. Because this is outside your tail, your entire context is at risk of cache invalidation. " : "";
  switch (row.status) {
    case "changed":
      return `${place}This message's text changed from the previous prompt.`;
    case "added":
      return `${place}This message was not in the previous prompt, and it landed before older messages.`;
    case "removed":
      return `${place}This message was in the previous prompt and is now gone.`;
    case "rewritten":
      return "This message did not change, but it sits after the break, so it is recached.";
    case "new":
      return "New text at the end of the prompt. This is normal growth and does not break the cache.";
    case "kept":
      return "This message did not change and sits before any break, so it stays cached.";
    default:
      return "Part of the starting prompt the tests compare against.";
  }
}

class HealthPanel {
  ctx;
  bridge;
  input;
  composition;
  root = el("div", "lc-health");
  report;
  reportKey = "";
  simulation;
  simulationKey = "";
  ticket;
  runningChat;
  status = "";
  error = "";
  auditError = "";
  disposed = false;
  started = false;
  liveBusy = false;
  reviewBusy = false;
  lastKey = "";
  page = "health";
  lane = "steps";
  timeline;
  step = 0;
  open = new Set;
  unsubscribe = [];
  settings = DEFAULT_SETTINGS;
  toggleCategory;
  savingSettings = false;
  auto;
  constructor(ctx, bridge, input, composition = readComposition) {
    this.ctx = ctx;
    this.bridge = bridge;
    this.input = input;
    this.composition = composition;
    this.auto = new AutoHealth({
      input,
      check: async (value) => bridge.call("audit", { ...value, composition: await this.composition() }),
      result: (report, value) => {
        this.report = report;
        this.reportKey = healthKey(value);
        this.auditError = "";
      },
      error: (error) => {
        this.auditError = errorText(error);
      },
      changed: () => {
        if (this.page === "health")
          this.render();
      }
    });
    this.unsubscribe.push(ctx.onBackendMessage((raw) => {
      const event = raw;
      if (event?.type === "agentDiagnostic" && typeof event.id === "string")
        this.runFromAgent(event.id);
      if (event?.type === "simulationProgress" && this.ticket && this.runningChat) {
        this.status = `Building: ${event.name}`;
        this.render();
      }
    }));
    this.render();
  }
  start() {
    if (this.started)
      return;
    this.started = true;
    this.unsubscribe.push(this.ctx.state.subscribe("chat.active", () => {
      this.liveBusy = false;
      this.reviewBusy = false;
      this.sync();
    }));
    for (const name of SOURCE_EVENTS)
      this.unsubscribe.push(this.ctx.events.on(name, (payload) => {
        const chat = payload?.chatId ?? payload?.chat_id;
        if (chat && chat !== this.input()?.chatId)
          return;
        this.auto.sync();
        this.auto.invalidate();
      }));
    this.unsubscribe.push(this.ctx.events.on("GENERATION_STARTED", (payload) => {
      if (this.currentEvent(payload))
        this.setLive(true);
    }));
    for (const name of ["GENERATION_ENDED", "GENERATION_STOPPED"])
      this.unsubscribe.push(this.ctx.events.on(name, (payload) => {
        if (this.currentEvent(payload)) {
          this.setLive(false);
          this.auto.invalidate();
        }
      }));
    this.unsubscribe.push(this.ctx.events.on("CONNECTED", () => this.auto.invalidate()));
    this.sync();
  }
  configure(settings, toggle) {
    const next = validateSettings(settings), changed = JSON.stringify(next) !== JSON.stringify(this.settings);
    const policyChanged = next.acceptableDepth !== this.settings.acceptableDepth || next.acceptableTokens !== this.settings.acceptableTokens || next.cacheTtl !== this.settings.cacheTtl || next.autoRefreshEnabled !== this.settings.autoRefreshEnabled || next.autoRefreshMinutes !== this.settings.autoRefreshMinutes;
    this.settings = next;
    this.toggleCategory = toggle;
    if (policyChanged)
      this.auto.invalidate();
    if (changed)
      this.render();
  }
  setSaving(value) {
    this.savingSettings = value;
    this.render();
  }
  currentEvent(payload) {
    const id = payload?.chatId;
    return !id || id === this.input()?.chatId;
  }
  sync() {
    this.auto.suspend(this.liveBusy || this.reviewBusy || !!this.runningChat);
    this.auto.sync();
    this.render();
  }
  setLive(value) {
    if (value === this.liveBusy)
      return;
    this.liveBusy = value;
    this.auto.suspend(value || this.reviewBusy || !!this.runningChat);
    this.render();
  }
  setReview(value) {
    if (value === this.reviewBusy)
      return;
    this.reviewBusy = value;
    this.auto.suspend(value || this.liveBusy || !!this.runningChat);
    this.render();
  }
  show(page) {
    if (this.page !== page) {
      this.page = page;
      this.render();
    }
  }
  empty(title, text, type = "shield") {
    const box = el("div", "lc-empty");
    box.append(icon(type, "lc-empty-icon"), el("h3", "", title));
    if (text)
      box.append(el("p", "lc-muted", text));
    return box;
  }
  failure(message) {
    const detail = el("details", "lc-error-detail");
    detail.append(el("summary", "", "Check unavailable"), el("p", "lc-error", message));
    return detail;
  }
  render() {
    if (this.disposed)
      return;
    const key = healthKey(this.input());
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.auditError = "";
      this.error = "";
    }
    const parent = this.root.closest(".lc-content"), scroll = parent?.scrollTop;
    const focused = this.root.contains(document.activeElement) ? document.activeElement.dataset.focus : undefined;
    this.root.replaceChildren();
    if (!this.input())
      this.root.append(this.empty("Open a chat", "Your cache check will appear here."));
    else {
      if (this.page === "health")
        this.renderHealth();
      else
        this.renderSimulation();
      const promo = el("p", "lc-promo");
      promo.append("Struggling? ", el("strong", "", "LumiAgent"), " integrates with this extension to help make things cache consistent :) Get her ", externalLink("Here", LUMIAGENT_URL), ".");
      this.root.append(promo);
    }
    if (parent && scroll !== undefined)
      parent.scrollTop = scroll;
    if (this.page === "simulation")
      this.timeline?.view.attached();
    if (focused)
      this.root.querySelector(`[data-focus="${focused}"]`)?.focus({ preventScroll: true });
  }
  renderHealth() {
    const report = this.reportKey === healthKey(this.input()) ? this.report : undefined;
    const toolbar = el("div", "lc-section-toolbar");
    if (report)
      toolbar.append(healthPill(actionable(report.findings), this.auto.stale, this.settings.hiddenCategories, (category) => {
        if (this.toggleCategory)
          this.toggleCategory(category);
        else {
          this.settings = { ...this.settings, hiddenCategories: this.settings.hiddenCategories.includes(category) ? this.settings.hiddenCategories.filter((c) => c !== category) : [...this.settings.hiddenCategories, category] };
          this.render();
        }
      }));
    else
      toolbar.append(el("span", "lc-health-pending", this.auditError ? "Check unavailable" : this.liveBusy || this.reviewBusy ? "Waiting for generation" : "Checking health…"));
    const refresh = button("Refresh", () => {
      this.auditError = "";
      this.auto.refresh();
    }, "lc-quiet-button");
    refresh.prepend(icon("refresh", this.auto.running ? "lc-spin" : ""));
    refresh.dataset.focus = "refresh-health";
    refresh.setAttribute("aria-label", "Refresh cache health");
    refresh.title = report ? `Last checked ${new Date(report.at).toLocaleTimeString()}` : "Refresh cache health";
    refresh.disabled = this.auto.running || !!this.runningChat || this.liveBusy || this.reviewBusy;
    toolbar.append(refresh);
    this.root.append(toolbar);
    for (const control of toolbar.querySelectorAll(".lc-pill-toggle"))
      control.disabled = this.savingSettings;
    if (this.auditError)
      this.root.append(this.failure(this.auditError));
    if (report) {
      const rows = filtered(report.findings, this.settings.hiddenCategories);
      if (rows.length)
        this.root.append(renderFindings(rows, this.open));
      else
        this.root.append(actionable(report.findings).length ? this.empty("Categories hidden", "Select a category above to show its findings.") : this.empty("Nothing flagged", "No concrete cache risks found in this check."));
      if (report.findingsOmitted)
        this.root.append(el("p", "lc-muted", `${report.findingsOmitted} more findings exceed the report limit.`));
    } else if (!this.auditError && !this.liveBusy && !this.reviewBusy) {
      const skeleton = el("div", "lc-skeleton");
      skeleton.setAttribute("aria-hidden", "true");
      for (let i = 0;i < 3; i++)
        skeleton.append(el("div"));
      this.root.append(skeleton);
    }
    if ((this.liveBusy || this.reviewBusy) && report)
      this.root.append(el("p", "lc-inline-status", "Updates after generation finishes."));
  }
  renderSimulation() {
    const input = this.input(), result = this.simulationKey === healthKey(input) ? this.simulation : undefined;
    const view = el("div", "lc-sim");
    this.root.append(view);
    const toolbar = el("div", "lc-section-toolbar"), run = button(result ? "Run again" : "Simulate caching", () => {
      this.run();
    }, "lc-primary");
    run.prepend(icon("play"));
    run.dataset.focus = "simulate";
    run.disabled = !!this.runningChat || this.liveBusy || this.reviewBusy;
    toolbar.append(run, el("span", "lc-muted", "Test Prompts and Historical Cache Behaviour"));
    view.append(toolbar);
    if (this.runningChat) {
      const state = el("div", "lc-progress-card"), spinner = icon("refresh", "lc-spin");
      state.setAttribute("role", "status");
      state.append(spinner, el("span", "", this.status || "Preparing simulation…"));
      if (this.ticket)
        state.append(button("Cancel", () => {
          this.cancel();
        }, "lc-text-button"));
      view.append(state);
      return;
    }
    if (this.error)
      view.append(this.failure(this.error));
    if (!result) {
      view.append(this.empty("See where your cache breaks", "Builds your next few prompts and shows every message from start to end, with the ones that break cache marked.", "play"));
      return;
    }
    if (result.error)
      view.append(el("p", "lc-error", result.error));
    if (result.cleanupError)
      view.append(el("p", "lc-error", `Cleanup needed: ${result.cleanupError}${result.scratchChatId ? `
Copy: ${result.scratchChatId}` : ""}`));
    const tests = simulationTests(result), broken = tests.filter((test) => testState(test.step) === "broken").length, allowed = tests.filter((test) => testState(test.step) === "allowed").length;
    const verdict = el("div", `lc-verdict ${broken ? "lc-verdict-bad" : "lc-verdict-good"}`);
    verdict.append(icon(broken ? "x" : "check"), el("strong", "", !tests.length ? "No test finished" : broken ? `Cache broke in ${broken} of ${tests.length} tests` : `Cache held in all ${tests.length} tests`));
    if (allowed || !result.complete)
      verdict.append(el("span", "lc-muted", [allowed ? `${allowed} inside your allowed tail` : "", result.complete ? "" : "Incomplete run"].filter(Boolean).join(" · ")));
    view.append(verdict);
    const picker = el("div", "lc-tests");
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "Choose a test");
    const addGroup = (title, group) => {
      if (!group.length)
        return;
      const row = el("div", "lc-test-group");
      row.append(el("span", "lc-test-group-name", title));
      for (const test of group) {
        const pick = button(test.label, () => {
          this.lane = test.lane;
          this.step = test.index;
          this.render();
        }, `lc-test lc-test-${testState(test.step)}`);
        pick.prepend(el("i"));
        pick.dataset.focus = `test-${test.lane}-${test.index}`;
        pick.title = test.step.purpose;
        pick.setAttribute("aria-pressed", String(this.lane === test.lane && this.step === test.index));
        row.append(pick);
      }
      picker.append(row);
    };
    addGroup("Future Turns", tests.filter((test) => test.lane === "steps"));
    addGroup("Past Turns", tests.filter((test) => test.lane === "history"));
    view.append(picker);
    const steps = result[this.lane];
    this.step = Math.max(0, Math.min(this.step, steps.length - 1));
    const step = steps[this.step];
    if (step) {
      const card = el("section", "lc-test-card"), data = step.timeline;
      card.append(el("p", "lc-test-purpose", step.purpose));
      if (data) {
        card.append(el("p", "lc-test-result", testSentence(step)));
        card.append(...cacheMeter(step, this.settings));
      }
      if (this.lane === "history")
        card.append(el("p", "lc-muted", "Rebuilt with your current settings, so this is not an exact replay."));
      if (step.clipping?.messagesDropped)
        card.append(el("p", "lc-issue-ink", `${step.clipping.messagesDropped} history messages clipped`));
      view.append(card);
      if (data) {
        const key = `${result.seed}:${this.lane}:${this.step}`;
        if (this.timeline?.key !== key) {
          this.timeline?.view.dispose();
          this.timeline = { key, view: renderTimeline(data, (row) => this.openTurn(result, steps, this.step, row)) };
        }
        view.append(this.timeline.view.root);
      }
    }
    const details = el("details", "lc-run-details");
    details.append(el("summary", "", "Test details"));
    const body = el("div", "lc-details-body");
    if (step?.inputs.length)
      body.append(el("strong", "", "Test input"), el("pre", "lc-raw", step.inputs.map((message) => `${message.role}:
${String(message.content)}`).join(`

`)));
    if (step?.recordedPrompt) {
      const recorded = el("details");
      recorded.append(el("summary", "", "Saved original prompt"));
      let opened = false;
      const saved = step.recordedPrompt;
      recorded.addEventListener("toggle", () => {
        if (recorded.open && !opened) {
          opened = true;
          recorded.append(renderPrompt(saved, this.bridge));
        }
      });
      body.append(recorded);
    }
    if (step?.recordedUsage?.read !== undefined)
      body.append(el("p", "lc-muted", `${step.recordedUsage.read.toLocaleString()} saved cache-read tokens`));
    for (const note of result.limitations)
      body.append(el("p", "lc-muted", note));
    details.append(body);
    view.append(details);
  }
  openTurn(result, steps, index, row) {
    const sources = row.sources.length ? row.sources : row.parts.map((part) => part.label);
    const notes = actionable(result.health.findings).filter((finding) => finding.item && sources.some((source) => source.includes(finding.item))).slice(0, 4);
    const before = this.lane === "steps" ? index ? steps[0] : undefined : steps[index - 1];
    openTurnModal(this.ctx, this.bridge, { row, before: before?.snapshot, after: steps[index].snapshot, tolerated: !!steps[index].timeline?.tolerated, notes });
  }
  async begin(input) {
    this.runningChat = input.chatId;
    this.auto.suspend(true);
    this.error = "";
    this.status = "Preparing simulation…";
    this.render();
    await this.auto.idle();
  }
  end() {
    this.runningChat = undefined;
    this.ticket = undefined;
    this.auto.suspend(this.liveBusy || this.reviewBusy);
    this.render();
  }
  setSimulation(result, input) {
    this.simulation = result;
    this.simulationKey = healthKey(input);
    const tests = simulationTests(result), first = tests.find((test) => testState(test.step) === "broken") ?? tests.find((test) => testState(test.step) === "allowed") ?? tests[0];
    this.lane = first?.lane ?? "steps";
    this.step = first?.index ?? 0;
  }
  async runFromAgent(id) {
    let claimed = false, ownsRun = false, kind;
    try {
      const job = await this.bridge.call("agentClaim", { id });
      claimed = true;
      kind = job.kind;
      if (this.runningChat)
        throw new Error("LumiCache is already running a diagnostic in this browser. Retry when it finishes.");
      ownsRun = true;
      await this.begin(job.input);
      this.status = "Diagnostic requested by LumiAgent…";
      this.render();
      const input = { ...job.input, agentJobId: id };
      if (job.kind === "audit")
        this.auto.accept(await this.bridge.call("audit", { ...input, composition: await this.composition() }), job.input);
      else {
        const result = await simulate(this.bridge, input, (ticket) => {
          this.ticket = ticket;
          this.render();
        });
        this.setSimulation(result, job.input);
        await this.bridge.call("agentFinish", { id, cleanupError: result.cleanupError, scratchChatId: result.scratchChatId });
      }
    } catch (error) {
      this.error = errorText(error);
      if (kind === "audit")
        this.auditError = this.error;
      if (claimed)
        try {
          await this.bridge.call("agentFinish", { id, error: this.error });
        } catch {}
    } finally {
      if (ownsRun)
        this.end();
    }
  }
  async run() {
    const input = this.input();
    if (!input || this.runningChat || this.liveBusy || this.reviewBusy)
      return;
    await this.begin(input);
    try {
      this.setSimulation(await simulate(this.bridge, input, (ticket) => {
        this.ticket = ticket;
        this.render();
      }), input);
    } catch (error) {
      this.error = errorText(error);
    } finally {
      this.end();
    }
  }
  async cancel() {
    if (!this.ticket)
      return;
    try {
      await this.bridge.call("cancelSimulation", { id: this.ticket.id });
      this.status = "Finishing cleanup…";
    } catch (error) {
      this.error = errorText(error);
    }
    this.render();
  }
  dispose() {
    this.disposed = true;
    closeTurnModal();
    this.timeline?.view.dispose();
    this.auto.dispose();
    for (const off of this.unsubscribe)
      off();
  }
}

// src/ui/keep-warm.ts
function clock(ms) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

class KeepWarm {
  ctx;
  bridge;
  chat;
  state = null;
  settings;
  received = 0;
  busy = false;
  error = "";
  ticker;
  removeSpin;
  modal;
  modalStatus;
  action;
  offClick;
  banner = el("div", "lc-root lc-warm-banner");
  bannerText = el("span", "lc-warm-text");
  bannerStop = button("Stop", () => {
    this.toggle(false);
  });
  constructor(ctx, bridge, chat) {
    this.ctx = ctx;
    this.bridge = bridge;
    this.chat = chat;
    this.action = ctx.ui.registerInputBarAction({ id: "lumicache_keep_warm", label: "Keep Cache Warm", subtitle: "Off", iconSvg: icon("refresh", "lc-warm-icon").outerHTML });
    this.offClick = this.action.onClick(() => this.open());
    this.bannerStop.setAttribute("aria-label", "Stop keeping cache warm");
    this.banner.hidden = true;
    this.banner.append(icon("refresh", "lc-spin"), this.bannerText, this.bannerStop);
    ctx.ui.mount("chat_composer_above").append(this.banner);
  }
  update(settings, state) {
    this.settings = validateSettings(settings);
    this.setState(state);
  }
  setState(state) {
    this.state = state;
    this.received = Date.now();
    this.render();
  }
  dispose() {
    clearInterval(this.ticker);
    this.removeSpin?.();
    this.modal?.dismiss();
    this.offClick();
    this.action.destroy();
    this.banner.remove();
  }
  blocked() {
    return this.settings?.mode === "off";
  }
  status() {
    if (this.error)
      return this.error;
    const job = this.state;
    if (!job) {
      if (!this.settings?.autoRefreshEnabled)
        return "Off";
      return this.blocked() ? "On, but cache monitoring is off, so there is no prompt to resend" : "On. Starts after your next reply";
    }
    const where = job.chatId === this.chat() ? "Keeping cache warm" : "Keeping another chat's cache warm";
    const left = job.nextIn === null ? null : Math.max(0, job.nextIn - (Date.now() - this.received));
    return `${where} · ${left === null ? "refreshing now" : `next in ${clock(left)}`} · ${job.done} of ${job.limit} used`;
  }
  tick() {
    const text = this.status();
    this.bannerText.textContent = text;
    if (this.modalStatus)
      this.modalStatus.textContent = text;
  }
  render() {
    const running = !!this.state, enabled = !!this.settings?.autoRefreshEnabled;
    this.action.setSubtitle(running ? "On" : enabled ? "On, waiting for a reply" : "Off");
    if (running && !this.removeSpin)
      this.removeSpin = this.ctx.dom.addStyle("@media(prefers-reduced-motion:no-preference) { .lc-warm-icon { animation:lc-spin 1.5s linear infinite; } }");
    if (!running) {
      this.removeSpin?.();
      this.removeSpin = undefined;
    }
    this.banner.hidden = !running;
    this.bannerStop.disabled = this.busy;
    clearInterval(this.ticker);
    this.ticker = undefined;
    if (this.state?.nextIn !== null && this.state)
      this.ticker = setInterval(() => this.tick(), 1000);
    this.tick();
    this.renderModal();
  }
  open() {
    if (this.modal)
      return;
    const modal = this.modal = this.ctx.ui.showModal({ title: "Keep Cache Warm", width: 400 });
    modal.onDismiss(() => {
      if (this.modal === modal) {
        this.modal = undefined;
        this.modalStatus = undefined;
      }
    });
    this.renderModal();
  }
  renderModal() {
    if (!this.modal)
      return;
    const settings = this.settings, on = !!settings?.autoRefreshEnabled, body = el("div", "lc-root lc-warm-modal");
    const status = el("div", "lc-warm-status"), text = el("span");
    if (this.state)
      status.append(icon("refresh", "lc-spin"));
    status.append(text);
    this.modalStatus = text;
    body.append(status);
    const every = settings?.autoRefreshMinutes ?? 10, limit = settings?.autoRefreshLimit ?? 3;
    body.append(el("p", "lc-muted", `Resends the chat's last prompt every ${every} minute${every === 1 ? "" : "s"}, up to ${limit} time${limit === 1 ? "" : "s"} after each reply to keep cache warm. Changable in the settings.`));
    const control = on ? button("Turn off", () => {
      this.toggle(false);
    }) : button("Keep cache warm", () => {
      this.toggle(true);
    }, "lc-primary");
    control.disabled = this.busy || !settings || !on && this.blocked();
    body.append(control);
    this.modal.root.replaceChildren(body);
    this.tick();
  }
  async toggle(enabled) {
    if (this.busy)
      return;
    this.busy = true;
    this.error = "";
    this.render();
    try {
      const chatId = this.chat(), result = await this.bridge.call("keepWarm", { enabled, ...chatId ? { chatId } : {} });
      this.settings = validateSettings(result.settings);
      this.state = result.state;
      this.received = Date.now();
    } catch (cause) {
      this.error = errorText(cause);
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

// src/frontend.ts
function setup(ctx) {
  const removeStyle = ctx.dom.addStyle(STYLES), bridge = new Bridge(ctx);
  const tab = ctx.ui.registerDrawerTab({
    id: "lumicache",
    title: "LumiCache",
    shortName: "Cache",
    iconSvg: ICON,
    description: "Cache health and prompt diffs",
    keywords: ["cache", "diff", "prompt", "prefix"]
  });
  const root = el("div", "lc-root"), toolbar = el("div", "lc-app-toolbar"), tabs = el("div", "lc-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "LumiCache");
  const settingsPanel = el("div", "lc-settings"), content = el("div", "lc-content"), error = el("p", "lc-error lc-app-error");
  error.setAttribute("role", "alert");
  root.append(toolbar, settingsPanel, error, content);
  tab.root.append(root);
  const chat = () => ctx.state.get("chat.active").chatId;
  const warm = new KeepWarm(ctx, bridge, chat);
  let view = null, disposed = false, revision = 0, busy = false, settingsOpen = false;
  let policyPanel, policyPanelKey = "";
  let selected = "health";
  let modal, modalId;
  const health = new HealthPanel(ctx, bridge, () => {
    const chatId = chat();
    if (!chatId)
      return null;
    const connectionId = ctx.connections?.getActive?.().activeProfileId;
    return { chatId, ...connectionId ? { connectionId } : {} };
  });
  const buttons = new Map;
  for (const [id, label, symbol] of [["health", "Health", "shield"], ["simulation", "Simulation", "play"], ["check", "Cache Diff", "diff"]]) {
    const control = button(label, () => {
      selected = id;
      render();
      content.scrollTop = 0;
    }, "lc-tab");
    control.prepend(icon(symbol));
    control.id = `lumicache-tab-${id}`;
    control.setAttribute("role", "tab");
    control.setAttribute("aria-controls", "lumicache-panel");
    control.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const ids = ["health", "simulation", "check"], index = ids.indexOf(selected);
      selected = ids[event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3];
      render();
      buttons.get(selected).focus();
    });
    buttons.set(id, control);
    tabs.append(control);
  }
  const gear = button("", () => {
    settingsOpen = !settingsOpen;
    renderSettings();
  }, "lc-icon-button");
  gear.append(icon("settings"));
  gear.setAttribute("aria-label", "Cache settings");
  gear.title = "Cache settings";
  toolbar.append(tabs, gear);
  content.id = "lumicache-panel";
  content.setAttribute("role", "tabpanel");
  content.tabIndex = 0;
  const inspectors = new Map;
  let textOpen = false;
  function closeModal() {
    modalId = undefined;
    const old = modal;
    modal = undefined;
    old?.dismiss();
  }
  function renderSettings() {
    gear.setAttribute("aria-expanded", String(settingsOpen));
    settingsPanel.hidden = !settingsOpen;
    settingsPanel.replaceChildren();
    if (!settingsOpen || !view)
      return;
    const { hiddenCategories: _filters, ...editable } = validateSettings(view.settings), key = JSON.stringify(editable);
    if (!policyPanel || policyPanelKey !== key) {
      policyPanelKey = key;
      policyPanel = policySettings(view.settings, busy, (patch) => {
        save(patch);
      });
    }
    policyPanel.setBusy(busy);
    settingsPanel.append(policyPanel);
    if (chat() && view.hasBaseline) {
      const reset = button("Reset comparison", () => {
        clearBaseline();
      }, "lc-text-button");
      reset.disabled = busy || ["waiting", "allowed"].includes(view.check?.status ?? "");
      reset.title = "Use the next successful request as a new baseline";
      settingsPanel.append(reset);
    }
  }
  function detail(check, actionable, slot) {
    const section = el("div", "lc-review");
    if (check.policy) {
      const labels = { tolerated: "Within your tail tolerance", preserved: "Prior prompt content restored", refresh: "Scheduled refresh", seed: "Starting a frozen baseline" };
      const status = el("p", "lc-policy-status", labels[check.policy.action]);
      const details = [check.policy.restored ? `${check.policy.restored} restored` : "", check.policy.relocated ? `${check.policy.relocated} moved` : "", check.policy.approximate ? "estimated tokens" : ""].filter(Boolean);
      if (details.length)
        status.append(document.createTextNode(` · ${details.join(" · ")}`));
      section.append(status);
    }
    if (check.status === "waiting") {
      const status = el("div", "lc-review-status");
      status.append(icon("diff"), el("span", "", actionable ? "Sending is paused" : "Awaiting review in the sending browser"));
      section.append(status);
    }
    if (check.before) {
      const percent = check.comparison.previousCharacters ? Math.floor(100 * check.comparison.commonCharacters / check.comparison.previousCharacters) : 0;
      const caption = el("p", "lc-muted lc-prefix-caption", check.comparison.routeChanged ? "Connection or model changed" : `${percent}% of the previous prefix matches`);
      caption.title = `${check.comparison.commonCharacters.toLocaleString()} matching characters · ${check.comparison.commonMessages} unchanged messages`;
      section.append(caption);
    }
    const data = check.timeline;
    if (data) {
      let held = inspectors.get(slot);
      if (held?.id !== check.id) {
        held?.view.dispose();
        held = { id: check.id, view: renderTimeline(data, (row) => openTurnModal(ctx, bridge, { row, before: check.before, after: check.after, tolerated: data.tolerated })) };
        inspectors.set(slot, held);
      }
      section.append(held.view.root);
    }
    const text = el("details", "lc-run-details"), body = el("div", "lc-details-body");
    let opened = false;
    text.append(el("summary", "", check.comparison.routeChanged ? "Connection change and text" : "All changes as text"), body);
    const reveal = () => {
      if (text.open && !opened) {
        opened = true;
        body.append(renderDiff(check, bridge));
      }
    };
    text.addEventListener("toggle", () => {
      textOpen = text.open;
      reveal();
    });
    text.open = !data || textOpen;
    reveal();
    section.append(text);
    if (check.status === "waiting" && actionable) {
      const actions = el("div", "lc-actions"), cancel = button("Cancel send", () => {
        decide(check.id, false);
      }), send = button("Send anyway", () => {
        decide(check.id, true);
      }, "lc-primary");
      cancel.disabled = send.disabled = busy;
      actions.append(cancel, send);
      section.append(actions);
      section.append(el("p", "lc-muted lc-review-expiry", `Review by ${new Date(check.deadline).toLocaleTimeString()}`));
    } else if (check.status === "waiting")
      section.append(el("p", "lc-muted", "Use the browser session that started this request."));
    return section;
  }
  function renderLive() {
    const page = el("div", "lc-live");
    if (!view) {
      page.append(el("p", "lc-muted", "Loading…"));
      return page;
    }
    if (!chat() || !view.check?.before) {
      if (chat() && view.settings.mode === "off")
        page.append(el("p", "lc-inline-status", "Monitoring is off"));
      const empty = el("div", "lc-empty");
      empty.append(icon("diff", "lc-empty-icon"), el("h3", "", chat() ? "Ready For Cache Comparison" : "Open a chat"), el("p", "lc-muted", chat() ? "Send a reply to inspect the cache diff." : "Open a chat to inspect its cache diff."));
      page.append(empty);
      return page;
    }
    const check = view.check, heading = el("div", "lc-section-toolbar");
    const first = check.comparison.firstMessage;
    const verdict = check.comparison.kind === "same" ? "Cache kept: prompt unchanged" : check.comparison.kind === "append" ? "Cache kept: only new text at the end" : check.comparison.routeChanged ? "Cache breaks: connection or model changed" : check.policy?.action === "tolerated" ? "Changes inside your allowed tail" : first === null ? "Cache breaks" : `Cache breaks at message ${first + 1}`;
    const states = { waiting: "Waiting for your review", allowed: "Generating…", completed: "Reply finished", cancelled: "Send cancelled", failed: "Generation stopped" };
    const titles = el("div", "lc-live-title");
    titles.append(el("h3", "", verdict), el("span", "lc-muted", states[check.status]));
    heading.append(titles);
    const refresh = button("", () => {
      load();
    }, "lc-icon-button");
    refresh.append(icon("refresh"));
    refresh.title = "Refresh Cache Diff";
    refresh.setAttribute("aria-label", "Refresh Cache Diff");
    heading.append(refresh);
    page.append(heading);
    if (view.settings.mode === "off")
      page.append(el("p", "lc-inline-status", "Monitoring is off"));
    page.append(detail(check, view.canDecide, "live"));
    return page;
  }
  function render() {
    if (disposed)
      return;
    for (const [id, control] of buttons) {
      control.setAttribute("aria-selected", String(selected === id));
      control.tabIndex = selected === id ? 0 : -1;
    }
    content.setAttribute("aria-labelledby", `lumicache-tab-${selected}`);
    renderSettings();
    if (view)
      health.configure(view.settings, (category) => {
        const hidden = validateSettings(view.settings).hiddenCategories;
        save({ hiddenCategories: hidden.includes(category) ? hidden.filter((c) => c !== category) : [...hidden, category] });
      });
    health.setReview(!!view?.check && ["waiting", "allowed"].includes(view.check.status));
    if (selected === "check") {
      content.replaceChildren(renderLive());
      inspectors.get("live")?.view.attached();
    } else {
      health.show(selected);
      if (content.firstChild !== health.root)
        content.replaceChildren(health.root);
    }
    tab.setBadge(view?.settings.mode === "off" ? "off" : view?.check?.comparison.kind === "break" && !view.check.policy?.accepted ? "!" : null);
    const pending = view?.check?.status === "waiting" && view.canDecide ? view.check : undefined;
    if (!pending || pending.id !== modalId)
      closeModal();
    if (pending && !modal) {
      modal = ctx.ui.showModal({ title: "Review prompt changes", width: 960, maxHeight: 760, persistent: true });
      modalId = pending.id;
      modal.onDismiss(() => {
        if (modalId !== pending.id)
          return;
        modalId = undefined;
        modal = undefined;
      });
    }
    if (pending && modal) {
      const body = el("div", "lc-root lc-modal"), message = el("p", "lc-error", error.textContent ?? "");
      message.setAttribute("role", "alert");
      body.append(message, detail(pending, true, "review"));
      modal.root.replaceChildren(body);
      inspectors.get("review")?.view.attached();
    }
  }
  async function load() {
    const current = ++revision, chatId = chat();
    try {
      const next = await bridge.call("load", chatId ? { chatId } : {});
      if (disposed || current !== revision || chatId !== chat())
        return;
      view = next;
      warm.update(next.settings, next.keepWarm ?? null);
      error.textContent = "";
      render();
    } catch (cause) {
      if (!disposed && current === revision) {
        error.textContent = errorText(cause);
        render();
      }
    }
  }
  async function decide(id, allow) {
    if (busy)
      return;
    busy = true;
    error.textContent = "";
    render();
    try {
      await bridge.call("decide", { id, allow });
      closeModal();
    } catch (cause) {
      error.textContent = errorText(cause);
    } finally {
      busy = false;
      await load();
    }
  }
  async function save(patch) {
    if (!view || busy)
      return;
    const focused = document.activeElement;
    const setting = focused?.dataset.setting, filter = focused?.dataset.focus;
    busy = true;
    error.textContent = "";
    renderSettings();
    health.setSaving(true);
    try {
      await bridge.call("settings", { ...validateSettings(view.settings), ...patch });
    } catch (cause) {
      error.textContent = errorText(cause);
    } finally {
      busy = false;
      health.setSaving(false);
      await load();
      if (document.activeElement === document.body && (setting || filter))
        root.querySelector(setting ? `[data-setting="${setting}"]` : `[data-focus="${filter}"]`)?.focus({ preventScroll: true });
    }
  }
  async function clearBaseline() {
    const chatId = chat();
    if (!chatId)
      return;
    busy = true;
    error.textContent = "";
    renderSettings();
    try {
      await bridge.call("clear", { chatId });
    } catch (cause) {
      error.textContent = errorText(cause);
    } finally {
      busy = false;
      await load();
    }
  }
  const unsubs = [
    ctx.onBackendMessage((raw) => {
      const event = raw;
      if (event?.type === "keepWarm")
        warm.setState(event.state ?? null);
      if (event?.type === "changed" && (!event.chatId || event.chatId === chat()))
        load();
    }),
    ctx.state.subscribe("chat.active", () => {
      closeModal();
      view = null;
      render();
      load();
    }),
    ctx.events.on("CONNECTED", () => {
      load();
    }),
    ctx.events.on("__ws_close", () => {
      error.textContent = "Connection lost. Paused sends remain blocked.";
      render();
    }),
    tab.onActivate(() => {
      health.auto.sync();
      load();
    })
  ];
  const presence = () => {
    const chatId = chat(), connectionId = ctx.connections?.getActive?.().activeProfileId;
    bridge.call("agentPresence", { ...chatId ? { chatId } : {}, ...connectionId ? { connectionId } : {} }).catch(() => {});
  };
  const presenceTimer = setInterval(presence, 20000);
  presence();
  render();
  load();
  health.start();
  return () => {
    closeTurnModal();
    for (const { view } of inspectors.values())
      view.dispose();
    clearInterval(presenceTimer);
    bridge.call("agentPresence", { offline: true }).catch(() => {});
    disposed = true;
    revision++;
    for (const off of unsubs)
      off();
    closeModal();
    health.dispose();
    warm.dispose();
    bridge.dispose();
    tab.destroy();
    removeStyle();
  };
}
export {
  setup
};
