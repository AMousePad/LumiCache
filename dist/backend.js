// @bun
// src/baseline.ts
import { createHash } from "crypto";
import { promisify } from "util";
import { gunzip, gzip } from "zlib";
var responses = (message) => Math.max(message.swipes.filter((swipe) => swipe.trim()).length, message.content.trim() ? 1 : 0);
function supersededBy(messages, mark) {
  return messages.some((message) => !message.is_user && (message.index_in_chat > mark.index ? responses(message) > 0 : message.index_in_chat === mark.index && responses(message) > mark.swipes));
}
var DIRECTORY = "baselines";
var MAX_FILES = 128;
var pack = promisify(gzip);
var unpack = promisify(gunzip);
var hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 32);

class BaselineStore {
  api;
  queue = Promise.resolve();
  constructor(api) {
    this.api = api;
  }
  prefix(chat) {
    return `${DIRECTORY}/${hash(chat)}.`;
  }
  path(chat, scope) {
    return `${this.prefix(chat)}${scope ? hash(scope) : "main"}.json.gz`;
  }
  enqueue(task) {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => {});
    return result;
  }
  load(user, chat, scope) {
    return this.enqueue(async () => {
      const path = this.path(chat, scope);
      if (!await this.api.userStorage.exists(path, user))
        return null;
      const saved = JSON.parse(new TextDecoder().decode(await unpack(await this.api.userStorage.readBinary(path, user))));
      return saved.reply && supersededBy(await this.api.chat.getMessages(chat), saved.reply) ? null : saved;
    });
  }
  save(user, chat, scope, saved, replyId) {
    this.enqueue(async () => {
      const reply = replyId ? (await this.api.chat.getMessages(chat)).find((message) => message.id === replyId) : undefined;
      const stored = reply ? { ...saved, reply: { index: reply.index_in_chat, swipes: responses(reply) } } : saved;
      await this.api.userStorage.writeBinary(this.path(chat, scope), new Uint8Array(await pack(JSON.stringify(stored))), user);
      await this.prune(user);
    }).catch((error) => console.warn("[LumiCache] Could not save the baseline:", error));
  }
  clear(user, chat) {
    this.enqueue(async () => {
      const files = await this.files(user);
      for (const file of files)
        if (file.startsWith(this.prefix(chat)))
          await this.api.userStorage.delete(file, user);
    }).catch((error) => console.warn("[LumiCache] Could not remove the baseline:", error));
  }
  async files(user) {
    return (await this.api.userStorage.list(DIRECTORY, user)).map((file) => file.startsWith(`${DIRECTORY}/`) ? file : `${DIRECTORY}/${file}`);
  }
  async prune(user) {
    const files = await this.files(user);
    if (files.length <= MAX_FILES)
      return;
    const dated = await Promise.all(files.map(async (file) => ({ file, at: Date.parse((await this.api.userStorage.stat(file, user)).modifiedAt) })));
    dated.sort((a, b) => a.at - b.at);
    for (const { file } of dated.slice(0, files.length - MAX_FILES))
      await this.api.userStorage.delete(file, user);
  }
}

// src/prompt-store.ts
import { createHash as createHash2 } from "crypto";
// node_modules/diff/libesm/diff/base.js
class Diff {
  diff(oldStr, newStr, options = {}) {
    let callback;
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if ("callback" in options) {
      callback = options.callback;
    }
    const oldString = this.castInput(oldStr, options);
    const newString = this.castInput(newStr, options);
    const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
    const newTokens = this.removeEmpty(this.tokenize(newString, options));
    return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
  }
  diffWithOptionsObj(oldTokens, newTokens, options, callback) {
    var _a;
    const done = (value) => {
      value = this.postProcess(value, options);
      if (callback) {
        setTimeout(function() {
          callback(value);
        }, 0);
        return;
      } else {
        return value;
      }
    };
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let editLength = 1;
    let maxEditLength = newLen + oldLen;
    if (options.maxEditLength != null) {
      maxEditLength = Math.min(maxEditLength, options.maxEditLength);
    }
    const maxExecutionTime = (_a = options.timeout) !== null && _a !== undefined ? _a : Infinity;
    const abortAfterTimestamp = Date.now() + maxExecutionTime;
    const bestPath = [{ oldPos: -1, lastComponent: undefined }];
    let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
    if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
      return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
    }
    let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
    const execEditLength = () => {
      for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength);diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
        let basePath;
        const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
        if (removePath) {
          bestPath[diagonalPath - 1] = undefined;
        }
        let canAdd = false;
        if (addPath) {
          const addPathNewPos = addPath.oldPos - diagonalPath;
          canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
        }
        const canRemove = removePath && removePath.oldPos + 1 < oldLen;
        if (!canAdd && !canRemove) {
          bestPath[diagonalPath] = undefined;
          continue;
        }
        if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) {
          basePath = this.addToPath(addPath, true, false, 0, options);
        } else {
          basePath = this.addToPath(removePath, false, true, 1, options);
        }
        newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
        if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
        } else {
          bestPath[diagonalPath] = basePath;
          if (basePath.oldPos + 1 >= oldLen) {
            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
          }
          if (newPos + 1 >= newLen) {
            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
          }
        }
      }
      editLength++;
    };
    if (callback) {
      (function exec() {
        setTimeout(function() {
          if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
            return callback(undefined);
          }
          if (!execEditLength()) {
            exec();
          }
        }, 0);
      })();
    } else {
      while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        const ret = execEditLength();
        if (ret) {
          return ret;
        }
      }
    }
  }
  addToPath(path, added, removed, oldPosInc, options) {
    const last = path.lastComponent;
    if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: last.count + 1, added, removed, previousComponent: last.previousComponent }
      };
    } else {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: 1, added, removed, previousComponent: last }
      };
    }
  }
  extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
      newPos++;
      oldPos++;
      commonCount++;
      if (options.oneChangePerToken) {
        basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
      }
    }
    if (commonCount && !options.oneChangePerToken) {
      basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
    }
    basePath.oldPos = oldPos;
    return newPos;
  }
  equals(left, right, options) {
    if (options.comparator) {
      return options.comparator(left, right);
    } else {
      return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
    }
  }
  removeEmpty(array) {
    const ret = [];
    for (let i = 0;i < array.length; i++) {
      if (array[i]) {
        ret.push(array[i]);
      }
    }
    return ret;
  }
  castInput(value, options) {
    return value;
  }
  tokenize(value, options) {
    return Array.from(value);
  }
  join(chars) {
    return chars.join("");
  }
  postProcess(changeObjects, options) {
    return changeObjects;
  }
  get useLongestToken() {
    return false;
  }
  buildValues(lastComponent, newTokens, oldTokens) {
    const components = [];
    let nextComponent;
    while (lastComponent) {
      components.push(lastComponent);
      nextComponent = lastComponent.previousComponent;
      delete lastComponent.previousComponent;
      lastComponent = nextComponent;
    }
    components.reverse();
    const componentLen = components.length;
    let componentPos = 0, newPos = 0, oldPos = 0;
    for (;componentPos < componentLen; componentPos++) {
      const component = components[componentPos];
      if (!component.removed) {
        if (!component.added && this.useLongestToken) {
          let value = newTokens.slice(newPos, newPos + component.count);
          value = value.map(function(value, i) {
            const oldValue = oldTokens[oldPos + i];
            return oldValue.length > value.length ? oldValue : value;
          });
          component.value = this.join(value);
        } else {
          component.value = this.join(newTokens.slice(newPos, newPos + component.count));
        }
        newPos += component.count;
        if (!component.added) {
          oldPos += component.count;
        }
      } else {
        component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
        oldPos += component.count;
      }
    }
    return components;
  }
}

// node_modules/diff/libesm/util/string.js
function longestCommonPrefix(str1, str2) {
  let i;
  for (i = 0;i < str1.length && i < str2.length; i++) {
    if (str1[i] != str2[i]) {
      return str1.slice(0, i);
    }
  }
  return str1.slice(0, i);
}
function longestCommonSuffix(str1, str2) {
  let i;
  if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) {
    return "";
  }
  for (i = 0;i < str1.length && i < str2.length; i++) {
    if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) {
      return str1.slice(-i);
    }
  }
  return str1.slice(-i);
}
function replacePrefix(string, oldPrefix, newPrefix) {
  if (string.slice(0, oldPrefix.length) != oldPrefix) {
    throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
  }
  return newPrefix + string.slice(oldPrefix.length);
}
function replaceSuffix(string, oldSuffix, newSuffix) {
  if (!oldSuffix) {
    return string + newSuffix;
  }
  if (string.slice(-oldSuffix.length) != oldSuffix) {
    throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
  }
  return string.slice(0, -oldSuffix.length) + newSuffix;
}
function removePrefix(string, oldPrefix) {
  return replacePrefix(string, oldPrefix, "");
}
function removeSuffix(string, oldSuffix) {
  return replaceSuffix(string, oldSuffix, "");
}
function maximumOverlap(string1, string2) {
  return string2.slice(0, overlapCount(string1, string2));
}
function overlapCount(a, b) {
  let startA = 0;
  if (a.length > b.length) {
    startA = a.length - b.length;
  }
  let endB = b.length;
  if (a.length < b.length) {
    endB = a.length;
  }
  const map = Array(endB);
  let k = 0;
  map[0] = 0;
  for (let j = 1;j < endB; j++) {
    if (b[j] == b[k]) {
      map[j] = map[k];
    } else {
      map[j] = k;
    }
    while (k > 0 && b[j] != b[k]) {
      k = map[k];
    }
    if (b[j] == b[k]) {
      k++;
    }
  }
  k = 0;
  for (let i = startA;i < a.length; i++) {
    while (k > 0 && a[i] != b[k]) {
      k = map[k];
    }
    if (a[i] == b[k]) {
      k++;
    }
  }
  return k;
}
function segment(string, segmenter) {
  const parts = [];
  for (const segmentObj of Array.from(segmenter.segment(string))) {
    const segment = segmentObj.segment;
    if (parts.length && /\s/.test(parts[parts.length - 1]) && /\s/.test(segment)) {
      parts[parts.length - 1] += segment;
    } else {
      parts.push(segment);
    }
  }
  return parts;
}
function trailingWs(string, segmenter) {
  if (segmenter) {
    return leadingAndTrailingWs(string, segmenter)[1];
  }
  let i;
  for (i = string.length - 1;i >= 0; i--) {
    if (!string[i].match(/\s/)) {
      break;
    }
  }
  return string.substring(i + 1);
}
function leadingWs(string, segmenter) {
  if (segmenter) {
    return leadingAndTrailingWs(string, segmenter)[0];
  }
  const match = string.match(/^\s*/);
  return match ? match[0] : "";
}
function leadingAndTrailingWs(string, segmenter) {
  if (!segmenter) {
    return [leadingWs(string), trailingWs(string)];
  }
  if (segmenter.resolvedOptions().granularity != "word") {
    throw new Error('The segmenter passed must have a granularity of "word"');
  }
  const segments = segment(string, segmenter);
  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];
  const head = /\s/.test(firstSeg) ? firstSeg : "";
  const tail = /\s/.test(lastSeg) ? lastSeg : "";
  return [head, tail];
}

// node_modules/diff/libesm/diff/word.js
var extendedWordChars = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
var tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, "ug");

class WordDiff extends Diff {
  equals(left, right, options) {
    if (options.ignoreCase) {
      left = left.toLowerCase();
      right = right.toLowerCase();
    }
    return left.trim() === right.trim();
  }
  tokenize(value, options = {}) {
    let parts;
    if (options.intlSegmenter) {
      const segmenter = options.intlSegmenter;
      if (segmenter.resolvedOptions().granularity != "word") {
        throw new Error('The segmenter passed must have a granularity of "word"');
      }
      parts = segment(value, segmenter);
    } else {
      parts = value.match(tokenizeIncludingWhitespace) || [];
    }
    const tokens = [];
    let prevPart = null;
    parts.forEach((part) => {
      if (/\s/.test(part)) {
        if (prevPart == null) {
          tokens.push(part);
        } else {
          tokens.push(tokens.pop() + part);
        }
      } else if (prevPart != null && /\s/.test(prevPart)) {
        if (tokens[tokens.length - 1] == prevPart) {
          tokens.push(tokens.pop() + part);
        } else {
          tokens.push(prevPart + part);
        }
      } else {
        tokens.push(part);
      }
      prevPart = part;
    });
    return tokens;
  }
  join(tokens) {
    return tokens.map((token, i) => {
      if (i == 0) {
        return token;
      } else {
        return token.replace(/^\s+/, "");
      }
    }).join("");
  }
  postProcess(changes, options) {
    if (!changes || options.oneChangePerToken) {
      return changes;
    }
    let lastKeep = null;
    let insertion = null;
    let deletion = null;
    changes.forEach((change) => {
      if (change.added) {
        insertion = change;
      } else if (change.removed) {
        deletion = change;
      } else {
        if (insertion || deletion) {
          dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
        }
        lastKeep = change;
        insertion = null;
        deletion = null;
      }
    });
    if (insertion || deletion) {
      dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
    }
    return changes;
  }
}
var wordDiff = new WordDiff;
function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep, segmenter) {
  if (deletion && insertion) {
    const [oldWsPrefix, oldWsSuffix] = leadingAndTrailingWs(deletion.value, segmenter);
    const [newWsPrefix, newWsSuffix] = leadingAndTrailingWs(insertion.value, segmenter);
    if (startKeep) {
      const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
      startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
      deletion.value = removePrefix(deletion.value, commonWsPrefix);
      insertion.value = removePrefix(insertion.value, commonWsPrefix);
    }
    if (endKeep) {
      const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
      endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
      deletion.value = removeSuffix(deletion.value, commonWsSuffix);
      insertion.value = removeSuffix(insertion.value, commonWsSuffix);
    }
  } else if (insertion) {
    if (startKeep) {
      const ws = leadingWs(insertion.value, segmenter);
      insertion.value = insertion.value.substring(ws.length);
    }
    if (endKeep) {
      const ws = leadingWs(endKeep.value, segmenter);
      endKeep.value = endKeep.value.substring(ws.length);
    }
  } else if (startKeep && endKeep) {
    const newWsFull = leadingWs(endKeep.value, segmenter), [delWsStart, delWsEnd] = leadingAndTrailingWs(deletion.value, segmenter);
    const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
    deletion.value = removePrefix(deletion.value, newWsStart);
    const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
    deletion.value = removeSuffix(deletion.value, newWsEnd);
    endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);
    startKeep.value = replaceSuffix(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
  } else if (endKeep) {
    const endKeepWsPrefix = leadingWs(endKeep.value, segmenter);
    const deletionWsSuffix = trailingWs(deletion.value, segmenter);
    const overlap = maximumOverlap(deletionWsSuffix, endKeepWsPrefix);
    deletion.value = removeSuffix(deletion.value, overlap);
  } else if (startKeep) {
    const startKeepWsSuffix = trailingWs(startKeep.value, segmenter);
    const deletionWsPrefix = leadingWs(deletion.value, segmenter);
    const overlap = maximumOverlap(startKeepWsSuffix, deletionWsPrefix);
    deletion.value = removePrefix(deletion.value, overlap);
  }
}

class WordsWithSpaceDiff extends Diff {
  tokenize(value) {
    const regex = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, "ug");
    return value.match(regex) || [];
  }
}
var wordsWithSpaceDiff = new WordsWithSpaceDiff;
function diffWordsWithSpace(oldStr, newStr, options) {
  return wordsWithSpaceDiff.diff(oldStr, newStr, options);
}
// node_modules/diff/libesm/diff/array.js
class ArrayDiff extends Diff {
  tokenize(value) {
    return value.slice();
  }
  join(value) {
    return value;
  }
  removeEmpty(value) {
    return value;
  }
}
var arrayDiff = new ArrayDiff;
function diffArrays(oldArr, newArr, options) {
  return arrayDiff.diff(oldArr, newArr, options);
}
// src/diff-engine.ts
var PAGE_ROWS = 100;
var ROW_CHARACTERS = 1024;
var WORD_DIFF_CHARACTERS = 256000;
var WORD_DIFF_MS = 80;
var WORD_DIFF_MIN_COMMON = 0.2;

class TextIndex {
  text;
  starts;
  lines;
  columns;
  constructor(text) {
    this.text = text;
    const scan = (visit) => {
      let row = 0, position = 0, line = 1, lineStart = 0, newline = text.indexOf(`
`);
      visit?.(0, 0, 1, 1);
      while (position < text.length) {
        let end = Math.min(text.length, position + ROW_CHARACTERS, newline < 0 ? Infinity : newline + 1);
        if (end < text.length && (text.charCodeAt(end - 1) === 13 && text.charCodeAt(end) === 10 || text.charCodeAt(end - 1) >= 55296 && text.charCodeAt(end - 1) <= 56319 && text.charCodeAt(end) >= 56320 && text.charCodeAt(end) <= 57343))
          end--;
        if (end === newline + 1) {
          line++;
          lineStart = end;
          newline = text.indexOf(`
`, end);
        }
        position = end;
        if (++row > 2000000)
          throw new Error("This message exceeds two million display fragments. Split it into smaller prompt messages to inspect its diff.");
        visit?.(row, position, line, position - lineStart + 1);
      }
      return row + 1;
    };
    const count = scan();
    this.starts = new Uint32Array(count);
    this.lines = new Uint32Array(count);
    this.columns = new Uint32Array(count);
    scan((row, offset, line, column) => {
      this.starts[row] = offset;
      this.lines[row] = line;
      this.columns[row] = column;
    });
  }
  at(offset) {
    let low = 0, high = this.starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.starts[mid] <= offset)
        low = mid;
      else
        high = mid - 1;
    }
    return low;
  }
  location(offset) {
    const index = this.at(offset), line = this.lines[index];
    return { line, column: this.columns[index] + offset - this.starts[index] };
  }
  count(start, end) {
    return end <= start ? 0 : this.at(end - 1) - this.at(start) + 1;
  }
  range(start, end, row) {
    const index = this.at(start) + row;
    return [Math.max(start, this.starts[index]), Math.min(end, this.starts[index + 1])];
  }
}
function tokens(text) {
  const result = [];
  let start = 0, newline = text.indexOf(`
`);
  while (start < text.length) {
    if (result.length >= 200000)
      return;
    let end = Math.min(text.length, start + ROW_CHARACTERS, newline < 0 ? Infinity : newline + 1);
    if (end < text.length && (text.charCodeAt(end - 1) === 13 && text.charCodeAt(end) === 10 || text.charCodeAt(end - 1) >= 55296 && text.charCodeAt(end - 1) <= 56319 && text.charCodeAt(end) >= 56320 && text.charCodeAt(end) <= 57343))
      end--;
    if (end === newline + 1)
      newline = text.indexOf(`
`, end);
    result.push(text.slice(start, end));
    start = end;
  }
  return result;
}

class DiffPlan {
  before;
  after;
  sections = [];
  total;
  note;
  constructor(oldText, newText) {
    this.before = new TextIndex(oldText);
    this.after = new TextIndex(newText);
    let prefix = 0, suffix = 0;
    const min = Math.min(oldText.length, newText.length);
    while (prefix < min && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix))
      prefix++;
    while (suffix < min - prefix && oldText.charCodeAt(oldText.length - suffix - 1) === newText.charCodeAt(newText.length - suffix - 1))
      suffix++;
    if (oldText !== newText) {
      const lineStart = prefix ? oldText.lastIndexOf(`
`, prefix - 1) + 1 : 0;
      if (prefix - lineStart <= ROW_CHARACTERS)
        prefix = lineStart;
      const end = oldText.length - suffix, newline = oldText.indexOf(`
`, end);
      if (newline >= 0 && newline + 1 - end <= ROW_CHARACTERS)
        suffix = oldText.length - newline - 1;
      else if (suffix <= ROW_CHARACTERS)
        suffix = 0;
    }
    const split = (s, n) => n > 0 && n < s.length && (s.charCodeAt(n - 1) === 13 && s.charCodeAt(n) === 10 || s.charCodeAt(n - 1) >= 55296 && s.charCodeAt(n - 1) <= 56319 && s.charCodeAt(n) >= 56320 && s.charCodeAt(n) <= 57343);
    if (split(oldText, prefix) || split(newText, prefix))
      prefix--;
    if (split(oldText, oldText.length - suffix) || split(newText, newText.length - suffix))
      suffix--;
    const runs = [];
    if (prefix)
      runs.push({ kind: "equal", start: 0, end: prefix, other: 0 });
    const oldMiddle = oldText.slice(prefix, oldText.length - suffix), newMiddle = newText.slice(prefix, newText.length - suffix);
    const oldTokens = tokens(oldMiddle), newTokens = tokens(newMiddle);
    const parts = oldTokens && newTokens && oldTokens.length + newTokens.length <= 200000 ? diffArrays(oldTokens, newTokens, { timeout: 80, maxEditLength: 1000 }) : undefined;
    let a = prefix, b = prefix;
    if (parts)
      for (const part of parts) {
        const length = part.value.reduce((n, token) => n + token.length, 0);
        if (!length)
          continue;
        if (part.added) {
          runs.push({ kind: "add", start: b, end: b + length, other: a });
          b += length;
        } else if (part.removed) {
          runs.push({ kind: "remove", start: a, end: a + length, other: b });
          a += length;
        } else {
          runs.push({ kind: "equal", start: a, end: a + length, other: b });
          a += length;
          b += length;
        }
      }
    else {
      if (oldMiddle.length)
        runs.push({ kind: "remove", start: prefix, end: oldText.length - suffix, other: prefix });
      if (newMiddle.length)
        runs.push({ kind: "add", start: prefix, end: newText.length - suffix, other: prefix });
      this.note = "This large changed region is shown as a replacement because detailed alignment reached its work limit. All text remains available in bounded pages; unchanged text inside this region may appear on both sides.";
    }
    if (suffix)
      runs.push({ kind: "equal", start: oldText.length - suffix, end: oldText.length, other: newText.length - suffix });
    for (let i = 0;i + 1 < runs.length; i++)
      if (runs[i].kind === "remove" && runs[i + 1].kind === "add") {
        runs[i].partner = runs[i + 1];
        runs[i + 1].partner = runs[i];
      }
    let cursor = 0;
    const add = (run, first, count, fold) => {
      if (!count)
        return;
      this.sections.push({ run, first, count, fold, cursor });
      cursor += fold ? 1 : count;
    };
    for (const [i, run] of runs.entries()) {
      const count = this.index(run).count(run.start, run.end);
      if (run.kind !== "equal") {
        add(run, 0, count, false);
        continue;
      }
      const head = i ? Math.min(3, count) : 0;
      const tail = i < runs.length - 1 ? Math.min(3, count - head) : 0;
      add(run, 0, head, false);
      add(run, head, count - head - tail, true);
      add(run, count - tail, tail, false);
    }
    this.total = cursor;
  }
  index(run) {
    return run.kind === "add" ? this.after : this.before;
  }
  wordChanges(run) {
    if (run.changed !== undefined)
      return run.changed;
    const partner = run.partner;
    if (!partner)
      return run.changed = null;
    const removed = run.kind === "remove" ? run : partner, added = run.kind === "remove" ? partner : run;
    removed.changed = added.changed = null;
    const oldText = this.before.text.slice(removed.start, removed.end), newText = this.after.text.slice(added.start, added.end);
    if (oldText.length > WORD_DIFF_CHARACTERS || newText.length > WORD_DIFF_CHARACTERS)
      return null;
    const parts = diffWordsWithSpace(oldText, newText, { timeout: WORD_DIFF_MS });
    if (!parts)
      return null;
    const oldRanges = [], newRanges = [];
    let a = removed.start, b = added.start, common = 0;
    const push = (ranges, text, start, end) => {
      const last = ranges.at(-1);
      if (last && /^[ \t]{0,2}$/.test(text.slice(last[1], start)))
        last[1] = end;
      else
        ranges.push([start, end]);
    };
    for (const part of parts) {
      const size = part.value.length;
      if (part.removed) {
        push(oldRanges, this.before.text, a, a + size);
        a += size;
      } else if (part.added) {
        push(newRanges, this.after.text, b, b + size);
        b += size;
      } else {
        common += size;
        a += size;
        b += size;
      }
    }
    if (common / Math.max(oldText.length, newText.length, 1) < WORD_DIFF_MIN_COMMON)
      return null;
    removed.changed = oldRanges;
    added.changed = newRanges;
    return run.changed;
  }
  spans(run, text, start, end) {
    const ranges = this.wordChanges(run);
    if (!ranges?.length)
      return;
    let low = 0, high = ranges.length;
    while (low < high) {
      const mid = low + high >> 1;
      if (ranges[mid][1] <= start)
        low = mid + 1;
      else
        high = mid;
    }
    const result = [];
    for (let i = low;i < ranges.length && ranges[i][0] < end; i++)
      result.push([Math.max(ranges[i][0], start) - start, Math.min(ranges[i][1], end) - start]);
    const visible = text.replace(/\r?\n$/, "").length;
    if (!result.length || result.length === 1 && result[0][0] === 0 && result[0][1] >= visible)
      return;
    return result;
  }
  row(section, row) {
    const { run } = section, index = this.index(run);
    const [start, end] = index.range(run.start, run.end, section.first + row), location = index.location(start);
    const next = run.kind === "equal" ? this.after.location(run.other + start - run.start) : location;
    const text = index.text.slice(start, end), spans = run.kind === "equal" ? undefined : this.spans(run, text, start, end);
    return {
      kind: run.kind,
      text,
      ...spans ? { spans } : {},
      ...run.kind !== "add" ? { oldLine: location.line, oldColumn: location.column } : {},
      ...run.kind !== "remove" ? { newLine: next.line, newColumn: next.column } : {}
    };
  }
  page(cursor = 0, fold, limit = PAGE_ROWS) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_ROWS)
      throw new Error("Invalid diff page size.");
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new Error("Invalid diff page.");
    const selected = fold === undefined ? undefined : this.sections[fold];
    if (fold !== undefined && (!selected || !selected.fold))
      throw new Error("This context section is unavailable.");
    const total = selected ? selected.count : this.total;
    if (cursor > Math.max(0, total - 1))
      throw new Error("This diff page is outside the available range.");
    const items = [];
    const end = Math.min(total, cursor + limit);
    if (selected)
      for (let i = cursor;i < end; i++)
        items.push(this.row(selected, i));
    else
      for (const [id, section] of this.sections.entries()) {
        if (section.cursor >= end)
          break;
        const size = section.fold ? 1 : section.count;
        if (section.cursor + size <= cursor)
          continue;
        if (section.fold) {
          const index = this.index(section.run), [start] = index.range(section.run.start, section.run.end, section.first);
          const [, finish] = index.range(section.run.start, section.run.end, section.first + section.count - 1);
          items.push({ kind: "fold", id, rows: section.count, characters: finish - start });
        } else
          for (let i = Math.max(0, cursor - section.cursor);i < Math.min(section.count, end - section.cursor); i++)
            items.push(this.row(section, i));
      }
    return {
      items,
      cursor,
      total,
      ...end < total ? { next: end } : {},
      ...cursor ? { previous: Math.max(0, cursor - limit) } : {},
      ...!selected ? { note: this.note, nextChange: this.sections.find((s) => !s.fold && s.run.kind !== "equal" && s.cursor >= end)?.cursor } : {}
    };
  }
}

// src/prompt-store.ts
var LIMIT = 256000000;
var TTL = 30 * 60000;
var integer = (value, fallback = 0) => {
  if (value === undefined)
    return fallback;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid prompt page.");
  return value;
};
function alignMessages(a, b) {
  const hash = (m) => createHash2("sha256").update(m.header).update("\x00").update(m.body).digest("hex");
  const parts = diffArrays(a.map(hash), b.map(hash), { timeout: 60, maxEditLength: 1000 });
  const pairs = [];
  if (!parts) {
    for (let i = 0;i < Math.max(a.length, b.length); i++)
      pairs.push([i < a.length ? i : undefined, i < b.length ? i : undefined]);
    return { pairs, aligned: false };
  }
  let ai = 0, bi = 0, removed = [], added = [];
  const flush = () => {
    for (let i = 0;i < Math.max(removed.length, added.length); i++)
      pairs.push([removed[i], added[i]]);
    removed = [];
    added = [];
  };
  for (const part of parts) {
    if (part.removed) {
      for (let i = 0;i < part.value.length; i++)
        removed.push(ai++);
    } else if (part.added) {
      for (let i = 0;i < part.value.length; i++)
        added.push(bi++);
    } else {
      flush();
      for (let i = 0;i < part.value.length; i++)
        pairs.push([ai++, bi++]);
    }
  }
  flush();
  return { pairs, aligned: true };
}

class PromptStore {
  snapshots = new Map;
  plans = new Map;
  references = new WeakMap;
  lists = new Map;
  prune() {
    for (const [key, value] of this.snapshots)
      if (value.touched < Date.now() - TTL)
        this.snapshots.delete(key);
    for (const [key, value] of this.plans)
      if (value.touched < Date.now() - TTL)
        this.plans.delete(key);
    let size = [...this.snapshots.values()].reduce((n, value) => n + value.size, 0);
    while (size > LIMIT || this.snapshots.size > 128) {
      const [key, value] = this.snapshots.entries().next().value;
      this.snapshots.delete(key);
      size -= value.size;
    }
    let planSize = [...this.plans.values()].reduce((n, value) => n + value.size, 0);
    while (this.plans.size > 12 || planSize > 192000000) {
      const [key, value] = this.plans.entries().next().value;
      this.plans.delete(key);
      planSize -= value.size;
    }
    if (this.lists.size > 64)
      this.lists.delete(this.lists.keys().next().value);
  }
  expose(snapshot, user, session) {
    let reference = this.references.get(snapshot), stored = reference ? this.snapshots.get(reference) : undefined;
    if (!stored || stored.user !== user || stored.session !== session) {
      reference = crypto.randomUUID();
      stored = { user, session, snapshot, size: snapshot.messages.reduce((n, m) => n + m.body.length + m.header.length, 0), touched: Date.now() };
      this.references.set(snapshot, reference);
      this.snapshots.set(reference, stored);
    } else {
      stored.touched = Date.now();
      this.snapshots.delete(reference);
      this.snapshots.set(reference, stored);
    }
    this.prune();
    return { at: snapshot.at, route: snapshot.route, model: snapshot.model, messages: [], reference, messageCount: snapshot.messages.length };
  }
  pack(value, user, session) {
    if (!value || typeof value !== "object")
      return value;
    if (Array.isArray(value))
      return value.map((item) => this.pack(item, user, session));
    const object = value;
    if (Array.isArray(object.messages) && typeof object.route === "string" && typeof object.at === "number")
      return this.expose(value, user, session);
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, this.pack(item, user, session)]));
  }
  get(id, user, session) {
    this.prune();
    const value = this.snapshots.get(id);
    if (!value || value.user !== user || value.session !== session)
      throw new Error("This prompt view expired or belongs to another browser. Refresh the live check or rerun the simulation.");
    value.touched = Date.now();
    this.snapshots.delete(id);
    this.snapshots.set(id, value);
    return value.snapshot;
  }
  list(user, session, input) {
    const before = input.before ? this.get(input.before, user, session) : undefined, after = this.get(input.after, user, session);
    const key = JSON.stringify([input.before, input.after, !!input.includeUnchanged]);
    let list = this.lists.get(key);
    if (!list) {
      const a = before?.messages ?? [], b = after.messages, alignment = alignMessages(a, b);
      const items = [];
      let unchanged = 0;
      const add = (oldIndex, newIndex) => {
        const old = oldIndex === undefined ? undefined : a[oldIndex], next = newIndex === undefined ? undefined : b[newIndex];
        const same = !!old && !!next && old.header === next.header && old.body === next.body;
        if (same)
          unchanged++;
        if (!same || input.includeUnchanged)
          items.push({
            oldIndex,
            newIndex,
            role: next?.role ?? old.role,
            kind: same ? "unchanged" : !old ? "added" : !next ? "removed" : "changed",
            headerChanged: !!old && !!next && old.header !== next.header
          });
      };
      for (const [oldIndex, newIndex] of alignment.pairs)
        add(oldIndex, newIndex);
      list = { items, unchanged, ...!alignment.aligned ? { note: "Message alignment reached its work limit; messages are compared by position." } : {} };
      this.lists.set(key, list);
    }
    const cursor = integer(input.cursor), total = list.items.length;
    if (cursor > Math.max(total - 1, 0))
      throw new Error("This message page is outside the available range.");
    return {
      items: list.items.slice(cursor, cursor + 20),
      total,
      unchanged: list.unchanged,
      cursor,
      note: list.note,
      ...cursor + 20 < total ? { next: cursor + 20 } : {},
      ...cursor ? { previous: Math.max(0, cursor - 20) } : {}
    };
  }
  open(user, session, input, pageRows = 100) {
    const before = input.before ? this.get(input.before, user, session) : undefined, after = this.get(input.after, user, session);
    const read = (snapshot, index) => {
      if (index === undefined)
        return "";
      const message = snapshot?.messages[integer(index)];
      if (!message)
        throw new Error("This prompt message is unavailable.");
      return input.part === "header" ? message.header : message.body;
    };
    const oldText = read(before, input.oldIndex), newText = read(after, input.newIndex);
    const plan = new DiffPlan(oldText, newText), id = crypto.randomUUID();
    this.plans.set(id, { user, session, plan, touched: Date.now(), size: (oldText.length + newText.length) * 2 + plan.before.starts.byteLength * 3 + plan.after.starts.byteLength * 3 });
    this.prune();
    return { id, page: plan.page(0, undefined, pageRows) };
  }
  page(user, session, input) {
    this.prune();
    const stored = this.plans.get(input.id);
    if (!stored || stored.user !== user || stored.session !== session)
      throw new Error("This diff view expired. Close and reopen the message to load it again.");
    stored.touched = Date.now();
    this.plans.delete(input.id);
    this.plans.set(input.id, stored);
    return stored.plan.page(integer(input.cursor), input.fold === undefined ? undefined : integer(input.fold), input.limit);
  }
}

// src/health/timeline.ts
var MAX_PARTS = 16;
var MIN_SEARCH = 8;
function normalizedHistory(message) {
  const flags = message;
  const history = flags.__isChatHistory === true || flags.__chatHistorySource === true;
  return {
    role: message.role,
    content: message.content,
    name: message.name,
    ...history ? { __isChatHistory: true } : {},
    ...flags.sourceMessageId ?? flags.__sourceMessageId ? { sourceMessageId: flags.sourceMessageId ?? flags.__sourceMessageId } : {},
    ...(flags.sourceIndexInChat ?? flags.__sourceIndexInChat) !== undefined ? { sourceIndexInChat: flags.sourceIndexInChat ?? flags.__sourceIndexInChat } : {}
  };
}
function entryKind(entry, injected) {
  if (entry.type === "world_info")
    return "world";
  if (["long_term_memory", "databank", "databank_mention"].includes(entry.type))
    return "memory";
  if (entry.type === "extension" || entry.extensionId)
    return "extension";
  if (entry.marker === "persona_description")
    return "persona";
  if (["char_description", "char_personality", "scenario", "dialogue_examples", "jailbreak"].includes(entry.marker ?? ""))
    return "character";
  return injected || ["authors_note", "utility"].includes(entry.type) ? "injection" : "system";
}
var RANK = { world: 0, memory: 0, extension: 0, persona: 1, character: 1, injection: 2, system: 2, story: 3, other: 3 };
function free(start, end, covered) {
  const result = [];
  let cursor = start;
  for (const [from, to] of covered) {
    if (to <= cursor || from >= end)
      continue;
    if (from > cursor)
      result.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < end)
    result.push([cursor, end]);
  return result;
}
function clean(text, size) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > size ? `${value.slice(0, size - 1)}\u2026` : value;
}
function promptOutline(snapshot, messages, breakdown) {
  const flags = messages, history = (m) => m?.__isChatHistory === true || m?.__chatHistorySource === true;
  const firstHistory = flags.findIndex(history);
  const entries = breakdown.filter((entry) => entry.type !== "chat_history" && entry.content?.trim()).map((entry) => ({ entry, text: entry.content.trim() }));
  return snapshot.messages.map((message, index) => {
    const source = flags[index], { body: text, role } = message;
    const base = { role, preview: clean(text, 110), characters: text.length };
    if (history(source)) {
      const label = clean(source.name || (role === "user" ? "User" : role === "assistant" ? "Assistant" : "System"), 60);
      const chatIndex = source.sourceIndexInChat ?? source.__sourceIndexInChat;
      return { ...base, kind: "story", label, injected: false, ...chatIndex !== undefined ? { chatIndex } : {}, parts: [{ kind: "story", label, start: 0, end: text.length }] };
    }
    const injected = firstHistory >= 0 && index > firstHistory;
    const fallback = source?.__worldInfoSource ? "world" : injected ? "injection" : "system";
    const parts = [], covered = [];
    const ranked = entries.map((item) => ({ ...item, kind: entryKind(item.entry, injected) })).sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.text.length - a.text.length);
    for (const { entry, text: content, kind } of ranked) {
      if (content.length < MIN_SEARCH && content !== text.trim())
        continue;
      const start = text.indexOf(content);
      if (start < 0)
        continue;
      const label = clean(entry.extensionName && kind === "extension" ? `${entry.extensionName}: ${entry.name}` : entry.name, 120);
      for (const [from, to] of free(start, start + content.length, covered)) {
        parts.push({ kind, label, start: from, end: to });
        covered.push([from, to]);
      }
      covered.sort((a, b) => a[0] - b[0]);
    }
    for (const [from, to] of free(0, text.length, covered))
      if (text.slice(from, to).trim())
        parts.push({ kind: fallback, label: fallback === "world" ? "World info" : injected ? "Injected text" : "Prompt text", start: from, end: to });
    parts.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const part of parts) {
      const last = merged.at(-1);
      if (last?.label === part.label && last.kind === part.kind)
        last.end = part.end;
      else
        merged.push({ ...part });
    }
    const bounded = merged.length > MAX_PARTS ? [...merged.slice(0, MAX_PARTS - 1), { ...merged[MAX_PARTS - 1], end: merged.at(-1).end, label: `${merged.length - MAX_PARTS + 1} more sources` }] : merged;
    const largest = [...bounded].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    const names = new Set(bounded.map((part) => part.label));
    return {
      ...base,
      kind: largest?.kind ?? fallback,
      injected,
      parts: bounded,
      label: largest ? `${largest.label}${names.size > 1 ? ` +${names.size - 1}` : ""}` : "Empty message"
    };
  });
}
function changedRange(before, after) {
  const end = Math.min(before.length, after.length);
  let prefix = 0, suffix = 0;
  while (prefix < end && before.charCodeAt(prefix) === after.charCodeAt(prefix))
    prefix++;
  while (suffix < end - prefix && before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1))
    suffix++;
  return { before: [prefix, Math.max(prefix + 1, before.length - suffix)], after: [prefix, Math.max(prefix + 1, after.length - suffix)] };
}
var touched = (turn, [from, to]) => (turn?.parts ?? []).filter((part) => part.start < to && part.end > from).map((part) => part.label);
function buildTimeline(before, beforeOutline, after, afterOutline, comparison, tolerated = false) {
  const rows = [];
  const row = (status, oldIndex, newIndex, root, sources, headerChanged = false) => {
    const turn = newIndex !== undefined ? afterOutline[newIndex] : beforeOutline?.[oldIndex], total = Math.max(1, turn.characters);
    const names = [...new Set(sources)], culprit = status === "changed" ? turn.parts.find((part) => part.label === names[0]) : undefined;
    const kind = culprit?.kind ?? turn.kind, label = culprit ? `${culprit.label}${names.length > 1 ? ` +${names.length - 1}` : ""}` : turn.label;
    rows.push({
      ...oldIndex !== undefined ? { oldIndex } : {},
      ...newIndex !== undefined ? { newIndex } : {},
      status,
      ...root ? { root } : {},
      role: turn.role,
      kind,
      label,
      preview: turn.preview,
      characters: turn.characters,
      injected: turn.injected,
      ...turn.chatIndex !== undefined ? { chatIndex: turn.chatIndex } : {},
      headerChanged,
      parts: turn.parts.map((part) => ({ kind: part.kind, label: part.label, share: (part.end - part.start) / total })),
      sources: [...new Set(sources)]
    });
  };
  if (!before)
    afterOutline.forEach((turn, index) => row("base", undefined, index, false, turn.parts.map((part) => part.label)));
  else {
    const { pairs } = alignMessages(before.messages, after.messages);
    let broken = comparison.routeChanged, consumed = 0;
    for (const [oldIndex, newIndex] of pairs) {
      if (oldIndex !== undefined)
        consumed++;
      const old = oldIndex === undefined ? undefined : before.messages[oldIndex], next = newIndex === undefined ? undefined : after.messages[newIndex];
      if (old && next && old.header === next.header && old.body === next.body) {
        row(broken ? "rewritten" : "kept", oldIndex, newIndex, false, []);
        continue;
      }
      if (old && next) {
        const range = changedRange(old.body, next.body), sources = [...touched(beforeOutline?.[oldIndex], range.before), ...touched(afterOutline[newIndex], range.after)];
        if (!broken && consumed === before.messages.length && old.header === next.header && next.body.startsWith(old.body)) {
          row("new", oldIndex, newIndex, false, sources);
          continue;
        }
        row("changed", oldIndex, newIndex, !broken, sources, old.header !== next.header);
        broken = true;
        continue;
      }
      if (next) {
        const sources = afterOutline[newIndex].parts.map((part) => part.label);
        if (consumed === before.messages.length) {
          row("new", undefined, newIndex, false, sources);
          continue;
        }
        row("added", undefined, newIndex, !broken, sources);
        broken = true;
        continue;
      }
      row("removed", oldIndex, undefined, !broken, (beforeOutline?.[oldIndex].parts ?? []).map((part) => part.label));
      broken = true;
    }
  }
  const sum = (...statuses) => rows.filter((item) => statuses.includes(item.status) && item.newIndex !== undefined).reduce((n, item) => n + item.characters, 0);
  return { rows, kept: sum("kept", "base"), rewritten: sum("rewritten", "changed", "added"), added: sum("new"), problems: rows.filter((item) => ["changed", "added", "removed"].includes(item.status)).length, tolerated, routeChanged: comparison.routeChanged };
}

// src/compare.ts
import { createHash as createHash3 } from "crypto";
var MAX_PROMPT_CHARACTERS = 32000000;
function stableJson(value) {
  return JSON.stringify(value, (_key, part) => {
    if (!part || typeof part !== "object" || Array.isArray(part))
      return part;
    return Object.fromEntries(Object.keys(part).sort().map((key) => [key, part[key]]));
  });
}
function fingerprint(value) {
  return value === undefined ? undefined : `[sha256:${createHash3("sha256").update(value).digest("hex")} \xB7 ${value.length} characters]`;
}
function inspectPart(value) {
  const part = { ...value };
  delete part.cache_control;
  if (["image", "audio", "video"].includes(String(part.type)) && typeof part.data === "string")
    part.data = fingerprint(part.data);
  if (typeof part.thought_signature === "string")
    part.thought_signature = fingerprint(part.thought_signature);
  return part;
}
function commonPrefix(a, b) {
  const end = Math.min(a.length, b.length);
  let i = 0;
  while (i < end && a.charCodeAt(i) === b.charCodeAt(i))
    i++;
  return i;
}
function snapshot(messages, context) {
  const route = context.mainDispatch.descriptor;
  const normalized = [];
  let size = 0;
  for (const message of messages) {
    const wire = message;
    const header = stableJson({
      role: message.role,
      name: message.name,
      contentKind: typeof message.content === "string" ? "text" : "parts",
      thought_signature: fingerprint(wire.thought_signature),
      reasoning_content: message.reasoning_content,
      thinking_blocks: message.thinking_blocks?.map((block) => ({ ...block, data: fingerprint(block.data), signature: fingerprint(block.signature) })),
      reasoning_details: message.reasoning_details
    });
    const body = typeof message.content === "string" ? message.content : stableJson(message.content.map(inspectPart));
    size += header.length + body.length;
    if (size > MAX_PROMPT_CHARACTERS)
      throw new Error("LumiCache cannot inspect prompts larger than 32 million characters. Turn monitoring off in LumiCache to send this request.");
    normalized.push({ role: message.role, header, body });
  }
  return { at: Date.now(), model: route?.model ?? "Unresolved connection", route: stableJson(route ? {
    connectionId: route.connectionId,
    provider: route.provider,
    model: route.model,
    endpointOrigin: route.endpointOrigin,
    revision: route.connectionDispatchRevision
  } : { dispatchKind: context.mainDispatch.dispatchKind, revision: context.mainDispatch.connectionDispatchRevision }), messages: normalized };
}
function compare(before, after) {
  const result = {
    kind: "first",
    routeChanged: false,
    firstMessage: null,
    commonMessages: 0,
    commonCharacters: 0,
    previousCharacters: before?.messages.reduce((n, m) => n + m.body.length, 0) ?? 0,
    summary: "First request. A baseline will be kept after generation completes successfully."
  };
  if (!before)
    return result;
  result.routeChanged = before.route !== after.route;
  let extended = false;
  for (let index = 0;index < before.messages.length; index++) {
    const old = before.messages[index], next = after.messages[index];
    if (!next || old.header !== next.header) {
      result.firstMessage = index;
      break;
    }
    const prefix = commonPrefix(old.body, next.body);
    result.commonCharacters += prefix;
    if (old.body === next.body) {
      result.commonMessages++;
      continue;
    }
    if (index === before.messages.length - 1 && prefix === old.body.length) {
      extended = true;
      break;
    }
    result.firstMessage = index;
    break;
  }
  if (result.routeChanged || result.firstMessage !== null) {
    result.kind = "break";
    result.summary = result.routeChanged ? "The connection, model or connection configuration changed." : `The previous prompt prefix changes at message ${result.firstMessage + 1} (${before.messages[result.firstMessage].role}).`;
  } else {
    result.kind = extended || after.messages.length > before.messages.length ? "append" : "same";
    result.summary = result.kind === "append" ? "The previous prompt prefix is unchanged; new content follows it." : "The assembled prompt is unchanged.";
  }
  return result;
}

// src/shared.ts
var DEFAULT_SETTINGS = {
  mode: "warn",
  acceptableDepth: 2,
  acceptableTokens: null,
  forceConsistency: false,
  overflowPlacement: "end",
  refreshEnabled: true,
  refreshEvery: 20,
  autoRefreshEnabled: false,
  autoRefreshMinutes: 10,
  autoRefreshLimit: 3,
  hiddenCategories: []
};
var COVERAGE = "Compares assembled prompts before sending. Later host/provider changes, tools, cache expiry and provider cache state are not visible here. This is a cache-risk check, not a confirmed cache hit or miss.";
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
  for (const key of ["forceConsistency", "refreshEnabled", "autoRefreshEnabled"])
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
    hiddenCategories: [...new Set(result.hiddenCategories)]
  };
}

// src/consistency.ts
var historyMessage = (m) => m.__isChatHistory === true;
var identity = (m) => m.sourceMessageId;
var wire = (m) => stableJson({ ...m, sourceMessageMetadata: undefined, sourceMessageId: undefined, sourceIndexInChat: undefined, __isChatHistory: undefined });
function retain(messages) {
  let size = 0;
  const result = messages.map((m) => {
    const copy = { ...m };
    delete copy.sourceMessageMetadata;
    size += stableJson(copy).length;
    if (size > MAX_PROMPT_CHARACTERS)
      throw new Error("The prompt exceeds LumiCache's retention limit. Reset the baseline or turn monitoring off.");
    return structuredClone(copy);
  });
  return { messages: result, size };
}
async function tailStart(messages, policy, context, count) {
  const indices = messages.flatMap((m, i) => historyMessage(m) ? [i] : []);
  if (!indices.length)
    return { index: messages.length, approximate: false };
  let index = policy.acceptableDepth === null ? indices[0] : policy.acceptableDepth === 0 ? messages.length : indices[Math.max(0, indices.length - policy.acceptableDepth)];
  let approximate = false;
  if (policy.acceptableTokens !== null) {
    if (!count)
      throw new Error("The host token counter is unavailable. Leave the token limit blank to use message depth.");
    const candidates = [...indices.filter((i) => i >= index), messages.length];
    let lo = 0, hi = candidates.length - 1;
    while (lo < hi) {
      context.signal.throwIfAborted();
      const mid = Math.floor((lo + hi) / 2);
      const result = await count(messages.slice(candidates[mid]).filter(historyMessage), context);
      approximate ||= result.approximate;
      if (!Number.isFinite(result.total_tokens) || result.total_tokens < 0)
        throw new Error("The host returned an invalid token count.");
      if (result.total_tokens <= policy.acceptableTokens)
        hi = mid;
      else
        lo = mid + 1;
    }
    index = candidates[lo];
  }
  if (index < messages.length)
    while (index > indices[0] && !historyMessage(messages[index - 1]))
      index--;
  return { index, approximate };
}
function keyed(messages) {
  const occurrences = new Map;
  return messages.filter(historyMessage).map((message) => {
    const id = identity(message);
    if (!id)
      throw new Error("Force cache consistency needs source message IDs. Disable it for a prompt whose history identity was removed by another extension.");
    const n = occurrences.get(id) ?? 0;
    occurrences.set(id, n + 1);
    return { key: `${id}:${n}`, message };
  });
}
function historyUnchanged(before, after) {
  try {
    const a = keyed(before), b = new Map(keyed(after).map((x) => [x.key, x.message]));
    return a.length > 0 && a.every((x) => b.has(x.key) && wire(x.message) === wire(b.get(x.key)));
  } catch {
    return false;
  }
}
async function preserve(before, current, policy, context, count) {
  const now = keyed(current), old = before ? keyed(before) : [];
  const oldKeys = new Set(old.map((x) => x.key));
  const maxOldIndex = old.reduce((max, x) => Math.max(max, x.message.sourceIndexInChat ?? -1), -1);
  const added = now.filter((x) => !oldKeys.has(x.key) && (!old.length || x.message.sourceIndexInChat !== undefined && x.message.sourceIndexInChat > maxOldIndex));
  if (old.length && now.some((x) => !oldKeys.has(x.key) && x.message.sourceIndexInChat === undefined))
    throw new Error("Force cache consistency cannot order new history without source indexes.");
  const ledger = before ? [...old, ...added] : now;
  const first = current.findIndex(historyMessage);
  const oldBoundary = before ? await tailStart(before, policy, context, count) : { index: 0, approximate: false };
  const prefix = before ? before.slice(0, oldBoundary.index) : first < 0 ? [...current] : current.slice(0, first);
  const frozen = new Set(keyed(prefix).map((x) => x.key));
  const tail = ledger.filter((x) => !frozen.has(x.key));
  const base = [...prefix, ...tail.map((x) => x.message)];
  const boundary = await tailStart(base, policy, context, count);
  const minimum = Math.max(prefix.length, boundary.index);
  const baseIndices = new Map(base.map((m, i) => [m, i]));
  const positions = new Map(ledger.map((x) => [x.key, baseIndices.get(x.message) ?? -1]));
  const nowKeys = new Map(now.map((x) => [x.message, x.key]));
  const injections = [];
  let relocated = 0;
  if (!(before && !added.length && oldBoundary.index === before.length)) {
    let nextKey;
    for (let i = current.length - 1;i > first && first >= 0; i--) {
      const m = current[i];
      if (historyMessage(m)) {
        nextKey = nowKeys.get(m);
        continue;
      }
      let index = nextKey ? positions.get(nextKey) ?? base.length : base.length;
      if (index < minimum) {
        index = policy.overflowPlacement === "end" ? base.length : minimum;
        relocated++;
      }
      injections.push({ message: m, index, order: i });
    }
  }
  injections.sort((a, b) => b.index - a.index || b.order - a.order);
  for (const injection of injections)
    base.splice(injection.index, 0, injection.message);
  const currentByKey = new Map(now.map((x) => [x.key, x.message]));
  const restored = before ? old.filter((x) => {
    const m = currentByKey.get(x.key);
    return !m || wire(m) !== wire(x.message);
  }).length + Number(wireList(before.slice(0, before.findIndex(historyMessage) < 0 ? before.length : before.findIndex(historyMessage))) !== wireList(current.slice(0, first < 0 ? current.length : first))) : 0;
  return { messages: base, restored, relocated, approximate: oldBoundary.approximate || boundary.approximate };
}
var wireList = (messages) => messages.map(wire).join(`
`);

// src/guard.ts
class Guard {
  onChange;
  countTokens;
  store;
  toast;
  chats = new Map;
  pending = new Map;
  candidates = new Map;
  constructor(onChange, countTokens, store, toast) {
    this.onChange = onChange;
    this.countTokens = countTokens;
    this.store = store;
    this.toast = toast;
  }
  async toastBreak(messages, check, context, tone, title, message) {
    if (!this.toast)
      return;
    const first = Math.max(0, Math.min(check.comparison.firstMessage ?? 0, messages.length - 1));
    let tokens = Math.ceil(check.after.messages.slice(first).reduce((total, message) => total + message.body.length, 0) / 4), approximate = true;
    if (this.countTokens) {
      try {
        const counted = await this.countTokens(messages.slice(first), context);
        if (Number.isFinite(counted.total_tokens)) {
          tokens = counted.total_tokens;
          approximate = counted.approximate;
        }
      } catch {}
    }
    const who = context.label ? `${context.label}: ` : "";
    try {
      this.toast(context.userId, tone, `${who}${title(messages.length - first)}`, message(`${approximate ? "~" : ""}${tokens.toLocaleString("en-US")}`));
    } catch (error) {
      console.warn("[LumiCache] Could not show the cache toast:", error);
    }
  }
  notify(user, chatId, session) {
    try {
      this.onChange(user, chatId, session);
    } catch {}
  }
  disconnect(user, session) {
    for (const pending of this.pending.values()) {
      if (pending.userId !== user || pending.session !== session)
        continue;
      pending.session = undefined;
      this.notify(user, pending.check.chatId);
    }
  }
  chatStates(user, chat) {
    return [...this.chats].filter(([key]) => {
      const [owner, id] = JSON.parse(key);
      return owner === user && id === chat;
    });
  }
  shown(user, chat) {
    const states = this.chatStates(user, chat).map(([, state]) => state);
    return states.find((state) => state.check && this.pending.has(state.check.id)) ?? states.at(-1);
  }
  resume(user, chat, session) {
    const check = this.shown(user, chat)?.check;
    const pending = check && this.pending.get(check.id);
    if (pending && pending.userId === user && !pending.session && Date.now() < pending.check.deadline)
      pending.session = session;
  }
  reserve(current, next) {
    const retained = () => {
      const snapshots = new Set;
      for (const state of this.chats.values()) {
        const check = state === current ? next : state.check;
        for (const value of [state.baseline, check?.before, check?.after])
          if (value)
            snapshots.add(value);
      }
      let size = 0;
      for (const value of snapshots)
        for (const message of value.messages)
          size += message.header.length + message.body.length;
      for (const state of this.chats.values())
        size += (state.retained?.size ?? 0) + (state.candidate?.size ?? 0);
      return size;
    };
    while (retained() > 256000000) {
      const oldest = [...this.chats].find(([, state]) => state !== current && !state.busy);
      if (!oldest)
        throw new Error("LumiCache's active prompt memory is full. Finish or stop another generation before retrying.");
      this.chats.delete(oldest[0]);
    }
  }
  key(user, chat, scope) {
    return JSON.stringify(scope ? [user, chat, scope] : [user, chat]);
  }
  state(user, chat, scope) {
    const key = this.key(user, chat, scope);
    let state = this.chats.get(key);
    if (!state) {
      if (this.chats.size >= 48) {
        const oldest = [...this.chats].find(([, value]) => !value.busy);
        if (!oldest)
          throw new Error("LumiCache is inspecting too many chats. Finish a pending generation first.");
        this.chats.delete(oldest[0]);
      }
      state = { baseline: null, check: null, busy: false, replies: 0 };
    }
    this.chats.delete(key);
    this.chats.set(key, state);
    return state;
  }
  chatIds(user) {
    return [...this.chats.keys()].map((key) => JSON.parse(key)).filter(([owner]) => owner === user).map(([, chat]) => chat).filter((chat, index, all) => all.indexOf(chat) === index);
  }
  view(user, chat, session) {
    const state = chat ? this.shown(user, chat) : undefined;
    const pending = state?.check ? this.pending.get(state.check.id) : undefined;
    return { check: state?.check ?? null, hasBaseline: !!state?.baseline, canDecide: !!pending && !!session && pending.session === session };
  }
  unwatched(user, chat) {
    const state = this.chats.get(this.key(user, chat));
    if (state && !state.busy) {
      state.baseline = null;
      state.retained = undefined;
      state.restored = false;
      state.replies = 0;
    }
  }
  forget(user, chat) {
    this.store?.clear(user, chat);
  }
  clear(user, chat) {
    const states = this.chatStates(user, chat);
    if (states.some(([, state]) => state.busy))
      throw new Error("Finish or stop this generation before clearing its baseline.");
    for (const [key] of states)
      this.chats.delete(key);
    this.store?.clear(user, chat);
    this.notify(user, chat);
  }
  decide(user, session, id, allow) {
    const pending = this.pending.get(id);
    if (!pending || !session || pending.userId !== user || pending.session !== session)
      throw new Error("This review expired or belongs to another browser session.");
    pending.settle(allow);
  }
  async inspect(messages, context, settings, epoch = null) {
    if (context.isDryRun || settings.mode === "off")
      return messages;
    context.signal.throwIfAborted();
    const state = this.state(context.userId, context.chatId, context.scope);
    if (state.busy)
      throw new Error("LumiCache is already inspecting a generation in this chat. Wait for it to finish or stop it first.");
    state.busy = true;
    let check;
    try {
      const config = validateSettings(settings);
      if (this.store && !state.restored) {
        state.restored = true;
        try {
          const saved = await this.store.load(context.userId, context.chatId, context.scope);
          if (saved && !state.baseline) {
            state.baseline = { ...snapshot(saved.messages, context), at: saved.at, route: saved.route, model: saved.model };
            state.retained = retain(saved.messages);
            state.replies = saved.replies;
            state.epoch = saved.epoch;
          }
        } catch (error) {
          console.warn("[LumiCache] Could not read the saved baseline:", error);
        }
        context.signal.throwIfAborted();
      }
      const incoming = snapshot(messages, context);
      const planned = !!state.baseline && epoch !== null && epoch !== state.epoch;
      const refresh = !!state.baseline && (epoch !== null ? epoch !== state.epoch : config.forceConsistency && config.refreshEnabled && state.replies >= config.refreshEvery);
      const routeChanged = !!state.baseline && state.baseline.route !== incoming.route;
      let policy;
      if (refresh && !routeChanged)
        policy = { action: "refresh", restored: 0, relocated: 0, replies: state.replies, approximate: false };
      else if (config.forceConsistency && !routeChanged) {
        const result = await preserve(state.retained?.messages ?? null, messages, config, context, this.countTokens);
        messages = result.messages;
        policy = { action: state.retained ? "preserved" : "seed", restored: result.restored, relocated: result.relocated, replies: state.replies, approximate: result.approximate };
      }
      context.signal.throwIfAborted();
      const after = snapshot(messages, context);
      check = {
        id: crypto.randomUUID(),
        chatId: context.chatId,
        generationId: context.generationId,
        deadline: Math.min(Date.now() + 290000, context.interceptorDeadlineAt - 1000),
        status: "allowed",
        comparison: compare(state.baseline, after),
        before: state.baseline,
        after,
        policy
      };
      if (context.label)
        check.comparison.summary = `${context.label}: ${check.comparison.summary}`;
      let tolerated = false;
      if (check.comparison.kind === "break" && !routeChanged && state.retained && historyUnchanged(state.retained.messages, messages)) {
        const boundary = await tailStart(state.retained.messages, config, context, this.countTokens);
        tolerated = check.comparison.firstMessage !== null && check.comparison.firstMessage >= boundary.index;
        if (tolerated && !policy)
          check.policy = { action: "tolerated", restored: 0, relocated: 0, replies: state.replies, approximate: boundary.approximate };
      }
      if (state.baseline) {
        try {
          check.timeline = buildTimeline(state.baseline, promptOutline(state.baseline, state.retained?.messages ?? [], []), after, promptOutline(after, messages, []), check.comparison, tolerated);
        } catch (error) {
          console.warn("[LumiCache] Could not build the live timeline:", error);
        }
      }
      const retained = retain(messages);
      state.candidate = retained;
      if (check.policy)
        check.policy.accepted = tolerated || refresh && !routeChanged || check.comparison.kind !== "break";
      this.reserve(state, check);
      state.check = check;
      const alarming = check.comparison.kind === "break" && !tolerated && !(refresh && !routeChanged);
      if (alarming && settings.mode === "pause") {
        check.status = "waiting";
        const review = check;
        await new Promise((resolve, reject) => {
          const settle = (allow, reason) => {
            clearTimeout(timer);
            context.signal.removeEventListener("abort", abort);
            this.pending.delete(review.id);
            if (allow && !context.signal.aborted && Date.now() < review.deadline)
              resolve();
            else
              reject(new Error(reason ?? "LumiCache cancelled this request before sending."));
          };
          const abort = () => settle(false, "Generation stopped while reviewing the prompt.");
          const timer = setTimeout(() => settle(false, "LumiCache review expired. Retry sending to review it again."), Math.max(0, review.deadline - Date.now()));
          this.pending.set(review.id, { userId: context.userId, session: context.frontendSessionId, check: review, settle });
          context.signal.addEventListener("abort", abort, { once: true });
          if (context.signal.aborted)
            abort();
          else
            this.notify(context.userId, context.chatId, context.frontendSessionId);
        });
      }
      context.signal.throwIfAborted();
      check.status = "allowed";
      if (alarming && settings.mode === "warn")
        this.toastBreak(messages, check, context, "warning", (depth) => `Cache has been broken at depth ${depth}!`, (tokens) => `${tokens} tokens will be recached \uD83D\uDCB8.`);
      else if (planned && check.comparison.kind === "break" && !routeChanged)
        this.toastBreak(messages, check, context, "success", () => "LumiBooks Compaction Successful.", (tokens) => `Gracefully re-caching ${tokens} tokens \uD83D\uDC96.`);
      this.candidates.set(this.key(context.userId, context.generationId), { key: this.key(context.userId, context.chatId, context.scope), userId: context.userId, check, retained, refresh, epoch, connection: context.mainDispatch.descriptor?.connectionId });
      this.notify(context.userId, context.chatId, context.frontendSessionId);
      return messages;
    } catch (error) {
      if (check) {
        this.pending.get(check.id)?.settle(false);
        check.status = "cancelled";
      }
      state.busy = false;
      state.candidate = undefined;
      this.notify(context.userId, context.chatId, context.frontendSessionId);
      throw error;
    }
  }
  prompt(user, chat) {
    const state = this.chats.get(this.key(user, chat));
    return state?.baseline && state.retained && state.connection ? { messages: state.retained.messages, connectionId: state.connection, model: state.baseline.model } : null;
  }
  finish(user, generation, success, replyId) {
    const key = this.key(user, generation), candidate = this.candidates.get(key);
    if (!candidate)
      return false;
    this.candidates.delete(key);
    const state = this.chats.get(candidate.key);
    if (!state || state.check !== candidate.check)
      return false;
    state.busy = false;
    candidate.check.status = success ? "completed" : "failed";
    state.candidate = undefined;
    if (success) {
      state.baseline = candidate.check.after;
      state.retained = candidate.retained;
      state.replies = candidate.refresh ? 1 : state.replies + 1;
      state.epoch = candidate.epoch;
      state.connection = candidate.connection;
      const [, chat, scope] = JSON.parse(candidate.key), after = candidate.check.after;
      this.store?.save(user, chat, scope, { at: after.at, route: after.route, model: after.model, messages: candidate.retained.messages, replies: state.replies, epoch: state.epoch }, replyId);
    }
    this.notify(user, candidate.check.chatId);
    return success;
  }
}

// src/host-context.ts
async function connectionDispatch(api, connectionId, userId, model) {
  const connection = connectionId ? await api.connections.get(connectionId, userId) : (await api.connections.list(userId)).find((connection) => connection.is_default);
  if (!connection)
    throw new Error("LumiCache could not inspect the selected connection.");
  let origin = "Provider default endpoint";
  if (connection.api_url) {
    try {
      origin = new URL(connection.api_url).origin;
    } catch {
      throw new Error("LumiCache could not read the selected connection endpoint.");
    }
  }
  const revision = `${connection.id}:${connection.updated_at}`;
  return { descriptor: { connectionId: connection.id, provider: connection.provider, model, endpointOrigin: origin, connectionDispatchRevision: revision }, connectionDispatchRevision: revision, dispatchKind: "concrete" };
}

class HostContexts {
  active = new Map;
  key(user, chat) {
    return JSON.stringify([user, chat]);
  }
  start(user, event) {
    this.active.set(this.key(user, event.chatId), event);
  }
  isActive(user, chat) {
    return this.active.has(this.key(user, chat));
  }
  finish(user, event) {
    const key = this.key(user, event.chatId);
    if (this.active.get(key)?.generationId === event.generationId)
      this.active.delete(key);
  }
  async resolve(raw, api) {
    const started = this.active.get(this.key(raw.userId, raw.chatId));
    if (!started || raw.generationId && raw.generationId !== started.generationId)
      throw new Error("LumiCache could not match this prompt to its live generation. Stop and retry the request.");
    const dispatch = raw.mainDispatch ?? await connectionDispatch(api, raw.connectionId, raw.userId, started.model);
    raw.signal.throwIfAborted();
    if (this.active.get(this.key(raw.userId, raw.chatId)) !== started)
      throw new Error("The generation ended while LumiCache was preparing its check.");
    return {
      userId: raw.userId,
      chatId: raw.chatId,
      generationId: started.generationId,
      frontendSessionId: raw.frontendSessionId ?? started.frontendSessionId,
      isDryRun: raw.isDryRun === true || raw.dryRun === true,
      signal: raw.signal,
      interceptorDeadlineAt: raw.interceptorDeadlineAt ?? Date.now() + 295000,
      mainDispatch: dispatch
    };
  }
}

// src/health/service.ts
import { createHash as createHash5 } from "crypto";

// src/health/depth.ts
async function classifyDepth(report, settings, messages, api, userId) {
  const policy = validateSettings(settings);
  const history = messages.filter((m) => m.__isChatHistory || m.__chatHistorySource === true);
  const counts = new Map;
  for (const finding of report.findings) {
    if (finding.level !== "depth")
      continue;
    const depth = finding.depth ?? 0;
    finding.problematic = policy.acceptableDepth !== null && depth > policy.acceptableDepth;
    if (policy.acceptableTokens !== null) {
      if (!counts.has(depth) && (history.length || depth === 0) && api) {
        const value = depth === 0 ? { total_tokens: 0, approximate: false } : await api.tokens.countMessages(history.slice(-depth), { model: report.model, userId });
        counts.set(depth, value);
      }
      const result = counts.get(depth);
      if (result) {
        finding.depthTokens = result.total_tokens;
        finding.tokenEstimate = result.approximate;
      }
      finding.problematic ||= !result || result.total_tokens > policy.acceptableTokens;
      finding.detail = result ? `${depth} history messages \xB7 ${result.approximate ? "approximately " : ""}${result.total_tokens.toLocaleString()} tokens behind this position.` : "The host did not expose enough history placement data to verify this token limit.";
    }
    finding.suggestion = finding.problematic ? "Outside your allowed tail. Force consistency can move it to the end or the allowed boundary." : "Within your configured tolerance. This is not a guarantee of a provider cache hit.";
  }
  return report;
}

// src/health/macro-syntax.ts
class ScanLimit extends Error {
  constructor() {
    super("Macro analysis exceeded its work or nesting limit.");
  }
}
var MAX_NODES = 1e5;
var MAX_DEPTH = 512;
function parseMacros(source) {
  let at = 0, count = 0;
  const push = (list, text) => {
    if (text)
      list.push({ type: "text", value: text });
  };
  const sequence = (depth, mode) => {
    if (depth > MAX_DEPTH)
      throw new ScanLimit;
    const nodes = [];
    let start = at;
    while (at < source.length) {
      if (mode !== "document" && (source.startsWith("}}", at) || source.startsWith("::", at) || mode === "word" && /[ \t]/.test(source[at])))
        break;
      if (source[at] === "\\" && /[{}]/.test(source[at + 1] ?? "")) {
        push(nodes, source.slice(start, at));
        push(nodes, source[at + 1] === "{" ? "\x01" : "\x02");
        at += 2;
        start = at;
        continue;
      }
      if (source.startsWith("{{", at)) {
        push(nodes, source.slice(start, at));
        nodes.push(call(depth + 1));
        start = at;
      } else
        at++;
    }
    push(nodes, source.slice(start, at));
    return pair(nodes, depth);
  };
  const call = (depth) => {
    if (++count > MAX_NODES || depth > MAX_DEPTH)
      throw new ScanLimit;
    const start = at;
    at += 2;
    const skip = () => {
      while (/[ \t]/.test(source[at] ?? ""))
        at++;
    };
    skip();
    let flags = "", name = "";
    const args = [];
    if (source.startsWith("//", at)) {
      const end = source.indexOf("}}", at + 2);
      at = end < 0 ? source.length : end + 2;
      return { type: "call", name: "comment", flags: "", args: [], start, end: at, literal: source.slice(start, Math.min(at, start + 180)) };
    }
    while (/[!?~>#/]/.test(source[at] ?? ""))
      flags += source[at++];
    skip();
    const shorthand = /[.$@]/.test(source[at] ?? "") ? source[at++] : "";
    const idStart = at;
    while (/[\w-]/.test(source[at] ?? "") && !(shorthand && (source.startsWith("--", at) || source.startsWith("-=", at))))
      at++;
    name = source.slice(idStart, at).toLowerCase();
    skip();
    if (shorthand) {
      const key = name, scope = shorthand === "$" ? "gvar" : shorthand === "@" ? "chatvar" : "var";
      const op = ["++", "--", "+=", "-=", "||", "??", "==", "!=", ">=", "<=", "=", ">", "<"].find((op) => source.startsWith(op, at)) ?? "";
      at += op.length;
      skip();
      name = (op === "=" ? "set" : op === "++" ? "inc" : op === "--" ? "dec" : op === "+=" || op === "-=" ? "add" : "get") + scope;
      args.push([{ type: "text", value: key }]);
      if (op && op !== "++" && op !== "--") {
        const value = sequence(depth, "argument");
        if (op === "-=")
          value.unshift({ type: "text", value: "-" });
        args.push(value);
      }
    } else {
      while (at < source.length && !source.startsWith("}}", at)) {
        if (source[at] === ":") {
          at += source.startsWith("::", at) ? 2 : 1;
          args.push(sequence(depth, "argument"));
        } else {
          skip();
          if (source.startsWith("}}", at) || at >= source.length)
            break;
          const word = sequence(depth, "word");
          if (word.length === 1 && word[0].type === "text" && /^[.$@][a-z][\w-]*$/i.test(word[0].value)) {
            const text = word[0].value;
            word[0] = { type: "call", name: text[0] === "$" ? "getgvar" : text[0] === "@" ? "getchatvar" : "getvar", flags: "", args: [[{ type: "text", value: text.slice(1) }]], start, end: at, literal: text };
          }
          args.push(word);
        }
      }
    }
    if (source.startsWith("}}", at))
      at += 2;
    return { type: "call", name, flags, args, start, end: at, literal: source.slice(start, Math.min(at, start + 180)) + (at - start > 180 ? "\u2026" : "") };
  };
  const pair = (nodes, depth) => {
    const stacks = new Map, ends = new Map;
    for (let i = 0;i < nodes.length; i++) {
      const node = nodes[i];
      if (node.type !== "call")
        continue;
      let stack = stacks.get(node.name);
      if (!stack)
        stacks.set(node.name, stack = []);
      if (node.flags.includes("/")) {
        const open = stack.pop();
        if (open !== undefined)
          ends.set(open, i);
      } else
        stack.push(i);
    }
    const range = (from, to, nesting) => {
      if (nesting > MAX_DEPTH)
        throw new ScanLimit;
      const result = [];
      for (let i = from;i < to; i++) {
        const node = nodes[i];
        if (node.type === "call" && node.flags.includes("/"))
          continue;
        const end = ends.get(i);
        if (node.type === "call" && end !== undefined && end < to) {
          result.push({ ...node, body: range(i + 1, end, nesting + 1), bodyLiteral: source.slice(node.end, nodes[end].start) });
          i = end;
        } else
          result.push(node);
      }
      return result;
    };
    return range(0, nodes.length, depth);
  };
  return sequence(0, "document");
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
var PEEKS = {
  hasvar: "var",
  varexists: "var",
  haspromptvar: "var",
  haspresetvar: "var",
  vardefault: "var",
  promptvardefault: "var",
  presetvardefault: "var",
  getvarkey: "var",
  getvarindex: "var",
  hasvarkey: "var",
  hasgvar: "gvar",
  hasglobalvar: "gvar",
  gvarexists: "gvar",
  getgvarkey: "gvar",
  getglobalvarkey: "gvar",
  getglobalvarindex: "gvar",
  hasgvarkey: "gvar",
  hasglobalvarkey: "gvar",
  haschatvar: "chatvar",
  getchatvarkey: "chatvar",
  haschatvarkey: "chatvar"
};
var KEY_WRITES = {
  setvarkey: "var",
  setvarindex: "var",
  addvarkey: "var",
  deletevarkey: "var",
  setgvarkey: "gvar",
  setglobalvarkey: "gvar",
  setglobalvarindex: "gvar",
  addgvarkey: "gvar",
  addglobalvarkey: "gvar",
  deletegvarkey: "gvar",
  deleteglobalvarkey: "gvar",
  setchatvarkey: "chatvar",
  addchatvarkey: "chatvar",
  deletechatvarkey: "chatvar"
};
var DELETES = { deletevar: "var", flushvar: "var", deletegvar: "gvar", flushgvar: "gvar", flushglobalvar: "gvar", deleteglobalvar: "gvar", deletechatvar: "chatvar", flushchatvar: "chatvar" };

// src/health/macro-analysis.ts
var TRANSPARENT = new Set(["upper", "lower", "capitalize", "trim", "reverse"]);
var ALIASES = { where: "filter", any: "some", all: "every", for_each_message: "foreachmessage", for_each_var: "foreachvar", for_each_chat_var: "foreachchatvar", foreachgvar: "foreachglobalvar", for_each_global_var: "foreachglobalvar", var: "getvar", promptvar: "getvar", presetvar: "getvar", uppercase: "upper", toupper: "upper", lowercase: "lower", tolower: "lower", titlecase: "capitalize", getglobalvar: "getgvar", setglobalvar: "setgvar", incglobalvar: "incgvar", decglobalvar: "decgvar", addglobalvar: "addgvar", withvar: "let", scope: "let", elif: "elseif", fallback: "default", coalesce: "default", each: "foreach", for_each: "foreach", collect: "map", random_tag: "randomtag", randomchartag: "randomtag" };
var empty = () => ({ text: "", effects: [] });
var unique = (effects) => {
  const values = new Map;
  for (const effect of effects) {
    const key = `${effect.kind}:${effect.literal}`;
    if (values.get(key)?.level !== "issue")
      values.set(key, effect);
  }
  const retained = new Map;
  return [...values.values()].filter((value) => {
    const key = `${value.kind}:${value.level}`, count = retained.get(key) ?? 0;
    retained.set(key, count + 1);
    return count < 6;
  });
};
var uncertain = (effects, reason) => effects.map((effect) => effect.kind === "variable" ? effect : { ...effect, level: "risk", reason });
var combine = (values, separator = "") => {
  const length = values.reduce((sum, value) => sum + (value.text?.length ?? 0) + separator.length, 0);
  if (length > 32000000)
    throw new ScanLimit;
  return { text: values.every((value) => value.text !== undefined) ? values.map((value) => value.text).join(separator) : undefined, effects: unique(values.flatMap((value) => value.effects)), possible: values.length === 1 ? values[0].possible : undefined };
};
var list = (text, delimiter = ",") => (delimiter ? text.split(delimiter) : [text]).map((value) => value.trim()).filter(Boolean);
function truth(text) {
  if (text === undefined || /(^|\s)[.$@][a-z]/i.test(text))
    return;
  let value = text.trim(), negate = false;
  if (value.startsWith("!")) {
    negate = true;
    value = value.slice(1).trim();
  }
  const comparison = /^(.*?)(==|!=|>=|<=|>|<)(.*)$/s.exec(value);
  let result;
  if (comparison) {
    const left = comparison[1].trim(), right = comparison[3].trim(), a = parseFloat(left), b = parseFloat(right), numeric = !Number.isNaN(a) && !Number.isNaN(b);
    const x = numeric ? a : left, y = numeric ? b : right;
    result = comparison[2] === "==" ? x === y : comparison[2] === "!=" ? x !== y : comparison[2] === ">" ? x > y : comparison[2] === "<" ? x < y : comparison[2] === ">=" ? x >= y : x <= y;
  } else
    result = !["", "0", "false", "null", "undefined", "no", "off"].includes(value.toLowerCase());
  return negate ? !result : result;
}
function scanMacros(text, options = {}) {
  if (!text.includes("{{"))
    return { effects: [], calls: [], writes: [], sets: [] };
  const variables = new Map(Object.entries(options.variables ?? {}).map(([key, value]) => [key, { text: value, effects: [] }]));
  const calls = [], writes = [], sets = [], reads = [], controls = [], sideEffects = [], expanding = new Set;
  let work = 0, unresolved = 0, fixed = 0;
  const stored = new Map;
  const mark = (node, kind, level, reason) => ({ name: node.name, literal: node.literal, kind, level, reason });
  const settled = (id) => {
    const value = variables.get(id);
    return !!value && (!!value.assigned || !Object.hasOwn(options.variables ?? {}, id));
  };
  const read = (id) => {
    if (settled(id))
      reads.push(...variables.get(id)?.reads ?? []);
    else
      reads.push(id);
  };
  const explain = (ids) => ids.slice(0, 2).map((id) => {
    const key = id.slice(id.indexOf(":") + 1), writer = options.writers?.[id], stored = options.variables?.[id], setting = id.startsWith("var:") ? options.settings?.[key] : undefined;
    if (id.startsWith("flag:"))
      return `{{${key}}} only changes if you change this chat or your setup.`;
    if (setting !== undefined && !writer?.length)
      return `"${key}" is a preset setting, currently "${setting.length > 40 ? `${setting.slice(0, 40)}\u2026` : setting}".`;
    if (writer?.length)
      return `"${key}" is set by ${writer.slice(0, 2).join(" and ")}.`;
    if (stored !== undefined)
      return `"${key}" is currently "${stored.length > 40 ? `${stored.slice(0, 40)}\u2026` : stored}".`;
    return `Nothing LumiCache can see sets "${key}", so it changes only if you or an extension change it.`;
  }).join(" ");
  const restore = (saved) => {
    variables.clear();
    for (const [key, entry] of saved)
      variables.set(key, entry);
  };
  const walk = (nodes, depth = 0, potential = false) => {
    if (depth > 512 || (work += nodes.length) > 1e5)
      throw new ScanLimit;
    return combine(nodes.map((node) => node.type === "text" ? { text: options.unknownCaptures && /\$(?:\d|&|<|`|')/.test(node.value) ? undefined : node.value, effects: [] } : evaluate(node, depth + 1, potential)));
  };
  const expand = (key, value, depth, potential) => {
    if (!value.text?.includes("{{"))
      return value;
    if (expanding.has(key))
      return { effects: [...value.effects, { name: key, literal: `{{${key}}}`, kind: "opaque", level: "risk", reason: "Recursive macro reference." }] };
    expanding.add(key);
    try {
      const result = walk(parseMacros(value.text), depth + 1, potential);
      return { ...result, effects: unique([...value.effects, ...result.effects]) };
    } finally {
      expanding.delete(key);
    }
  };
  const branch = (nodes, depth, potential) => {
    const saved = new Map(variables), value = walk(nodes, depth, potential);
    if (potential)
      restore(saved);
    return value;
  };
  const evaluate = (node, depth, potential) => {
    const name = Object.hasOwn(ALIASES, node.name) ? ALIASES[node.name] : node.name, level = potential ? "risk" : "issue";
    const countOnly = ["loomstyle", "loomutils", "loomretrofits"].includes(name) && node.args[0]?.length === 1 && node.args[0][0].type === "text" && node.args[0][0].value === "len";
    if (!countOnly && !calls.some((call) => call.name === name && call.level === level)) {
      if (calls.length >= 5000)
        throw new ScanLimit;
      calls.push({ name, literal: node.literal, level });
    }
    if (name === "escape")
      return { text: (node.bodyLiteral ?? "").replaceAll("{", "\x01").replaceAll("}", "\x02"), effects: [] };
    const arg = (index, maybe = potential) => walk(node.args[index] ?? [], depth, maybe);
    const unknownBranch = (value) => ({ ...value, effects: uncertain(value.effects, `Execution depends on ${node.literal}`) });
    if (name === "if" || name === "unless") {
      const readsBefore = reads.length, unresolvedBefore = unresolved, fixedBefore = fixed, condition = combine(node.args.map((_, i) => arg(i)), " ");
      for (const [, scope, key] of (condition.text ?? "").matchAll(/(?:^|[\s!])([.$@])([a-zA-Z][\w-]*)/g)) {
        const taint = options.changing?.[`${scope === "$" ? "gvar" : scope === "@" ? "chatvar" : "var"}:${key}`];
        if (taint)
          condition.effects = unique([...condition.effects, mark(node, taint.kind, potential ? "risk" : taint.level, taint.reason)]);
        else
          read(`${scope === "$" ? "gvar" : scope === "@" ? "chatvar" : "var"}:${key}`);
      }
      const choice = truth(condition.text), gate = reads.slice(readsBefore), moving = condition.effects.filter((effect) => effect.kind !== "variable"), later = [];
      let unknownGate = unresolved > unresolvedBefore, stableGate = fixed > fixedBefore;
      if (!node.body)
        return { text: choice === undefined ? undefined : (name === "unless" ? !choice : choice) ? "true" : "", effects: condition.effects };
      const branches = [{ condition: node.args, nodes: [] }];
      for (const child of node.body) {
        if (child.type === "call" && !child.body && ["else", "elseif", "elif"].includes(child.name))
          branches.push({ condition: child.name === "else" ? undefined : child.args, nodes: [] });
        else
          branches.at(-1).nodes.push(child);
      }
      let possible = false;
      const values = [];
      controls.push(moving);
      for (let i = 0;i < branches.length; i++) {
        const testReads = reads.length, testUnresolved = unresolved, testFixed = fixed;
        const part = branches[i], test = i === 0 ? condition : part.condition ? combine(part.condition.map((nodes) => walk(nodes, depth, potential || possible)), " ") : { text: "true", effects: [] };
        if (i > 0) {
          gate.push(...reads.slice(testReads));
          unknownGate ||= unresolved > testUnresolved;
          stableGate ||= fixed > testFixed;
          later.push(...test.effects);
          moving.push(...test.effects.filter((effect) => effect.kind !== "variable"));
        }
        let yes = truth(test.text);
        if (i === 0 && name === "unless" && yes !== undefined)
          yes = !yes;
        if (yes === false)
          continue;
        const value = branch(part.nodes, depth, potential || possible || yes === undefined);
        values.push(possible || yes === undefined ? unknownBranch(value) : value);
        if (yes === true)
          break;
        possible = true;
      }
      controls.pop();
      const result = combine(values);
      if (choice === undefined && branches.some((part) => !part.condition) && values.length && values.every((value) => value.text !== undefined && value.text === values[0].text))
        return { text: values[0].text, effects: result.effects };
      const checked = [...new Set(gate)], settledBranches = !result.effects.some((effect) => effect.kind !== "variable");
      const differs = choice === undefined ? values.some((value) => value.text === undefined) || values.length === 1 && values[0].text !== "" || new Set(values.map((value) => value.text)).size > 1 : branches.length > 1 || branches[0].nodes.length > 0;
      if (!moving.length && checked.length && !unknownGate && differs && settledBranches)
        result.effects.push(mark(node, "variable", "variabled", explain(checked)));
      else if ((unknownGate || !checked.length && !stableGate) && choice === undefined && !moving.length && settledBranches && differs)
        result.effects.push(mark(node, "condition", "risk", "The selected branch depends on a runtime value."));
      const texts = values.map((value) => value.text), picks = texts.every((value) => value !== undefined) && (branches.some((part) => !part.condition) ? new Set(texts).size > 1 : texts.some((value) => value !== ""));
      const control = [...condition.effects, ...later].map((effect) => picks && effect.level === "issue" ? { ...effect, reason: effect.reason ?? "This conditional checks a value that can change, so the text it picks can change." } : uncertain([effect], "A changing value controls this conditional; its effect depends on the selected branch.")[0]);
      return { text: possible ? undefined : result.text, effects: unique([...control, ...result.effects]) };
    }
    if (name === "switch") {
      const readsBefore = reads.length, unresolvedBefore = unresolved, fixedBefore = fixed, selected = arg(0), candidates = [], checked = [...new Set(reads.slice(readsBefore))], unknownGate = unresolved > unresolvedBefore, stableGate = fixed > fixedBefore;
      if (node.body) {
        for (const child of node.body)
          if (child.type === "call" && child.body && (child.name === "case" || child.name === "default"))
            candidates.push({ match: child.name === "case" ? child.args[0] ?? [] : undefined, output: child.body });
      } else
        for (let i = 1;i < node.args.length; i += 2)
          candidates.push(i + 1 < node.args.length ? { match: node.args[i], output: node.args[i + 1] } : { output: node.args[i] });
      let maybe = false;
      const outcomes = [];
      for (const candidate of candidates) {
        const match = candidate.match ? walk(candidate.match, depth, potential || maybe) : undefined, known = !match || selected.text !== undefined && match.text !== undefined;
        if (known && match && match.text.trim() !== selected.text.trim())
          continue;
        outcomes.push(branch(candidate.output, depth, potential || maybe || !known));
        if (known)
          break;
        maybe = true;
      }
      const value = combine(outcomes), calm = candidates.length > 1 && ![...selected.effects, ...value.effects].some((effect) => effect.kind !== "variable");
      const own = !calm ? [] : checked.length && !unknownGate ? [mark(node, "variable", "variabled", explain(checked))] : selected.text === undefined && (unknownGate || !stableGate) ? [mark(node, "condition", "risk", "The selected branch depends on a runtime value.")] : [];
      return { text: maybe ? undefined : value.text, effects: unique([...selected.effects, ...value.effects, ...own]) };
    }
    if (["and", "or", "default"].includes(name)) {
      if (name === "default" && node.body && !node.args.length)
        return walk(node.body, depth, potential);
      const values = [];
      let maybe = potential;
      for (let i = 0;i < node.args.length; i++) {
        const value = arg(i, maybe);
        values.push(value);
        const yes = truth(value.text);
        if (name === "default" && yes === true && !maybe)
          return value;
        if (name === "and" && yes === false)
          return empty();
        if (name === "or" && yes === true)
          return { text: "true", effects: [] };
        if (yes === undefined)
          maybe = true;
      }
      return { text: maybe ? undefined : name === "and" && values.length ? "true" : name === "default" ? values.at(-1)?.text ?? "" : "", effects: combine(values).effects };
    }
    if (name === "let") {
      const saved = new Map(variables);
      for (let i = 0;i + 1 < node.args.length; i += 2) {
        const key = arg(i).text, before = reads.length, value = arg(i + 1);
        if (key !== undefined)
          variables.set(`var:${key.trim()}`, { ...value, reads: reads.slice(before) });
      }
      const value = walk(node.body ?? [], depth, potential);
      restore(saved);
      return value;
    }
    if (["foreach", "map", "filter", "some", "every", "find", "foreachmessage", "foreachvar", "foreachchatvar", "foreachglobalvar"].includes(name)) {
      const itemsBefore = reads.length, items = arg(0), origins = reads.slice(itemsBefore), delimiter = node.args[2] ? arg(2).text : ",";
      if (items.text !== undefined && delimiter !== undefined && ["foreach", "map", "filter", "some", "every", "find"].includes(name)) {
        const values = list(items.text, delimiter);
        if (!values.length)
          return empty();
        const saved = new Map(variables), key = arg(1).text || "item", results = [];
        for (const [index, value] of values.slice(0, 1000).entries()) {
          variables.set(`var:${key}`, { text: value, effects: [], reads: origins });
          variables.set(`var:${key}_index`, { text: String(index), effects: [], reads: origins });
          results.push(walk(node.body ?? [], depth, potential || !["foreach", "map"].includes(name)));
        }
        restore(saved);
        const result = combine(results);
        return { ...result, effects: unique([...items.effects, ...result.effects]) };
      }
      const saved = new Map(variables), key = arg(1).text || "item";
      for (const bound of [key, `${key}_index`])
        variables.set(`var:${bound}`, { effects: [], reads: origins });
      const body = walk(node.body ?? [], depth, true);
      restore(saved);
      return { effects: unique([...items.effects, ...body.effects, ...name === "foreachmessage" ? [mark(node, "turn", level)] : []]) };
    }
    if (Object.hasOwn(PEEKS, name)) {
      const key = arg(0).text?.trim(), id = `${PEEKS[name]}:${key}`, taint = options.changing?.[id];
      if (taint && !variables.get(id)?.assigned)
        return { effects: [mark(node, taint.kind, potential ? "risk" : taint.level, taint.reason)] };
      if (key !== undefined)
        read(id);
      return { effects: [] };
    }
    if (Object.hasOwn(DELETES, name) || Object.hasOwn(KEY_WRITES, name) || name === "counter" || name === "toggle") {
      const scope = name === "counter" || name === "toggle" ? "var" : DELETES[name] ?? KEY_WRITES[name], clear = Object.hasOwn(DELETES, name);
      const key = arg(0).text?.trim(), id = `${scope}:${key}`, value = combine(node.args.slice(1).map((_, i) => arg(i + 1)));
      sideEffects.push(...uncertain(value.effects, "The computed value is stored in a variable; later prompt use determines its effect."));
      if (key === undefined)
        return empty();
      variables.set(id, clear ? { text: "", effects: [], assigned: !potential } : { effects: [] });
      if (name === "counter" || name === "toggle") {
        writes.push({ id, kind: "state", level: "risk" });
        return { effects: [mark(node, "state", "risk", "This changes a variable each time it runs and emits the new value.")] };
      }
      const changing = [...value.effects, ...controls.flat()].find((effect) => !["opaque", "condition", "variable"].includes(effect.kind));
      if (changing)
        writes.push({ id, kind: changing.kind, level: changing.level === "issue" ? "issue" : "risk" });
      else
        sets.push({ id, value: clear ? "" : undefined });
      return empty();
    }
    const getter = /^(get|set|add|inc|dec)(var|gvar|chatvar)$/.exec(name);
    if (getter) {
      const key = arg(0).text?.trim(), id = `${getter[2]}:${key}`, previous = variables.get(id);
      const taint = getter[1] === "get" && !previous?.assigned ? options.changing?.[id] : undefined;
      if (taint)
        return { effects: [mark(node, taint.kind, potential ? "risk" : taint.level, taint.reason)] };
      if (getter[1] === "get" && key !== undefined)
        read(id);
      if (getter[1] === "get" && node.args.length > 1)
        return { effects: [] };
      if (getter[1] === "get") {
        if (key === undefined)
          return { effects: [] };
        const output = expand(id, previous ?? { effects: [] }, depth, potential), possible = [...stored.get(id) ?? [], ...options.written?.[id] ?? []];
        return output.text === undefined && possible.length ? { ...output, possible } : output;
      }
      const setReads = reads.length, value = node.body ? walk(node.body, depth, potential) : arg(1);
      if (getter[1] === "set") {
        if (key !== undefined)
          variables.set(id, { ...value, assigned: !potential, reads: reads.slice(setReads) });
        if (key !== undefined && value.text !== undefined)
          stored.set(id, [...stored.get(id) ?? [], value.text]);
        const changing = [...value.effects, ...controls.flat()].sort((a, b) => Number(b.level === "issue") - Number(a.level === "issue")).find((effect) => !["opaque", "condition", "variable"].includes(effect.kind));
        if (key !== undefined && changing)
          writes.push({ id, kind: changing.kind, level: changing.level === "issue" ? "issue" : "risk" });
        else if (key !== undefined)
          sets.push({ id, value: value.text });
        sideEffects.push(...uncertain(value.effects, "The computed value is stored in a variable; later prompt use determines its effect."));
        return empty();
      }
      const amount = getter[1] === "inc" ? 1 : getter[1] === "dec" ? -1 : value.text !== undefined ? parseFloat(value.text) || 0 : undefined;
      const fixed = previous?.assigned === true && previous.text !== undefined && amount !== undefined;
      const result = { assigned: fixed, text: fixed ? String((parseFloat(previous.text) || 0) + amount) : undefined, effects: unique([...previous?.effects ?? [], ...value.effects]) };
      if (!fixed && amount !== 0) {
        result.effects.push(mark(node, "state", getter[2] === "var" ? "risk" : level, "This operation changes a variable and emits its new value."));
        if (key !== undefined)
          writes.push({ id, kind: "state", level: getter[2] === "var" ? "risk" : level });
      }
      sideEffects.push(...uncertain(result.effects, "This operation changes a variable; later prompt use determines its effect."));
      if (key !== undefined)
        variables.set(id, result);
      return result;
    }
    if (ROOM_TURN.has(name))
      return options.room === false ? { text: "", effects: [] } : { effects: [mark(node, "turn", "risk", "This follows whichever player is taking the turn.")] };
    if (FOCUS.has(name))
      return options.cardMode === "solo" ? { text: "", effects: [] } : { effects: [mark(node, "turn", "risk", "This follows whichever character is taking the turn.")] };
    if (options.cardMode === "swap" && CARD.has(name))
      return { effects: [mark(node, "turn", "risk", "This group chat swaps character cards, so this follows whichever character is focused.")] };
    if (options.references && Object.hasOwn(options.references, name))
      return expand(`reference:${name}`, { text: options.references[name], effects: [] }, depth, potential);
    if (options.constants && Object.hasOwn(options.constants, name))
      return { text: options.constants[name], effects: [] };
    if (SETTINGS.has(name)) {
      reads.push(`flag:${node.literal.replace(/^\{\{\W*|\W*\}\}$/g, "").split("::")[0]}`);
      return { effects: [] };
    }
    const hidden = ["comment", "note", "noop", "case", "elseif", "else"].includes(name), callsBefore = calls.length, argReads = reads.length;
    const known = PURE.has(name) || TRANSPARENT.has(name) || CLOCK.has(name) || TURN.has(name) || ["random", "pick", "roll", "shuffle", "randomtag", "randomlumia", "datetimeformat", "timediff", "time_diff", "eq", "ne", "not"].includes(name);
    const args = node.args.map((_, i) => arg(i, potential || !known)), body = node.body ? walk(node.body, depth, potential || !known) : undefined;
    const input = combine([...args, ...body ? [body] : []]);
    if (hidden) {
      calls.splice(callsBefore);
      return empty();
    }
    if (["presetblock", "pblock"].includes(name) || ["regexinstalled", "regex_installed", "hasregex", "has_regex"].includes(name) && (node.body || node.args.length > 1))
      return { effects: [...input.effects, mark(node, "opaque", "risk", "This macro invokes content or a rule whose output is not available in this source. Inspect the assembled diff.")] };
    if (FIXED.has(name)) {
      fixed++;
      return { effects: input.effects };
    }
    const fetched = RETRIEVED.get(name);
    if (fetched)
      return { effects: [...input.effects, mark(node, "turn", "risk", fetched)] };
    if (name === "messageat" || name === "message_at" || name === "msgat") {
      const index = args[0]?.text?.trim();
      if (index !== undefined && /^\d+$/.test(index)) {
        fixed++;
        return { effects: input.effects };
      }
      if (index === undefined)
        return { effects: [...input.effects, mark(node, "turn", "risk")] };
      return { effects: [...input.effects, mark(node, "turn", level)] };
    }
    if (CLOCK.has(name) || name.startsWith("time_utc"))
      return { effects: [...input.effects, mark(node, "clock", level)] };
    if (TURN.has(name))
      return { effects: [...input.effects, mark(node, "turn", level)] };
    if (["random", "pick", "roll", "shuffle", "randomtag"].includes(name)) {
      const texts = args.map((value) => value.text);
      let variable, fixed;
      if (name === "roll") {
        if (!args.length || texts[0] === "")
          variable = true;
        else if (texts[0] !== undefined) {
          const dice = /^(\d+)d(\d+)$/i.exec(texts[0]);
          variable = !!dice && Number(dice[1]) > 0 && Number(dice[2]) > 1 && Number.isFinite(Number(dice[2]));
          if (!variable)
            fixed = dice && Number(dice[2]) === 1 ? String(Math.min(100, Number(dice[1]))) : "0";
        }
      } else if (name === "randomtag") {
        variable = options.characterTags ? new Set(options.characterTags.map((value) => value.trim()).filter(Boolean)).size > 1 : undefined;
        if (variable === false)
          fixed = options.characterTags?.[0] ?? "";
      } else if (name === "shuffle" && texts[0] === undefined && args[0]?.possible?.length) {
        if (args[0].possible.every((value) => new Set(list(value)).size > 1))
          variable = true;
      } else if (texts.every((value) => value !== undefined)) {
        if (name === "random" && !texts.length)
          variable = true;
        else if (name === "random" && texts.length <= 2 && texts.every((value) => value.trim() !== "" && !Number.isNaN(Number(value)))) {
          const low = parseInt(texts[0], 10) || 0, high = parseInt(texts[1], 10) || 1;
          variable = high > low;
          if (!variable)
            fixed = String(low);
        } else {
          const choices = name === "shuffle" ? list(texts[0] ?? "") : texts;
          variable = new Set(choices).size > 1;
          if (!variable)
            fixed = choices[0] ?? "";
        }
      }
      const effects = [...input.effects];
      if (variable !== false)
        effects.push(mark(node, "random", variable === undefined ? "risk" : level, variable === undefined ? "The possible results depend on runtime arguments or the available selection pool." : undefined));
      return { text: fixed, effects };
    }
    if (name === "timediff" || name === "time_diff") {
      const from = args[0]?.text, to = args[1]?.text;
      if (!args.length)
        return { text: "invalid date", effects: [] };
      if (from !== undefined && !Number.isFinite(Date.parse(from)))
        return { text: "invalid date", effects: input.effects };
      if (from !== undefined && to)
        return { effects: input.effects };
      if (args[1] && to !== "" && reads.length > argReads)
        return { effects: input.effects };
      return { effects: [...input.effects, mark(node, "clock", from !== undefined && (!args[1] || to === "") ? level : "risk")] };
    }
    if (name === "randomlumia" || name === "idleduration" || name === "idle_duration")
      return { effects: [...input.effects, mark(node, name === "randomlumia" ? "random" : "clock", "risk", "The output depends on runtime arguments or available content.")] };
    if (TRANSPARENT.has(name)) {
      if (name === "trim" && !node.body) {
        calls.splice(callsBefore);
        return empty();
      }
      const value = body ?? args[args[0]?.text === "@data" ? 1 : 0] ?? empty(), constant = value.text;
      return { text: constant === undefined ? undefined : name === "upper" ? constant.toUpperCase() : name === "lower" ? constant.toLowerCase() : name === "trim" ? constant.trim() : name === "reverse" ? [...constant].reverse().join("") : name === "capitalize" ? constant.charAt(0).toUpperCase() + constant.slice(1) : constant, effects: value.effects };
    }
    if (["eq", "ne", "not"].includes(name) && args.every((value) => value.text !== undefined)) {
      const a = (args[0]?.text ?? "").trim(), b = (args[1]?.text ?? "").trim(), x = parseFloat(a), y = parseFloat(b);
      const same = !Number.isNaN(x) && !Number.isNaN(y) ? x === y : a === b;
      const result = (name === "not" ? !truth(a) : name === "ne" ? !same : same) ? "true" : "";
      return { text: result, effects: input.effects };
    }
    if (PURE.has(name)) {
      fixed++;
      if (!ABSORBING.has(name))
        return { effects: input.effects };
    } else if (reads.length === argReads)
      unresolved++;
    return { effects: uncertain(input.effects, `Nested in ${node.literal}; its final output depends on this operation.`) };
  };
  try {
    const value = walk(parseMacros(text));
    for (const call of calls)
      options.onCall?.(call);
    return { effects: unique([...value.effects, ...sideEffects]), calls, writes, sets };
  } catch (error) {
    if (!(error instanceof ScanLimit || error instanceof RangeError))
      throw error;
    return { effects: [{ kind: "opaque", level: "risk", name: "analysis-limit", literal: "Macro analysis limit", reason: "This source exceeds the static analysis budget. Use simulation and the Cache Diff to inspect its output." }], calls, writes: [], sets: [] };
  }
}
// src/health/macro-findings.ts
var TITLES = { random: "Random output", clock: "Live date or time", turn: "Changing conversation value", state: "Variable operation", condition: "Conditional output", opaque: "Macro needs runtime inspection", variable: "Variable check" };
var DETAILS = { variable: "This text depends on a variable.", random: "This macro can produce different output each time the prompt is built.", clock: "This value changes with the clock.", turn: "This value depends on the current conversation, so rebuilding earlier prompt content can change it.", state: "This macro changes a variable and emits the result.", condition: "A runtime value controls which content enters the prompt.", opaque: "The output cannot be established by static inspection." };
function effectFindings(effects, source, id) {
  const groups = new Map;
  for (const effect of effects) {
    const key = `${effect.kind}:${effect.level}`;
    groups.set(key, [...groups.get(key) ?? [], effect]);
  }
  return [...groups.values()].map((rows) => {
    const first = rows[0], suffix = first.kind === "clock" || first.kind === "turn" ? `dynamic-${first.kind}` : first.kind;
    return {
      id: `${id}-${suffix}${first.level === "risk" ? "-uncertain" : ""}`,
      level: first.level,
      source,
      title: TITLES[first.kind],
      evidence: [...new Set(rows.map((row) => row.literal))].slice(0, 6),
      detail: [...new Set(rows.map((row) => row.reason).filter((value) => !!value))].slice(0, 2).join(" ") || DETAILS[first.kind],
      suggestion: first.level === "variabled" ? "Stable while this variable keeps its value. Changing it mid-chat rewrites everything after this point." : first.level === "issue" ? "Keep this value outside the stable prefix, or store a fixed result." : "Use simulation or the Cache Diff to check whether this changes the prefix."
    };
  });
}
function scanText(content, source, id, options = {}) {
  return effectFindings(scanMacros(content, options).effects, source, id);
}
// src/health/composition.ts
var KINDS = ["style", "utility", "retrofit"];
var LABELS = { style: "Narrative styles", utility: "Loom utilities", retrofit: "Retrofits" };
var MACROS = { style: "loomstyle", utility: "loomutils", retrofit: "loomretrofits" };
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
function compositionFindings(snapshot, calls, options, historyActive = true) {
  const result = [], base = { category: "Compose", source: "Compose" };
  if (!snapshot?.available)
    return [{ ...base, id: "compose-unavailable", level: "risk", title: "Compose settings unavailable", detail: "This check could not read the Compose configuration.", suggestion: "Refresh health in a connected Lumiverse browser." }];
  const add = (id, item, detail, evidence) => result.push({ ...base, group: "Context filters", item, id, level: "issue", title: "Changes older messages", detail, evidence, suggestion: "Disable the moving depth filter to keep earlier prompt text stable." });
  for (const key of ["htmlTags", "detailsBlocks", "loomItems"]) {
    const filter = snapshot.filters?.[key];
    if (!historyActive || !filter?.enabled)
      continue;
    const name = key === "htmlTags" ? "HTML tags" : key === "detailsBlocks" ? "Details blocks" : "Loom tags";
    if (filter.keepDepth > 0)
      add(`compose-${key}`, name, "Messages are treated differently as they leave the recent-message window.", [`Keep in last ${filter.keepDepth} messages`, filter.keepOnly ? "Keep only matching content" : "Strip matching content"]);
    if (key === "htmlTags" && filter.stripFonts && (filter.fontKeepDepth ?? 3) > 0)
      add("compose-fonts", "Font tags", "Font tags are removed when a message leaves the recent-message window.", [`Keep in last ${filter.fontKeepDepth ?? 3} messages`]);
  }
  const active = new Map;
  for (const call of calls)
    if (active.get(call.name) !== "issue")
      active.set(call.name, call.level);
  const visited = new Set;
  for (let pass = 0;pass < 3; pass++)
    for (const item of snapshot.selections ?? []) {
      const level = active.get(MACROS[item.kind]), id = `${item.kind}:${item.id}`;
      if (!level || visited.has(id))
        continue;
      visited.add(id);
      const scan = scanMacros(item.content, options);
      const effects = level === "risk" ? scan.effects.map((effect) => effect.kind === "variable" ? effect : { ...effect, level: "risk", reason: "The containing Loom selection is conditional." }) : scan.effects;
      result.push(...effectFindings(effects, `Compose: ${LABELS[item.kind]} / ${item.name}`, `compose-${id}`).map((finding) => ({ ...finding, category: "Compose", group: LABELS[item.kind], item: item.name, itemId: item.id })));
      for (const call of scan.calls)
        if (active.get(call.name) !== "issue")
          active.set(call.name, level === "risk" ? "risk" : call.level);
    }
  if (snapshot.sovereign?.enabled)
    for (const name of ["loomsovhand", "loomcontinueprompt"]) {
      const level = active.get(name);
      if (!level)
        continue;
      result.push({
        ...base,
        group: "Sovereign Hand",
        item: name === "loomsovhand" ? "Co-pilot prompt" : "Continuation prompt",
        id: `compose-${name}`,
        level,
        title: "Changes with the current turn",
        evidence: [`{{${name}}}`],
        detail: "This enabled Compose prompt changes with the latest speaker or user directive.",
        suggestion: "Keep the changing directive after the stable prefix."
      });
    }
  if (snapshot.incomplete)
    result.push({ ...base, id: "compose-limit", level: "risk", title: "Some Loom content was not inspected", detail: "Selected Loom content exceeds the 200-item or 2-million-character inspection budget.", suggestion: "Use simulation and the Cache Diff for the remaining content." });
  return result;
}

// src/health/regex.ts
function regexMacroFields(script, preset) {
  if (script.disabled || !script.target?.includes("prompt") || !script.placement?.length)
    return [];
  const fields = [];
  if (script.substitute_macros && script.substitute_macros !== "none")
    fields.push(["Match pattern", script.find_regex]);
  if (preset || ["raw", "escaped", "after"].includes(script.substitute_macros))
    fields.push(["Replacement", script.replace_string]);
  return fields;
}
function regexFindings(scripts, preset, options) {
  const result = [];
  for (const script of scripts) {
    if (script.disabled || !script.target?.includes("prompt") || !script.placement?.length)
      continue;
    const location = { category: "Regex", group: script.scope === "chat" ? "Chat" : script.scope === "character" ? "Character" : "Global / preset", item: script.name, itemId: script.id };
    const source = `Regex: ${script.name}`, add = (id, level, title, detail, evidence) => result.push({
      ...location,
      source,
      id: `regex-${script.id}-${id}`,
      level,
      title,
      detail,
      evidence,
      suggestion: level === "issue" ? "Use stable replacements without moving depth limits in the cached prefix." : "Compare a simulation or the Cache Diff to check this operation's effect."
    });
    const history = script.placement.some((value) => value === "user_input" || value === "ai_output");
    const min = script.min_depth ?? 0, max = script.max_depth ?? null, ended = max !== null && max >= 0, depth = ended ? max + 1 : min;
    if (history && depth > 0 && (!ended || max >= min))
      result.push({
        ...location,
        source,
        category: "Depth Mutable",
        group: `Regex \xB7 ${location.group}`,
        groupId: `regex:${script.scope}`,
        id: `regex-${script.id}-depth`,
        level: "depth",
        depth,
        problematic: depth > 5,
        title: `Depth ${depth}`,
        evidence: [`Depth ${min}\u2013${ended ? max : "any"}`],
        detail: ended ? `This rule stops applying once a message passes depth ${max}, which rewrites that message. Older messages stay stable.` : "This rule starts applying to a message at this depth and keeps applying, so older messages stay stable.",
        suggestion: "Compared with your acceptable depth and optional history-token limit."
      });
    const activation = script.metadata?.prompt_activation;
    if (script.preset_id && activation?.mappings?.length)
      add("activation", "issue", "Changes preset block activation", "Regex matches enable or disable preset blocks as conversation input changes.", [activation.lifetime === "chat" ? "Chat-wide activation" : "Latest-message activation"]);
    const actions = Array.isArray(script.metadata?.match_actions) ? script.metadata.match_actions.filter((value) => ["move_top", "move_bottom", "repeat_back"].includes(String(value))) : [];
    if (actions.length)
      add("operations", "risk", "Moves or repeats matched text", "These operations rearrange text or reuse a prior message's match. Their effect on the prefix depends on the matched content and history.", actions.map((value) => String(value)));
    for (const [field, text] of regexMacroFields(script, preset))
      result.push(...scanText(text, `${source} / ${field}`, `regex-${script.id}-${field}`, { ...options, unknownCaptures: field === "Replacement" }).map((finding) => ({ ...finding, ...location, title: `${field}: ${finding.title.toLowerCase()}` })));
  }
  return result;
}

// src/health/history.ts
import { createHash as createHash4 } from "crypto";
function historyTemplate(message) {
  let text = message.content;
  const provenance = message.extra?.macro_literal_braces;
  const positions = provenance?.[createHash4("sha256").update(text).digest("hex")];
  if (Array.isArray(positions)) {
    const chunks = [];
    let start = 0, valid = true;
    for (const position of positions) {
      if (!Number.isSafeInteger(position) || position < start || position >= text.length || !"{}".includes(text[position])) {
        valid = false;
        break;
      }
      chunks.push(text.slice(start, position), text[position] === "{" ? "\x01" : "\x02");
      start = position + 1;
    }
    if (valid)
      text = chunks.join("") + text.slice(start);
  }
  if (!/<json>/i.test(text))
    return text;
  const chunks = [];
  let start = 0, depth = 0, work = 0;
  for (let i = 0;i < text.length; i++) {
    if (text[i] === "\\" && /[{}]/.test(text[i + 1] ?? "")) {
      i++;
      continue;
    }
    if (text.startsWith("{{", i)) {
      depth++;
      i++;
      continue;
    }
    if (depth && text.startsWith("}}", i)) {
      depth--;
      i++;
      continue;
    }
    if (depth || text.slice(i, i + 6).toLowerCase() !== "<json>")
      continue;
    let quoted = false, close = -1;
    for (let j = i + 6;j < text.length; j++) {
      if (++work > Math.min(text.length * 4, 64000000))
        throw new ScanLimit;
      if (quoted && text[j] === "\\") {
        j++;
        continue;
      }
      if (text[j] === '"') {
        quoted = !quoted;
        continue;
      }
      if (!quoted && text.slice(j, j + 7).toLowerCase() === "</json>") {
        close = j;
        break;
      }
      if (!quoted && text.slice(j, j + 6).toLowerCase() === "<json>")
        break;
    }
    if (close < 0)
      continue;
    try {
      JSON.parse(text.slice(i + 6, close));
    } catch {
      continue;
    }
    chunks.push(text.slice(start, i), "[literal JSON data]");
    start = close + 7;
    i = start - 1;
  }
  return chunks.join("") + text.slice(start);
}
function includedHistory(messages, metadata, clipping) {
  let visible = messages.filter((message) => message.extra?.hidden !== true);
  if (clipping?.anchorActive) {
    const index = visible.findIndex((message) => message.id === metadata.context_history_anchor_message_id);
    if (index >= 0)
      visible = visible.slice(index);
  } else if (clipping?.enabled && !clipping.budgetInvalid && clipping.messagesDropped)
    visible = visible.slice(clipping.messagesDropped);
  return visible;
}

// src/health/analyze.ts
var STRUCTURAL = new Set(["chat_history", "world_info_before", "world_info_after", "char_description", "char_personality", "persona_description", "scenario", "dialogue_examples"]);
var normalizeTag = (tag) => tag.normalize("NFKC").trim().toLowerCase().replace(/[\s._\-:/\\|()[\]{}+,;'"`~!?@#$%^&*=<>]+/g, "");
function effectiveBlocks(sources) {
  let radio = false, selected = false;
  return (sources.preset?.prompt_order ?? []).filter((block) => {
    const enabled = sources.active.block_states[block.id] ?? block.enabled;
    if (block.marker === "category") {
      radio = block.categoryMode === "radio";
      selected = false;
    } else if (enabled && radio) {
      if (selected)
        return false;
      selected = true;
    }
    if (!enabled || block.marker === "category" && !block.content.trim() || block.injectionTrigger?.length && !block.injectionTrigger.includes("normal"))
      return false;
    const tags = block.characterTagTrigger?.map(normalizeTag).filter(Boolean) ?? [];
    return !tags.length || (sources.character?.tags ?? []).map(normalizeTag).some((tag) => tags.some((need) => tag.includes(need)));
  });
}
function clippingFindings(stats) {
  if (!stats)
    return [];
  const base = { category: "Context", source: "Context", suggestion: "Turn on Cache Friendly mode in LumiBooks to keep history from overflowing." };
  if (stats.budgetInvalid || stats.fixedOverBudget || stats.anchorOverflow)
    return [{
      ...base,
      id: "context-overflow",
      level: "issue",
      title: "Prompt exceeds the context budget",
      detail: `Fixed prompt: ${stats.fixedTokens.toLocaleString()} tokens. Input budget: ${stats.inputBudget.toLocaleString()}.`
    }];
  if (stats.messagesDropped > 0)
    return [{
      ...base,
      id: "context-clipping",
      level: "issue",
      title: "History is being clipped",
      detail: `${stats.messagesDropped.toLocaleString()} earlier messages are excluded from the prompt.`
    }];
  if (stats.enabled && stats.remainingHistoryBudget <= stats.chatHistoryTokensAfter)
    return [{
      ...base,
      id: "context-full",
      level: "issue",
      title: "Context is full",
      detail: "There is no room for another turn without clipping history."
    }];
  return [];
}
function reportedUsage(saved, messageId) {
  const raw = saved?.usage?.provider_raw;
  if (!raw)
    return;
  const number = (...values) => values.find((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const read = number(raw.cache_read_input_tokens, raw.prompt_tokens_details?.cached_tokens, raw.input_tokens_details?.cached_tokens, raw.cachedContentTokenCount);
  const write = number(raw.cache_creation_input_tokens, raw.prompt_tokens_details?.cache_write_tokens, raw.input_tokens_details?.cache_write_tokens);
  return read === undefined && write === undefined ? undefined : { read, write, model: saved.model, messageId };
}
var WRITES = /counter|toggle|(?:set|inc|dec|add|delete|flush)(?:global|chat|g)?var|[.$@][\w-]+\s*(?:=|\+\+|--|\+=|-=)/i;
function presetSettings(sources) {
  const saved = sources.preset?.metadata?.promptVariables, settings = {};
  for (const block of sources.preset?.prompt_order ?? [])
    for (const variable of block.variables ?? []) {
      const value = saved?.[block.id]?.[variable.name] ?? variable.defaultValue;
      settings[variable.name] = typeof value === "string" || typeof value === "number" ? String(value) : "";
    }
  return settings;
}
function variableWrites(sources, blocks, options) {
  const texts = [];
  for (const block of blocks)
    if (!STRUCTURAL.has(block.marker ?? ""))
      texts.push({ text: block.content, source: `preset block "${block.name}"`, firm: true, gated: block.injectionTrigger?.length ? "for some generation types" : undefined });
  for (const block of sources.preset?.prompt_order ?? [])
    if ((sources.active.block_states[block.id] ?? block.enabled) && block.injectionTrigger?.length && !blocks.includes(block) && !STRUCTURAL.has(block.marker ?? ""))
      texts.push({ text: block.content, source: `preset block "${block.name}"`, firm: false, gated: "for some generation types" });
  for (const { entry } of sources.lore)
    texts.push({ text: entry.content, source: `lore entry "${entry.comment || entry.uid}"`, firm: entry.constant, gated: entry.constant ? undefined : "when it activates" });
  for (const script of sources.regex)
    for (const [, text] of regexMacroFields(script, !!sources.preset))
      texts.push({ text, source: `regex "${script.name}"`, firm: false, gated: "when it matches" });
  if (sources.character)
    for (const key of ["description", "personality", "scenario", "system_prompt", "post_history_instructions"])
      texts.push({ text: String(sources.character[key] ?? ""), source: `character ${key}`, firm: false });
  if (sources.persona)
    texts.push({ text: sources.persona.description, source: "persona", firm: false });
  for (const message of sources.messages ?? [])
    texts.push({ text: historyTemplate(message), source: `message ${(message.index_in_chat ?? 0) + 1}`, firm: false });
  const writing = texts.filter((item) => item.text?.includes("{{") && WRITES.test(item.text));
  const changing = {}, writers = {}, written = {};
  const name = (id) => id.slice(id.indexOf(":") + 1);
  const taint = (id, kind, level, reason) => {
    if (changing[id]?.level === "issue" || changing[id]?.level === level)
      return;
    changing[id] = { kind, level, reason };
  };
  for (let pass = 0;pass < 2; pass++)
    for (const { text, source, firm, gated } of writing) {
      const scan = scanMacros(text, { ...options, changing });
      for (const write of scan.writes)
        taint(write.id, write.kind, firm ? write.level : "risk", `${source} writes a changing value to "${name(write.id)}", so anything checking or reading it can change.`);
      for (const set of scan.sets) {
        if (set.value !== undefined && !written[set.id]?.includes(set.value))
          (written[set.id] ??= []).push(set.value);
        if (gated) {
          taint(set.id, "state", "risk", `${source} only runs ${gated}, and it sets "${name(set.id)}", so anything checking or reading it can change.`);
          continue;
        }
        const label = set.value === undefined ? source : `${source} (to "${set.value.length > 30 ? `${set.value.slice(0, 30)}\u2026` : set.value}")`;
        if (!writers[set.id]?.includes(label))
          (writers[set.id] ??= []).push(label);
      }
    }
  return { changing, writers, written };
}
function analyze(sources, preview, usage) {
  const findings = [], blocks = effectiveBlocks(sources);
  const calls = [];
  const variables = {};
  const stored = sources.chat.metadata.macro_variables;
  for (const [scope, prefix] of [["global", "gvar"], ["chat", "chatvar"]]) {
    const values = scope === "chat" ? sources.chat.metadata.chat_variables : stored?.[scope];
    if (!values || typeof values !== "object")
      continue;
    for (const [key, value] of Object.entries(values))
      if (typeof value === "string")
        variables[`${prefix}:${key}`] = value;
  }
  const chatData = sources.chat.metadata, group = !!chatData.group && Array.isArray(chatData.character_ids);
  const cardMode = !group ? "solo" : chatData.group_card_mode === "merge" || chatData.group_card_mode === "merge_ignore_muted" ? chatData.group_card_mode : "swap";
  const room = !!chatData.multiplayer_room_id, inRoom = room ? "yes" : "no";
  const options = {
    variables,
    cardMode,
    room,
    characterTags: sources.character?.tags ?? [],
    constants: { ismultiplayer: inRoom, is_multiplayer: inRoom, ismultiplayerroom: inRoom, is_multiplayer_room: inRoom, isgroupchat: group ? "yes" : "no", is_group_chat: group ? "yes" : "no", groupcardmode: cardMode, group_card_mode: cardMode, ...sources.input.composition?.available ? { loomsovhandactive: sources.input.composition.sovereign?.enabled ? "yes" : "no" } : {} },
    onCall: (call) => {
      if (calls.length < 20000)
        calls.push(call);
    }
  };
  const aliases = { description: ["description", "chardescription"], personality: ["personality", "charpersonality"], scenario: ["scenario", "charscenario"], system_prompt: ["charsystemprompt"], post_history_instructions: ["charposthistoryinstructions", "charinstruction", "charjailbreak", "jailbreak"] };
  const references = {};
  if (sources.character)
    for (const [field, names] of Object.entries(aliases))
      for (const name of names)
        references[name] = String(sources.character[field] ?? "");
  if (sources.persona)
    references.persona = references.userpersona = sources.persona.description;
  const expanded = { ...options, references };
  options.settings = expanded.settings = presetSettings(sources);
  Object.assign(options, variableWrites(sources, blocks, { ...expanded, onCall: undefined }));
  expanded.changing = options.changing;
  expanded.writers = options.writers;
  expanded.written = options.written;
  for (const block of blocks) {
    const source = `Preset: ${sources.preset.name} / ${block.name}`;
    const location = { category: "Preset", group: sources.preset.name, groupId: sources.preset.id, item: block.name, itemId: block.id };
    if (!STRUCTURAL.has(block.marker ?? ""))
      findings.push(...scanText(block.content, source, `block-${block.id}`, options).map((finding) => ({ ...finding, ...location })));
    if (block.position === "in_history")
      findings.push({
        ...location,
        category: "Depth Mutable",
        group: `Preset \xB7 ${sources.preset.name}`,
        groupId: `preset:${sources.preset.id}`,
        id: `depth-${block.id}`,
        level: "depth",
        depth: block.depth,
        problematic: block.depth > 5,
        title: `Depth ${block.depth}`,
        source,
        detail: "This instruction follows its configured position in chat history.",
        suggestion: "Compared with your acceptable depth and optional history-token limit."
      });
  }
  for (const { bookId, bookName, scope, entry } of sources.lore) {
    const source = `${scope} lore: ${bookName} / ${entry.comment || entry.uid}`;
    const location = { category: "World info", group: bookName, groupId: bookId, item: entry.comment || String(entry.uid), itemId: entry.id };
    if (!entry.constant)
      findings.push({
        ...location,
        id: `activation-${entry.id}`,
        level: "issue",
        title: entry.vectorized ? "Vector activation" : "Keyword activation",
        source,
        detail: entry.vectorized ? "This entry enters or leaves the prompt as vector matches change." : "This entry enters or leaves the prompt as keyword matches change.",
        suggestion: "Use constant activation for lore that should stay in the cached prefix.",
        evidence: entry.use_probability && entry.probability < 100 ? [`Activation chance: ${entry.probability}%`] : undefined
      });
    if (entry.position === 4)
      findings.push({
        ...location,
        category: "Depth Mutable",
        group: `World info \xB7 ${bookName}`,
        groupId: `world:${bookId}`,
        id: `lore-depth-${entry.id}`,
        level: "depth",
        depth: entry.depth,
        problematic: entry.depth > 5,
        title: `Depth ${entry.depth}`,
        source,
        detail: "This lore entry follows its configured position in chat history.",
        suggestion: "Compared with your acceptable depth and optional history-token limit."
      });
    findings.push(...scanText(entry.content, source, `lore-${entry.id}`, expanded).map((finding) => ({ ...finding, ...location })));
  }
  if (sources.character)
    for (const key of ["description", "personality", "scenario", "system_prompt", "post_history_instructions"]) {
      const markers = { description: "char_description", personality: "char_personality", scenario: "scenario" };
      const automatic = key === "post_history_instructions" && preview.breakdown.some((row) => row.name === "Post-History Instructions" && row.marker === "jailbreak" && !row.blockId);
      const direct = automatic || blocks.some((block) => !!markers[key] && block.marker === markers[key]);
      const reached = calls.filter((call) => aliases[key].includes(call.name));
      if (!direct && !reached.length)
        continue;
      const conditional = !direct && reached.every((call) => call.level === "risk");
      findings.push(...scanText(sources.character[key], `Character: ${sources.character.name} / ${key}`, `character-${key}`, expanded).map((finding) => ({ ...finding, level: conditional && finding.level !== "variabled" ? "risk" : finding.level, category: "Character", group: sources.character.name, item: key.replaceAll("_", " ") })));
    }
  if (sources.persona) {
    const reached = calls.filter((call) => ["persona", "userpersona"].includes(call.name)), direct = blocks.some((block) => block.marker === "persona_description");
    if (direct || reached.length)
      findings.push(...scanText(sources.persona.description, `Persona: ${sources.persona.name}`, "persona", expanded).map((finding) => ({
        ...finding,
        level: !direct && finding.level !== "variabled" && reached.every((call) => call.level === "risk") ? "risk" : finding.level,
        category: "Persona",
        group: sources.persona.name,
        item: "Description"
      })));
  }
  const historyActive = !sources.preset || blocks.some((block) => block.marker === "chat_history");
  for (const [index, message] of includedHistory(historyActive ? sources.messages ?? [] : [], sources.chat.metadata, preview.contextClipStats).entries()) {
    if (!message.content.includes("{{"))
      continue;
    const item = `Message ${(message.index_in_chat ?? index) + 1} \xB7 ${message.name || (message.is_user ? "You" : "Assistant")}`;
    try {
      findings.push(...scanText(historyTemplate(message), `History: ${item}`, `message-${message.id}`, expanded).map((finding) => ({ ...finding, category: "History", item, itemId: message.id })));
    } catch (error) {
      if (!(error instanceof ScanLimit))
        throw error;
      findings.push({
        category: "History",
        item,
        itemId: message.id,
        id: `message-${message.id}-limit`,
        level: "risk",
        source: `History: ${item}`,
        title: "Literal data needs runtime inspection",
        detail: "This message exceeds the literal-data inspection budget.",
        suggestion: "Inspect its assembled output in simulation or the Cache Diff."
      });
    }
  }
  findings.push(...regexFindings(sources.regex, !!sources.preset, expanded));
  findings.push(...compositionFindings(sources.input.composition, calls, expanded, historyActive));
  const caching = sources.connection.metadata?.prompt_caching;
  if ((preview.provider === "anthropic" || sources.connection.provider === "anthropic") && caching !== true && (!caching || typeof caching !== "object" || Array.isArray(caching)))
    findings.push({
      category: "Connection",
      id: "caching-disabled",
      level: "issue",
      title: "Prompt caching is off",
      source: "Connection",
      item: sources.connection.name,
      detail: "Caching is disabled for this Anthropic connection.",
      suggestion: "Enable prompt caching in its connection settings."
    });
  if (preview.worldInfoStats?.evictedByBudget)
    findings.push({
      category: "World info",
      group: "Lore budget",
      id: "lore-budget",
      level: "issue",
      title: "Activated lore exceeds its budget",
      source: "Lore budget",
      detail: `${preview.worldInfoStats.evictedByBudget} activated entries were excluded.`,
      suggestion: "Review the world-info token budget and competing entries."
    });
  findings.push(...clippingFindings(preview.contextClipStats));
  for (const finding of findings)
    if (finding.level === "variabled") {
      const origin = finding.category ?? "Context";
      finding.groupId = `${origin}:${finding.groupId ?? finding.group ?? ""}`;
      finding.group = finding.group ? `${origin} \xB7 ${finding.group}` : origin;
      finding.category = "Variabled";
    }
  findings.sort((a, b) => Number(b.level === "issue") - Number(a.level === "issue"));
  return {
    chatId: sources.chat.id,
    at: Date.now(),
    preset: sources.preset?.name ?? "No preset",
    model: preview.model,
    provider: preview.provider,
    findings: findings.slice(0, 500),
    findingsOmitted: Math.max(0, findings.length - 500),
    blocksScanned: blocks.length,
    entriesScanned: sources.lore.length,
    clipping: preview.contextClipStats,
    usage
  };
}

// src/health/sources.ts
async function allPages(read) {
  const rows = [];
  for (;; ) {
    const page = await read(rows.length);
    if (!page || !Array.isArray(page.data) || !Number.isFinite(page.total))
      throw new Error("The host returned an invalid audit page.");
    rows.push(...page.data);
    if (rows.length >= page.total)
      return rows;
    if (!page.data.length)
      throw new Error("The source list changed during the audit. Run the check again.");
    if (rows.length > 50000)
      throw new Error("This audit exceeds 50,000 source entries. Narrow the attached lorebooks before retrying.");
  }
}
async function collectSources(api, user, input) {
  const chat = await api.chats.get(input.chatId, user);
  if (!chat)
    throw new Error("This chat is no longer available.");
  const [active, persona, globalBooks, connection] = await Promise.all([
    api.presets.getActive(chat.id, user),
    api.personas.getActive(user),
    api.world_books.getGlobal(user),
    input.connectionId ? api.connections.get(input.connectionId, user) : api.connections.list(user).then((rows) => rows.find((c) => c.is_default) ?? null)
  ]);
  if (!connection)
    throw new Error("Select a connection before checking cache health.");
  const [character, preset] = await Promise.all([
    chat.character_id ? api.characters.get(chat.character_id, user) : null,
    active.preset_id ? api.presets.get(active.preset_id, user) : null
  ]);
  if (active.preset_id && !preset)
    throw new Error("The active preset is no longer available.");
  const notes = [];
  const books = new Map;
  const add = (ids, scope) => {
    if (Array.isArray(ids)) {
      for (const id of ids)
        if (typeof id === "string" && id && !books.has(id))
          books.set(id, scope);
    }
  };
  add(character?.world_book_ids, "Character");
  if (chat.metadata.group) {
    notes.push({
      id: "group-scope",
      level: "unknown",
      title: "Group chat sources can change with the speaker",
      source: "Chat",
      detail: "The audit includes potential group-member lorebooks. The next speaker, muted members and card mode can change the actual set.",
      suggestion: "Check the Cache Diff when the focused character changes."
    });
    const ids = Array.isArray(chat.metadata.character_ids) ? chat.metadata.character_ids.filter((id) => typeof id === "string") : [];
    for (const id of ids)
      if (id !== character?.id)
        add((await api.characters.get(id, user))?.world_book_ids, "Group member (potential)");
  }
  const effectivePersona = chat.metadata.temporary === true ? null : persona ?? await api.personas.getDefault(user);
  if (effectivePersona?.attached_world_book_id)
    add([effectivePersona.attached_world_book_id], "Persona");
  add(chat.metadata.chat_world_book_ids, "Chat");
  add(globalBooks, "Global");
  const lore = [];
  let sourceCharacters = JSON.stringify({ character, preset, persona: effectivePersona }).length;
  if (sourceCharacters > 32000000)
    throw new Error("The active preset and character sources exceed the audit size limit.");
  for (const [id, scope] of books) {
    const book = await api.world_books.get(id, user);
    if (!book) {
      notes.push({ id: `missing-book-${id}`, level: "unknown", title: "An attached lorebook is unavailable", source: scope, detail: id, suggestion: "Check this chat's lorebook attachments." });
      continue;
    }
    const entries = await allPages((offset) => api.world_books.entries.list(id, { limit: 200, offset, userId: user }));
    if (!entries.length && book.metadata.source === "character")
      notes.push({
        id: `embedded-book-${id}`,
        level: "unknown",
        title: "Embedded lore may need runtime inspection",
        source: book.name,
        detail: "This character-backed book exposes no native entries. Its embedded source was not statically audited.",
        suggestion: "Inspect the simulation and live prompt diffs."
      });
    for (const entry of entries)
      if (!entry.disabled) {
        sourceCharacters += JSON.stringify(entry).length;
        if (sourceCharacters > 32000000)
          throw new Error("The enabled audit sources exceed 32 million characters. Narrow the attached lorebooks before running this check.");
        lore.push({ bookId: id, bookName: book.name, scope, entry });
      }
  }
  const [regex, messages] = await Promise.all([api.regex_scripts.getActive({ target: "prompt", characterId: character?.id, chatId: chat.id, userId: user }), api.chat.getMessages(chat.id)]);
  for (const message of messages) {
    sourceCharacters += message.content.length;
    if (sourceCharacters > 32000000)
      throw new Error("The audit sources and history exceed 32 million characters.");
  }
  return { input: { ...input, connectionId: connection.id }, chat, character, persona: effectivePersona, preset, active, connection, lore, regex, notes, messages };
}

// src/health/scenarios.ts
function seededRandom(seed) {
  let value = 2166136261;
  for (const ch of seed)
    value = Math.imul(value ^ ch.charCodeAt(0), 16777619);
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}
var PAST_TURNS = 5;
function scenarios(seed, endsWithUser) {
  const random = seededRandom(seed);
  const words = ["lantern", "harbour", "garden", "compass", "rain", "window", "bridge", "letter"];
  const word = () => words[Math.floor(random() * words.length)];
  const user = { role: "user", content: `I found a ${word()} near the ${word()}. What happens next? [Cache simulation]` };
  const newTurn = endsWithUser ? [{ role: "assistant", content: "The scene continues. This is a synthetic reply for the cache simulation." }, user] : [user];
  return {
    scenarios: [
      { name: "Reference", purpose: "The prompt that produced your latest reply. Future Turns compare against this.", messages: [] },
      { name: "Regenerate", purpose: "Regenerates your latest reply. The prompt should match exactly.", messages: [] },
      { name: "New turn", purpose: "Sends a new message right after your latest reply. Most/all of your prompt should be the same, with only the latest few turns changing.", messages: newTurn }
    ]
  };
}

// src/health/copy.ts
function historicalCutoffs(messages) {
  const candidates = messages.flatMap((message, index) => index > 0 && !message.is_user && message.content && messages[index - 1].is_user ? [index] : []);
  return candidates.slice(-(PAST_TURNS + 1));
}

// src/health/memory.ts
var LUMIBOOKS_URL = "https://github.com/AMousePad/LumiBooks";
var OVERFLOW = "Your context will eventually overflow without a method of cache friendly memory management, obliterating your cachability.";
var BASE = { level: "risk", category: "Context", source: "Context", item: "History overflow" };
var MISSING = {
  ...BASE,
  id: "lumibooks-missing",
  title: "LumiBooks is not running",
  detail: `${OVERFLOW} LumiBooks is recommended to prevent that!`,
  suggestion: "Install and enable LumiBooks, then turn on its Cache Friendly mode.",
  link: { label: "Find it here.", url: LUMIBOOKS_URL }
};
var OFF = {
  ...BASE,
  id: "lumibooks-cache-friendly-off",
  title: "LumiBooks Cache Friendly mode is off",
  detail: `${OVERFLOW} LumiBooks is running, but its Cache Friendly mode is off.`,
  suggestion: "Turn on Cache Friendly mode in LumiBooks."
};
var UNCONFIRMED = {
  ...BASE,
  id: "lumibooks-mode-unknown",
  title: "Cannot confirm LumiBooks Cache Friendly mode",
  detail: `${OVERFLOW} LumiBooks is running, but it did not report whether Cache Friendly mode is on.`,
  suggestion: "Update LumiBooks and open it once, then make sure Cache Friendly mode is on.",
  link: { label: "Get the latest version.", url: LUMIBOOKS_URL }
};
var wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function memoryFinding(api, user, settleMs = 1500) {
  const read = async (endpoint) => {
    try {
      return { state: "value", value: await api.rpcPool.read(endpoint) };
    } catch (error) {
      return { state: /not registered/i.test(String(error?.message ?? error)) ? "missing" : "unknown" };
    }
  };
  const mode = `lumi_books.cache_mode.${user}`;
  let result = await read(mode);
  if (result.state === "missing") {
    if ((await read("lumi_books.phoneline")).state === "missing")
      return [structuredClone(MISSING)];
    await wait(settleMs);
    result = await read(mode);
    if (result.state === "missing")
      return [structuredClone(UNCONFIRMED)];
  }
  if (result.state !== "value")
    return [];
  return result.value?.cacheFriendly === true ? [] : [structuredClone(OFF)];
}

// src/health/service.ts
function signature(value) {
  return createHash5("sha256").update(stableJson(value)).digest("hex");
}

class HealthService {
  api;
  busy;
  progress;
  settings;
  jobs = new Map;
  preparing = new Set;
  constructor(api, busy, progress, settings = async () => DEFAULT_SETTINGS) {
    this.api = api;
    this.busy = busy;
    this.progress = progress;
    this.settings = settings;
  }
  assertIdle(user, chat) {
    if (this.busy(user, chat))
      throw new Error("Finish or stop the live generation before running a cache check.");
  }
  preview(user, sources, chatId = sources.chat.id, generationType = "normal") {
    const input = {
      chatId,
      connectionId: sources.connection.id,
      personaId: sources.persona?.id,
      presetId: sources.preset?.id,
      generationType,
      includeRequestMessages: true
    };
    return this.api.generate.dryRun(input, user);
  }
  async audit(user, input) {
    this.assertIdle(user, input.chatId);
    const sources = await collectSources(this.api, user, input);
    const preview = await this.preview(user, sources);
    const messages = sources.messages ?? [];
    const latest = [...messages].reverse().find((message) => !message.is_user && message.content);
    const usage = latest ? reportedUsage(await this.api.generate.getBreakdown(latest.id, user), latest.id) : undefined;
    const report = await classifyDepth(analyze(sources, preview, usage), await this.settings(user), preview.messages, this.api, user);
    report.findings.push(...await memoryFinding(this.api, user));
    return report;
  }
  async tolerated(user, before, after, comparison, context) {
    if (comparison.kind !== "break" || comparison.routeChanged || comparison.firstMessage === null)
      return false;
    try {
      const old = before.map(normalizedHistory), next = after.map(normalizedHistory);
      if (!historyUnchanged(old, next))
        return false;
      const boundary = await tailStart(old, validateSettings(await this.settings(user)), context, (messages) => this.api.tokens.countMessages(messages, { model: context.mainDispatch.descriptor?.model, userId: user }));
      return comparison.firstMessage >= boundary.index;
    } catch {
      return false;
    }
  }
  async prepare(user, session, input) {
    if (!session)
      throw new Error("Open LumiCache in a connected browser to simulate caching.");
    this.assertIdle(user, input.chatId);
    for (const [id, job] of this.jobs)
      if (!job.running && job.expires < Date.now())
        this.jobs.delete(id);
    if (this.preparing.has(user) || [...this.jobs.values()].some((job) => job.user === user))
      throw new Error("A cache simulation is already being prepared or running. Cancel it before starting another.");
    if (this.preparing.size + this.jobs.size >= 8)
      throw new Error("Too many simulations are active. Try again after one finishes.");
    this.preparing.add(user);
    try {
      const sources = await collectSources(this.api, user, input), messages = await this.api.chat.getMessages(input.chatId);
      const last = messages.at(-1);
      if (!last)
        throw new Error("Send a message in this chat before running a simulation.");
      const id = crypto.randomUUID(), ticket = { id, sourceChatId: input.chatId, lastMessageId: last.id, branchName: `LumiCache simulation ${id}` };
      const timer = setTimeout(() => {
        if (!this.jobs.get(id)?.running)
          this.jobs.delete(id);
      }, 120000);
      timer.unref?.();
      this.jobs.set(id, { user, session, sources, ticket, expires: Date.now() + 120000, running: false, cancelled: false, timer });
      return ticket;
    } finally {
      this.preparing.delete(user);
    }
  }
  cancel(user, session, id) {
    const job = this.jobs.get(id);
    if (!job || job.user !== user || job.session !== session)
      throw new Error("This simulation is no longer available in this browser.");
    if (job.running)
      job.cancelled = true;
    else {
      clearTimeout(job.timer);
      this.jobs.delete(id);
    }
  }
  async run(user, session, id, scratchChatId) {
    const job = this.jobs.get(id);
    if (!job || job.user !== user || job.session !== session || job.running || job.expires < Date.now())
      throw new Error("This simulation ticket expired or belongs to another browser.");
    job.running = true;
    let scratch;
    try {
      const candidate = await this.api.chats.get(scratchChatId, user);
      if (!candidate || candidate.id === job.sources.chat.id || candidate.name !== job.ticket.branchName || candidate.metadata.lumicache_simulation_source !== job.sources.chat.id || candidate.metadata.lumicache_simulation !== id)
        throw new Error("The simulation copy does not match this ticket. No messages were changed.");
      scratch = candidate;
    } catch (error) {
      job.running = false;
      throw error;
    }
    clearTimeout(job.timer);
    const plan = scenarios(id, job.sources.messages?.at(-1)?.is_user === true);
    const report = {
      sourceChatId: job.sources.chat.id,
      at: Date.now(),
      complete: false,
      steps: [],
      history: [],
      seed: id,
      limitations: [],
      health: {
        chatId: job.sources.chat.id,
        at: Date.now(),
        preset: job.sources.preset?.name ?? "No preset",
        model: job.sources.connection.model,
        provider: job.sources.connection.provider,
        findings: [],
        entriesScanned: job.sources.lore.length,
        blocksScanned: 0
      }
    };
    const clonedRules = [];
    if (scratch.metadata.lumicache_omitted_audio)
      report.limitations.push(`${scratch.metadata.lumicache_omitted_audio} audio attachments were excluded from the disposable copy because the host treats their files as message-owned. Audio-related cache behavior is not tested; original audio is preserved.`);
    try {
      const sourceMessages = await this.api.chat.getMessages(job.sources.chat.id), initialCopy = await this.api.chat.getMessages(scratch.id);
      if (sourceMessages.at(-1)?.id !== job.ticket.lastMessageId || sourceMessages.length !== initialCopy.length || sourceMessages.some((message, index) => message.content !== initialCopy[index].content || message.is_user !== initialCopy[index].is_user))
        throw new Error("The source conversation changed before the simulation started. Retry with the latest history.");
      const anchorIndex = Number(scratch.metadata.lumicache_simulation_anchor);
      if (Number.isInteger(anchorIndex) && anchorIndex >= 0 && initialCopy[anchorIndex]) {
        scratch = await this.api.chats.update(scratch.id, { metadata: { ...scratch.metadata, context_history_anchor_message_id: initialCopy[anchorIndex].id } }, user);
        report.limitations.push("The current context anchor is preserved for future scenarios. Historical samples before that anchor are reconstructed without it.");
      }
      const branchPreset = await this.api.presets.getActive(scratch.id, user);
      if (branchPreset.preset_id !== job.sources.active.preset_id || stableJson(branchPreset.block_states) !== stableJson(job.sources.active.block_states))
        throw new Error("The disposable branch does not resolve to the source chat's preset and block selections. The simulation was stopped.");
      for (const rule of job.sources.regex)
        if (rule.scope === "chat" && rule.scope_id === job.sources.chat.id) {
          const { id: _id, created_at: _created, updated_at: _updated, ...fields } = rule;
          const clone = await this.api.regex_scripts.create({ ...fields, script_id: crypto.randomUUID(), folder: "", scope_id: scratch.id, preset_id: null }, user);
          clonedRules.push(clone.id);
        }
      const sourceBefore = signature(await this.api.chat.getMessages(job.sources.chat.id));
      let totalCharacters = 0, completed = 0;
      const reportedContext = new Set;
      const contextFor = (result) => ({
        userId: user,
        chatId: scratch.id,
        generationId: id,
        isDryRun: true,
        signal: new AbortController().signal,
        interceptorDeadlineAt: Date.now(),
        mainDispatch: {
          dispatchKind: "concrete",
          connectionDispatchRevision: null,
          descriptor: { connectionId: job.sources.connection.id, provider: result.provider, model: result.model, endpointOrigin: "Simulation", connectionDispatchRevision: null }
        }
      });
      const readSnapshot = (result) => {
        if (!result.request_messages)
          throw new Error("The host did not return prepared request messages. Update Lumiverse to run this simulation.");
        const after = snapshot(result.request_messages, contextFor(result));
        totalCharacters += after.messages.reduce((n, message) => n + message.header.length + message.body.length, 0);
        if (totalCharacters > 256000000)
          throw new Error("The simulation report exceeds the 256-million-character limit. Completed previews remain available.");
        return after;
      };
      const [referenceScenario, regenerateScenario, newTurnScenario] = plan.scenarios;
      const cutoffs = historicalCutoffs(sourceMessages), replied = cutoffs.at(-1) === sourceMessages.length - 1;
      const checkpoint = (name) => {
        this.assertIdle(user, job.sources.chat.id);
        if (job.cancelled)
          throw new Error("Simulation cancelled. Completed previews are shown below.");
        this.progress(user, job.session, completed++, name);
      };
      const rewind = async (cutoff) => {
        const current = await this.api.chat.getMessages(scratch.id);
        if (anchorIndex >= cutoff) {
          const metadata = { ...(await this.api.chats.get(scratch.id, user)).metadata };
          delete metadata.context_history_anchor_message_id;
          await this.api.chats.update(scratch.id, { metadata }, user);
        }
        for (const message of current.slice(cutoff).reverse())
          await this.api.chat.deleteMessage(scratch.id, message.id);
      };
      let base;
      const record = async (scenario, result) => {
        const after = readSnapshot(result), outline = promptOutline(after, result.request_messages, result.breakdown);
        const changedSources = base ? changedBreakdown(base.result, result) : [];
        const comparison = compare(base?.snapshot ?? null, after);
        if (comparison.kind === "first")
          comparison.summary = "Reference prompt for the forward simulation. No model request was sent.";
        const tolerated = base ? await this.tolerated(user, base.result.request_messages, result.request_messages, comparison, contextFor(result)) : false;
        const timeline = buildTimeline(base?.snapshot ?? null, base?.outline ?? null, after, outline, comparison, tolerated);
        if (!base) {
          report.health = await classifyDepth(analyze(job.sources, result), await this.settings(user), result.messages, this.api, user);
          for (const finding of report.health.findings)
            if (finding.id.startsWith("context-"))
              reportedContext.add(finding.id);
          if (scratch.metadata.lumicache_omitted_audio)
            report.health.findings.push({
              id: "audio-not-simulated",
              level: "unknown",
              title: "Audio attachment caching was not simulated",
              source: "Attachments",
              detail: `${scratch.metadata.lumicache_omitted_audio} audio attachments were excluded from the disposable copy to preserve their original files.`,
              suggestion: "Use the original request's diff and saved provider usage to inspect audio-related changes."
            });
          base = { result, snapshot: after, outline };
        } else
          for (const finding of clippingFindings(result.contextClipStats).filter((f) => f.level !== "info")) {
            if (reportedContext.has(finding.id))
              continue;
            reportedContext.add(finding.id);
            report.health.findings.push({ ...finding, id: `step-${report.steps.length}-${finding.id}`, source: scenario.name });
          }
        report.steps.push({ name: scenario.name, purpose: scenario.purpose, inputs: scenario.messages, snapshot: after, comparison, clipping: result.contextClipStats, changedSources, timeline });
        if (comparison.kind === "break")
          report.health.findings.push({
            id: `simulation-${report.steps.length}`,
            level: tolerated ? "info" : "issue",
            category: "Simulation",
            title: `${scenario.name}: the assembled prefix changed`,
            source: changedSources.join(", ") || "Assembled prompt",
            detail: comparison.summary,
            suggestion: "Open this step's diff to see what changed. Provider cache loss has not been measured."
          });
      };
      checkpoint(newTurnScenario.name);
      for (const message of newTurnScenario.messages)
        await this.api.chat.appendMessage(scratch.id, { role: message.role, content: String(message.content) }, { triggerGeneration: false });
      const nextTurn = await this.preview(user, job.sources, scratch.id);
      await rewind(replied ? sourceMessages.length - 1 : sourceMessages.length);
      checkpoint(referenceScenario.name);
      await record(referenceScenario, await this.preview(user, job.sources, scratch.id));
      checkpoint(regenerateScenario.name);
      await record(regenerateScenario, await this.preview(user, job.sources, scratch.id, "regenerate"));
      await record(newTurnScenario, nextTurn);
      const historical = [];
      for (const cutoff of [...cutoffs].reverse()) {
        checkpoint(`Past turn through message ${cutoff}`);
        await rewind(cutoff);
        const result = await this.preview(user, job.sources, scratch.id), after = readSnapshot(result);
        const saved = await this.api.generate.getBreakdown(sourceMessages[cutoff].id, user);
        const recorded = saved?.messages?.map((message) => ({ ...message, role: message.role }));
        const step = {
          name: `History through message ${cutoff}`,
          purpose: "What actually happened next in your chat, added on top of the turn before it.",
          inputs: [],
          snapshot: after,
          comparison: compare(null, after),
          clipping: result.contextClipStats,
          changedSources: [],
          historyThrough: cutoff,
          recordedUsage: reportedUsage(saved, sourceMessages[cutoff].id),
          ...recorded ? { recordedPrompt: readSnapshot({ ...result, model: saved.model, provider: saved.provider, request_messages: recorded }) } : {}
        };
        historical.unshift({ cutoff, preview: result, step });
        report.history = historical.map((item) => item.step);
      }
      let earlierOutline = null;
      for (const [index, item] of historical.entries()) {
        item.step.comparison = compare(historical[index - 1]?.step.snapshot ?? null, item.step.snapshot);
        if (!index) {
          item.step.comparison.summary = "Reference prompt for the historical reconstruction, built using today's settings.";
          item.step.purpose = "The oldest of your recent turns. Past Turns build forward from here.";
        }
        item.step.changedSources = index ? changedBreakdown(historical[index - 1].preview, item.preview) : [];
        const earlier = historical[index - 1], outline = promptOutline(item.step.snapshot, item.preview.request_messages, item.preview.breakdown);
        const tolerated = earlier ? await this.tolerated(user, earlier.preview.request_messages, item.preview.request_messages, item.step.comparison, contextFor(item.preview)) : false;
        item.step.timeline = buildTimeline(earlier?.step.snapshot ?? null, earlierOutline, item.step.snapshot, outline, item.step.comparison, tolerated);
        earlierOutline = outline;
        if (item.step.comparison.kind === "break")
          report.health.findings.push({
            id: `historical-${item.cutoff}`,
            level: tolerated ? "info" : "issue",
            category: "Simulation",
            title: `${item.step.name}: reconstructed prefix changed`,
            source: item.step.changedSources.join(", ") || "Historical reconstruction",
            detail: item.step.comparison.summary,
            suggestion: "Compare the reconstructed prompts. Saved historical usage is shown separately where available."
          });
      }
      report.limitations.push(cutoffs.length ? `Reconstructed ${cutoffs.length} past turns with today's configuration. Historical settings, variable state, lore timing and memory indexes are not restored.` : "No earlier completed user/assistant turns were available for historical reconstruction.");
      if (signature(await this.api.chat.getMessages(job.sources.chat.id)) !== sourceBefore)
        report.limitations.push("The original conversation changed while the simulation ran; this report describes the branch created at the start.");
      if (signature(await collectSources(this.api, user, job.sources.input)) !== signature(job.sources))
        throw new Error("The chat configuration changed during simulation. The previews are retained, but rerun the check for a consistent result.");
      report.complete = true;
    } catch (error) {
      report.error = errorText(error);
    } finally {
      const errors = [];
      for (const ruleId of clonedRules)
        try {
          await this.api.regex_scripts.delete(ruleId, user);
        } catch (error) {
          errors.push(`Temporary regex ${ruleId}: ${errorText(error)}`);
        }
      try {
        const current = await this.api.chats.get(scratch.id, user);
        if (current) {
          if (current.name !== job.ticket.branchName || current.metadata.lumicache_simulation_source !== job.sources.chat.id || current.metadata.lumicache_simulation !== id)
            throw new Error("The copy's identity changed; it was preserved.");
          if (!await this.api.chats.delete(scratch.id, user))
            throw new Error("The temporary branch could not be deleted.");
        }
      } catch (error) {
        errors.push(errorText(error));
      }
      if (errors.length) {
        report.cleanupError = errors.join(`
`);
        report.scratchChatId = scratch.id;
      }
      this.jobs.delete(id);
    }
    return report;
  }
}
function changedBreakdown(before, after) {
  const group = (preview) => {
    const map = new Map;
    for (const entry of preview.breakdown) {
      if (entry.type === "chat_history")
        continue;
      const key = entry.blockId || `${entry.type}:${entry.name}`;
      map.set(key, [...map.get(key) ?? [], `${entry.role ?? ""}
${entry.content ?? ""}`]);
    }
    return map;
  };
  const old = group(before), next = group(after), names = new Map([...before.breakdown, ...after.breakdown].map((entry) => [entry.blockId || `${entry.type}:${entry.name}`, entry.name]));
  return [...new Set([...old.keys(), ...next.keys()])].filter((key) => stableJson(old.get(key)) !== stableJson(next.get(key))).map((key) => names.get(key) || key);
}

// src/agent-docs.ts
var DOCS_SURFACE = "lumicache_docs";
var AGENT_DOCS = [
  {
    id: "overview",
    label: "Monitoring, review and cache diffs",
    text: `LumiCache checks assembled outgoing prompt prefixes for cache risk. It does not control or observe provider cache state. Later host/provider transformations, tools, expiry and routing can still affect caching.
UI: drawer > LumiCache > Health | Simulation | Cache Diff; gear opens settings. Native sends, continuations, regenerations and swipes are monitored; dry runs are not. The first successful reply establishes a baseline. Only successful generations advance it; stopped/failed/cancelled requests do not. Baselines are per user/chat/sender, held in memory, and reset on extension restart or eviction.
Cache Diff shows first/same/append/break, first changed message, matching prefix, route changes and current status. Expand changed messages for body/metadata diffs; page, jump to next change/row, expand unchanged context, show whitespace, wrap lines or include unchanged messages.
Pause and review blocks an unacceptable break until the sending browser chooses Send anyway or Cancel send before the displayed deadline. Closing the modal is not cancellation. A disconnected review stays blocked; reconnect/open the chat to recover it before expiry. Warn and send shows a toast with the break depth and tokens to recache, without blocking. A LumiBooks planned break shows a success toast on the first send that sees it, in Warn and Pause modes. Off skips monitoring and consistency rewriting.
Reset comparison (gear) clears the chat's native and CAT baselines; the next successful request starts fresh. Finish/stop any generation first. LumiAgent cannot decide a paused send, reset comparisons or change settings.`
  },
  {
    id: "policy",
    label: "Settings, mutable tail and forced consistency",
    text: `Settings are per user; edit the gear panel then Save settings. Defaults: mode=warn, acceptableDepth=2, acceptableTokens=null, forceConsistency=false, overflowPlacement=end, refreshEnabled=true, refreshEvery=20, autoRefreshEnabled=false, autoRefreshMinutes=10, autoRefreshLimit=3.
Mutable tail: acceptableDepth counts history messages from the most recent (0 allows none; blank ignores depth). History token limit bounds that tail using Lumiverse's possibly approximate tokenizer (blank ignores tokens). Both set limits apply; both blank allow the history tail, not the leading instruction prefix. Ordinary tail tolerance requires existing history content/identity to remain unchanged. Connection/model/dispatch changes still count as breaks.
Force cache consistency restores the previous outgoing protected prefix, instructions/lore and prior history content; newly appended history remains. Fresh out-of-range injections move after the last message (end) or to the allowed boundary (boundary). Visible chat edits remain intact but may not reach the model until refresh/reset; frozen guidance may remain in old history. Requires preserved history source IDs and indexes; another extension stripping them can make it fail. Context limits still apply.
Allow scheduled cache breaks accepts current content after refreshEvery successful replies, then establishes a new baseline on success. It only runs with forced consistency, since a prompt that is not frozen has nothing to release. A published LumiBooks epoch replaces the timer; route changes still require normal review. Reset comparison applies current content on the next successful send.
Keep Cache Warm (autoRefreshEnabled) resends the last successful prompt of the chat the user sent in last, with minimal output, every autoRefreshMinutes up to autoRefreshLimit times per reply. Each one is billed. Turn it on or off from the input bar drawer or settings; while it runs, a banner above the input shows a spinner and a Stop button that turns it off. A new reply restarts the count; deleting a message stops the current run, and it stops itself after a cache miss, an error or a model change. It needs monitoring on and cannot repeat native tools.
Health category filters (risk/issue/depth) affect display only. They do not change the send policy.`
  },
  {
    id: "health",
    label: "Health findings and cache-friendly edits",
    text: `Health automatically rechecks the active chat/connection after relevant settings/content changes and completed generations; Refresh runs it again. Checks wait while generation, review or simulation is active. It scans effective preset blocks, enabled world info, character/persona text, included history, prompt regex and Compose selections/filters, then uses a native assembly preview for clipping/depth evidence.
Findings identify source/group/item, evidence, explanation and suggestion. Issue=known changing behavior; risk=depends on runtime values; Variabled=a conditional checking a variable or preset setting ({{var::name}}) with no sign that it changes on its own, stable until it is changed, and it never makes dependent text a risk; fixed values such as {{char}}, {{scenario}}, {{description}} and {{groupCardMode}} are not flagged, except that card fields follow the focused character in swap-mode group chats; Depth Mutable=in-history insertion compared with your depth/token limits. Expand groups/items; pill buttons filter categories. Read unknown/incomplete/omitted findings as coverage limits, not a clean bill of health.
Typical causes: random/time/history-dependent macros or conditions; keyword/vector lore activation; moving depth injections; prompt regex changing earlier text; Compose transformations; history clipping or over-budget fixed content; connection/model changes. Missing cache-friendly memory management produces a LumiBooks recommendation when its absence is established. Cache-read/write usage is reported when saved provider metadata supplies it, separately from predicted risk.
For cache-friendly edits: inspect the named source; keep stable instructions/lore early, move changing guidance into the allowed tail, avoid rewriting old history, and leave room for growth. Constant lore avoids activation churn but consumes context and world-info budgets. Re-audit, simulate, then inspect a real outgoing diff. Neither a clean audit nor a stable preview guarantees future stability or a cache hit. The bridge provides evidence; it does not edit presets, lore, chats or policy.`
  },
  {
    id: "simulation",
    label: "Future/past previews, cancellation and cleanup",
    text: `Simulation > Simulate caching requires a character-backed chat and creates a disposable chat copy and temporary preset profile. Five native previews: baseline; identical-input rebuild; one new turn; sampled conditional lore; longer history. Up to three earlier completed turns are reconstructed with today's settings. Future/Past selects the lane; choose a step for diffs, changed sources, clipping, test inputs and available saved original prompt/cache usage. Run details lists sampled lore and limitations; Run again refreshes the experiment.
No chat-model generation requests are made; configured retrieval/embedding and prompt extensions may run. Original conversation is preserved. Copies have different IDs, omit owned audio attachments and chat-memory indexes, and do not rewind per-swipe variables. Dry runs do not advance persistent variables or sticky/cooldown state like real turns. Lore sampling is partial; synthetic replies are placeholders. Historical previews do not reproduce historical settings/state.
Keep Lumiverse connected and wait for cleanup. Cancel stops after the current preview and cleanup; it does not cancel a live send. Failed/incomplete reports and cleanupError are not successful runs. If scratchChatId or a temporary preset profile remains, inspect the reported copy and remove that diagnostic artifact through the UI. Do not delete the original chat. Diagnostics are outside LumiAgent Workshop undo; reports/jobs/references can expire or be evicted.`
  },
  {
    id: "agent",
    label: "LumiAgent tools and bounded evidence workflow",
    text: `Read only the needed topic: list_external(surface_id="lumicache_docs"), then read_external(surface_id="lumicache_docs",item_id=<id>); field may be omitted or "text". Docs need no focused character/chat.
inspect_cache(action="live"|"report",chat_id): current check/baseline references or latest audit/simulation. chat_id may be omitted only with a pinned chat. run_cache_diagnostic(action="audit"|"simulation",chat_id,connection_id?): starts a background job; connection_id is the chat model to test. Requires LumiCache enabled and a connected Lumiverse browser; only one diagnostic per user at a time. Simulation follows normal change approval.
Poll inspect_cache(action="job",job_id=<returned id>), respecting pollAfterMs. On completed, inspect_cache(action="report",chat_id). Cancellation: run_cache_diagnostic(action="cancel",job_id); poll until terminal (completed/failed/cancelled), including cleanup. Report returns at most 30 findings; page with inspect_cache(action="findings",chat_id,kind="audit"|"simulation",cursor=<returned nextFindingsCursor/nextCursor>).
Diff workflow: inspect_cache(action="diff_list",before?,after,cursor?,include_unchanged?) using returned snapshot references; diff_open(before?,after,old_index?,new_index?,part="body"|"header") using returned zero-based message indexes; diff_page(diff_id=<returned id>,cursor=<page.next>,fold=<returned fold id>?) for up to 20 rows. Omit before to inspect one prompt. Use returned IDs/cursors, fetch only relevant pages; expired references require fresh live/report evidence or a rerun.
Fallback read-only surface lumicache_reports lists retained chats; read_external(item_id=<chat id>,field="report"|"live"). Writes, monitoring changes, baseline resets and send approvals are unavailable via this bridge.`
  },
  {
    id: "integrations",
    label: "LumiBooks, CAT and troubleshooting",
    text: `LumiBooks Cache Friendly mode checks lumicache.status. A changed lumi_books.cache_epoch.<chatId> marks an intentional break: accept the new prefix without review/restoring the old one, then replace the baseline only after a successful reply. A non-null epoch replaces timed refresh; without an epoch the timer still applies. Connection/model changes still go through normal review.
CAT sends raw parallel swipes outside the native interceptor. Its bridge submits each final prompt to LumiCache first. Every CAT profile has its own baseline, separate from native sends; only finished swipes advance it. Reviews run one profile at a time. Cache Diff prioritizes a waiting review, otherwise the latest inspected prompt. Policy/forced consistency apply to CAT too.
No comparison: enable monitoring and complete a successful send. No diagnostic browser: open Lumiverse with LumiCache enabled and keep it connected. Bridge unavailable: verify installed/enabled extensions and the permissions reported by the host. Already-active diagnostic: poll/cancel its job before starting another. Expired diff: refresh evidence rather than reuse stale references. Review expiry cancels the request; retry to review again. Missing source IDs/indexes: preserve metadata in the transforming extension or disable Force cache consistency for that prompt. Context clipping: reduce fixed content/history pressure; consistency cannot exceed the model's context limit. Stable prompts are evidence of lower risk, never proof of provider cache hits.`
  }
];

// src/agent-bridge.ts
var BRIDGE_PERMISSIONS = ["characters", "chats", "generation", "presets", "personas", "world_books", "regex_scripts", "chat_mutation"];
var CACHE_SURFACE = "lumicache_reports";
var bridgeSession = (user) => `lumicache-agent:${user}`;
function id(value) {
  if (typeof value !== "string" || !value || value.length > 200)
    throw new Error("A valid identifier is required.");
  return value;
}
function index(value) {
  if (value === undefined)
    return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid page or message index.");
  return value;
}
var terminal = (job) => ["completed", "failed", "cancelled"].includes(job.phase);

class AgentBridge {
  api;
  guard;
  health;
  prompts;
  jobs = new Map;
  browsers = new Map;
  reports = new Map;
  constructor(api, guard, health, prompts) {
    this.api = api;
    this.guard = guard;
    this.health = health;
    this.prompts = prompts;
  }
  key(user, chat) {
    return JSON.stringify([user, chat]);
  }
  prune() {
    for (const [key, value] of this.browsers)
      if (value.at < Date.now() - 65000)
        this.browsers.delete(key);
    for (const [key, value] of this.jobs)
      if (terminal(value) && value.updated < Date.now() - 1800000)
        this.jobs.delete(key);
    for (const [key, value] of this.reports)
      if (value.at < Date.now() - 1800000)
        this.reports.delete(key);
    while (this.reports.size > 12)
      this.reports.delete(this.reports.keys().next().value);
    while (this.jobs.size > 32) {
      const old = [...this.jobs].find(([, job]) => terminal(job));
      if (!old)
        break;
      this.jobs.delete(old[0]);
    }
  }
  presence(user, session, input) {
    this.prune();
    const key = this.key(user, session);
    if (input.offline) {
      this.browsers.delete(key);
      return;
    }
    if (input.chatId !== undefined)
      id(input.chatId);
    if (input.connectionId !== undefined)
      id(input.connectionId);
    this.browsers.delete(key);
    this.browsers.set(key, { user, session, chatId: input.chatId, connectionId: input.connectionId, at: Date.now() });
    while (this.browsers.size > 64)
      this.browsers.delete(this.browsers.keys().next().value);
  }
  async owned(user, chatId) {
    if (!await this.api.chats.get(chatId, user))
      throw new Error("This chat is unavailable to the requesting user.");
  }
  job(user, jobId, session) {
    this.prune();
    const job = this.jobs.get(jobId);
    if (!job || job.user !== user || session !== undefined && job.session !== session)
      throw new Error("This diagnostic job expired or belongs to another user or browser.");
    return job;
  }
  timer(job, ms, callback) {
    clearTimeout(job.timer);
    job.timer = setTimeout(callback, ms);
    job.timer.unref?.();
  }
  end(job, error) {
    clearTimeout(job.timer);
    job.updated = Date.now();
    job.error = error || job.error;
    job.phase = job.cancelled ? "cancelled" : job.error ? "failed" : "completed";
    job.progress = job.phase === "completed" ? "Diagnostic finished." : job.error ?? "Diagnostic cancelled.";
  }
  view(job) {
    return {
      id: job.id,
      kind: job.kind,
      chatId: job.input.chatId,
      connectionId: job.input.connectionId,
      phase: job.phase,
      at: job.at,
      updated: job.updated,
      progress: job.progress,
      error: job.error,
      pollAfterMs: terminal(job) ? undefined : 1500,
      ...job.scratchId && job.error ? { scratchChatId: job.scratchId } : {}
    };
  }
  async start(user, request) {
    const chatId = id(request.chatId), kind = request.kind;
    if (kind !== "audit" && kind !== "simulation")
      throw new Error("Choose audit or simulation.");
    const callId = id(request.callId);
    await this.owned(user, chatId);
    this.prune();
    const duplicate = [...this.jobs.values()].find((job) => job.user === user && job.callId === callId);
    if (duplicate) {
      if (duplicate.kind !== kind || duplicate.input.chatId !== chatId || request.connectionId !== undefined && request.connectionId !== duplicate.input.connectionId)
        throw new Error("This diagnostic call ID was already used for a different request.");
      return this.view(duplicate);
    }
    if ([...this.jobs.values()].some((job) => job.user === user && !terminal(job)))
      throw new Error("A diagnostic is already active. Poll or cancel that job first.");
    if ([...this.jobs.values()].filter((job) => !terminal(job)).length >= 8)
      throw new Error("Too many cache diagnostics are active. Try again later.");
    const candidates = [...this.browsers.values()].filter((browser) => browser.user === user).reverse();
    const browser = candidates.find((browser) => browser.chatId === chatId) ?? candidates[0];
    if (!browser)
      throw new Error("Open Lumiverse with LumiCache enabled and keep the browser connected to run diagnostics.");
    const connectionId = request.connectionId === undefined ? browser.chatId === chatId ? browser.connectionId : undefined : id(request.connectionId);
    const job = {
      id: crypto.randomUUID(),
      user,
      session: browser.session,
      callId,
      kind,
      input: { chatId, ...connectionId ? { connectionId } : {} },
      phase: "queued",
      at: Date.now(),
      updated: Date.now(),
      progress: "Waiting for the connected browser.",
      cancelled: false
    };
    this.jobs.set(job.id, job);
    this.prune();
    this.timer(job, 15000, () => this.end(job, "The browser did not acknowledge the diagnostic. Reconnect Lumiverse and retry."));
    try {
      this.api.sendToFrontend({ type: "agentDiagnostic", id: job.id }, user, { frontendSessionId: job.session });
    } catch (error) {
      this.end(job, errorText(error));
    }
    return this.view(job);
  }
  claim(user, session, jobId) {
    const job = this.job(user, jobId, session);
    if (job.phase !== "queued")
      throw new Error("This diagnostic was already claimed or cancelled.");
    job.phase = "running";
    job.updated = Date.now();
    job.progress = "Preparing the diagnostic.";
    this.timer(job, 360000, () => {
      job.error = "The diagnostic timed out. Native preview cleanup may still be finishing.";
      this.cancelJob(job);
      if (!job.submitted)
        this.end(job, `${job.error} Check for a remaining LumiCache simulation copy if setup was interrupted.`);
    });
    return { kind: job.kind, input: job.input };
  }
  authorize(user, session, jobId, kind, input) {
    const job = this.job(user, jobId, session);
    if (job.kind !== kind || job.phase !== "running" || job.cancelled || job.input.chatId !== input.chatId || job.input.connectionId !== input.connectionId)
      throw new Error("This diagnostic no longer matches its approved request.");
    return job;
  }
  attach(user, session, jobId, ticket) {
    const job = this.job(user, jobId, session);
    job.ticket = ticket.id;
    if (job.cancelled || terminal(job)) {
      this.health.cancel(user, session, ticket.id);
      throw new Error("Diagnostic cancelled before simulation setup.");
    }
  }
  submitted(user, session, ticketId, scratchId) {
    const job = [...this.jobs.values()].find((job) => job.user === user && job.session === session && job.ticket === ticketId);
    if (job) {
      if (job.cancelled || terminal(job))
        throw new Error("Diagnostic cancelled before submission.");
      job.submitted = true;
      job.scratchId = scratchId;
    }
  }
  progress(user, session, completed, name) {
    const job = [...this.jobs.values()].find((job) => job.user === user && job.session === session && !terminal(job));
    if (job) {
      job.progress = `Building preview ${completed + 1}: ${name}`;
      job.updated = Date.now();
    }
  }
  cancelledTicket(user, session, ticketId) {
    const job = [...this.jobs.values()].find((job) => job.user === user && job.session === session && job.ticket === ticketId && !terminal(job));
    if (job) {
      job.cancelled = true;
      job.phase = "cancelling";
      job.updated = Date.now();
      job.progress = "Cancelling after the current native preview and cleanup.";
    }
  }
  remember(user, chatId, patch) {
    const key = this.key(user, chatId), old = this.reports.get(key);
    this.reports.delete(key);
    this.reports.set(key, { ...old, ...patch, user, chatId, at: Date.now() });
    this.prune();
  }
  auditResult(user, report, jobId) {
    this.remember(user, report.chatId, { audit: report });
    if (jobId) {
      const job = this.job(user, jobId);
      job.result = report;
      this.end(job);
    }
  }
  simulationResult(user, session, ticketId, report) {
    const packed = this.prompts.pack(report, user, bridgeSession(user));
    this.remember(user, report.sourceChatId, { simulation: packed });
    const job = [...this.jobs.values()].find((job) => job.user === user && job.session === session && job.ticket === ticketId);
    if (job) {
      job.result = packed;
      job.phase = "cleaning";
      job.updated = Date.now();
      job.progress = "Removing the temporary preset profile.";
      this.timer(job, 65000, () => this.end(job, "The browser did not confirm profile cleanup. Check the temporary preset profile and any reported simulation copy."));
    }
  }
  finish(user, session, jobId, input) {
    const job = this.job(user, jobId, session);
    if (terminal(job))
      return;
    const error = input.error?.slice(0, 2000), cleanupError = input.cleanupError?.slice(0, 2000);
    if (job.kind === "simulation" && job.result) {
      const result = job.result;
      if (cleanupError) {
        result.cleanupError = cleanupError;
        result.scratchChatId = input.scratchChatId;
      }
      this.end(job, error || result.error || result.cleanupError || (!result.complete ? "Simulation incomplete." : undefined));
    } else
      this.end(job, error || "The browser stopped before completing this diagnostic.");
  }
  cancelJob(job) {
    if (terminal(job))
      return;
    const queued = job.phase === "queued";
    job.cancelled = true;
    job.phase = "cancelling";
    job.updated = Date.now();
    job.progress = "Cancelling after the current native preview and cleanup.";
    if (job.ticket) {
      try {
        this.health.cancel(job.user, job.session, job.ticket);
      } catch {}
    }
    if (queued || job.kind === "simulation" && !job.submitted && !job.ticket)
      this.end(job);
  }
  report(user, chatId) {
    this.prune();
    const cached = this.reports.get(this.key(user, chatId));
    const health = (report) => report ? {
      ...report,
      findings: report.findings.slice(0, 30),
      findingsTotal: report.findings.length,
      nextFindingsCursor: report.findings.length > 30 ? 30 : undefined
    } : undefined;
    const simulation = cached?.simulation;
    return { chatId, coverage: COVERAGE, audit: health(cached?.audit), simulation: simulation ? {
      ...simulation,
      health: health(simulation.health),
      steps: simulation.steps.map(({ inputs: _inputs, timeline: _timeline, ...step }) => step),
      history: simulation.history.map(({ inputs: _inputs, timeline: _timeline, ...step }) => step)
    } : undefined };
  }
  async request(requester, raw) {
    if (requester !== "lumiagent")
      throw new Error("Only LumiAgent may use this bridge.");
    if (!raw || typeof raw !== "object")
      throw new Error("Malformed cache bridge request.");
    const request = raw;
    if (request.op === "describe")
      return { extension: { id: "lumicache", name: "LumiCache", version: "0.7.1" }, surfaces: [
        {
          id: CACHE_SURFACE,
          label: "Cache diagnostics",
          scope: "global",
          description: "Read-only cache reports and live prefix checks by chat ID. Use inspect_cache for paged prompt diffs and run_cache_diagnostic to start or cancel an audit/simulation. Diagnostics do not prove provider cache hits. Sending decisions stay in LumiCache."
        },
        { id: DOCS_SURFACE, label: "LumiCache guide", scope: "global", description: "Read-only compact LLM docs. list_external for topics; read_external by topic ID. Monitoring, settings, health, simulation, tools and integrations." }
      ] };
    const user = id(request.userId);
    if (request.op === "system_prompt")
      return { text: 'LumiCache: inspect_cache reads evidence; run_cache_diagnostic starts/cancels diagnostics (connected browser required). Guide: list_external(surface_id="lumicache_docs"), read_external by topic ID. Stable prompts do not prove cache hits; only the user approves paused sends.' };
    if (request.op === "check_write")
      return { ok: false, message: "Cache evidence is read-only. Use run_cache_diagnostic to request a new diagnostic." };
    if (request.op === "write_field")
      return { ok: false, error: "Cache evidence is read-only. Use run_cache_diagnostic to request a new diagnostic." };
    if (request.op === "check_read")
      return { ok: true };
    if (request.op === "list_items") {
      if (request.surfaceId === DOCS_SURFACE)
        return { items: AGENT_DOCS.map(({ id, label }) => ({ id, label })), total: AGENT_DOCS.length };
      if (request.surfaceId !== CACHE_SURFACE)
        throw new Error("Unknown LumiCache surface.");
      this.prune();
      const ids = new Set([...this.guard.chatIds(user), ...[...this.reports.values()].filter((r) => r.user === user).map((r) => r.chatId)]);
      const items = [];
      for (const chatId of ids) {
        const chat = await this.api.chats.get(chatId, user);
        if (chat)
          items.push({ id: chatId, label: chat.name || chatId });
      }
      return { items, total: items.length };
    }
    if (request.op === "read_item") {
      if (request.surfaceId === DOCS_SURFACE) {
        if (request.field !== undefined && request.field !== "text")
          throw new Error("Read a LumiCache guide topic with field omitted or text.");
        const topic = AGENT_DOCS.find((topic) => topic.id === request.itemId);
        if (!topic)
          throw new Error("Unknown LumiCache guide topic. Use list_external on lumicache_docs.");
        return { value: topic.text };
      }
      if (request.surfaceId !== CACHE_SURFACE)
        throw new Error("Unknown LumiCache surface.");
      const chatId = id(request.itemId);
      await this.owned(user, chatId);
      if (request.field === "live")
        return { value: this.prompts.pack(this.guard.view(user, chatId), user, bridgeSession(user)) };
      if (request.field !== undefined && request.field !== "report")
        throw new Error("Read report or live. Use inspect_cache for paged diffs and findings.");
      return { value: this.report(user, chatId) };
    }
    if (request.op !== "cache")
      throw new Error("Unknown LumiCache bridge operation.");
    const session = bridgeSession(user);
    switch (request.action) {
      case "start":
        return this.start(user, request);
      case "job": {
        const job = this.job(user, id(request.jobId));
        await this.owned(user, job.input.chatId);
        return this.view(job);
      }
      case "cancel": {
        const job = this.job(user, id(request.jobId));
        await this.owned(user, job.input.chatId);
        this.cancelJob(job);
        return this.view(job);
      }
      case "live": {
        const chat = id(request.chatId);
        await this.owned(user, chat);
        return this.prompts.pack(this.guard.view(user, chat), user, session);
      }
      case "report": {
        const chat = id(request.chatId);
        await this.owned(user, chat);
        return this.report(user, chat);
      }
      case "findings": {
        const chat = id(request.chatId);
        await this.owned(user, chat);
        this.prune();
        const cached = this.reports.get(this.key(user, chat));
        const report = request.kind === "audit" ? cached?.audit : request.kind === "simulation" ? cached?.simulation?.health : undefined;
        if (!report)
          throw new Error("That diagnostic report is not available.");
        const cursor = index(request.cursor) ?? 0;
        return { findings: report.findings.slice(cursor, cursor + 30), total: report.findings.length, nextCursor: cursor + 30 < report.findings.length ? cursor + 30 : undefined };
      }
      case "diff_list":
        return this.prompts.list(user, session, { before: request.before === undefined ? undefined : id(request.before), after: id(request.after), cursor: index(request.cursor), includeUnchanged: request.includeUnchanged === true });
      case "diff_open": {
        const input = { before: request.before === undefined ? undefined : id(request.before), after: id(request.after), oldIndex: index(request.oldIndex), newIndex: index(request.newIndex), part: request.part === "header" ? "header" : "body" };
        return this.prompts.open(user, session, input, 20);
      }
      case "diff_page":
        return this.prompts.page(user, session, { id: id(request.diffId), cursor: index(request.cursor), fold: index(request.fold), limit: 20 });
      default:
        throw new Error("Unknown cache action. The bridge cannot approve sends, change monitoring or clear baselines.");
    }
  }
  register() {
    this.api.rpcPool.handle("phoneline", async (context) => {
      if (context.requesterExtensionId !== "lumiagent")
        throw new Error("Only LumiAgent may use this bridge.");
      const request = await this.api.rpcPool.read("lumiagent.phoneline_request");
      return this.request(context.requesterExtensionId, request);
    }, { requires: BRIDGE_PERMISSIONS });
  }
}

// src/auto-refresh.ts
class AutoRefresh {
  host;
  minute;
  jobs = new Map;
  constructor(host, minute = 60000) {
    this.host = host;
    this.minute = minute;
  }
  start(user, chat, settings) {
    const replaced = this.drop(user);
    if (!settings.autoRefreshEnabled) {
      if (replaced)
        this.host.changed(user, null);
      return;
    }
    const job = { chat, every: settings.autoRefreshMinutes * this.minute, limit: settings.autoRefreshLimit, done: 0 };
    this.jobs.set(user, job);
    this.wait(user, job);
  }
  cancel(user, chat) {
    const job = this.jobs.get(user);
    if (!job || chat !== undefined && job.chat !== chat)
      return;
    this.drop(user);
    this.host.changed(user, null);
  }
  restart(user, settings) {
    const job = this.jobs.get(user);
    if (job)
      this.start(user, job.chat, settings);
  }
  state(user) {
    const job = this.jobs.get(user);
    return job ? { chatId: job.chat, done: job.done, limit: job.limit, nextIn: job.next === undefined ? null : Math.max(0, job.next - Date.now()) } : null;
  }
  drop(user) {
    const job = this.jobs.get(user);
    if (!job)
      return false;
    this.jobs.delete(user);
    clearTimeout(job.timer);
    job.request?.abort();
    return true;
  }
  interrupt(user, chat) {
    const job = this.jobs.get(user);
    if (job?.chat === chat)
      job.request?.abort();
  }
  wait(user, job) {
    job.next = Date.now() + job.every;
    job.timer = setTimeout(() => {
      this.run(user, job);
    }, job.every);
    job.timer.unref?.();
    this.host.changed(user, this.state(user));
  }
  async run(user, job) {
    const live = () => this.jobs.get(user) === job;
    if (!live())
      return;
    if (this.host.busy(user, job.chat))
      return this.wait(user, job);
    const prompt = this.host.prompt(user, job.chat);
    if (!prompt) {
      this.jobs.delete(user);
      this.host.changed(user, null);
      return;
    }
    const request = job.request = new AbortController;
    job.next = undefined;
    this.host.changed(user, this.state(user));
    try {
      const preview = await this.host.generate.dryRun({ chatId: job.chat, connectionId: prompt.connectionId }, user);
      if (request.signal.aborted) {
        if (live())
          this.wait(user, job);
        return;
      }
      if (preview.model !== prompt.model)
        return this.stop(user, job, "The chat's model changed, so its cached prompt no longer applies.");
      const { max_context_length: _context, model: _model, ...parameters } = preview.parameters;
      const budget = parameters.thinking?.budget_tokens;
      const max_tokens = typeof budget === "number" ? budget + 1 : 1;
      const result = await this.host.generate.quiet({
        type: "quiet",
        messages: prompt.messages,
        connection_id: prompt.connectionId,
        parameters: { ...parameters, model: prompt.model, max_tokens },
        userId: user,
        signal: request.signal
      });
      if (!live())
        return;
      job.done++;
      const usage = reportedUsage({ usage: result?.usage, model: prompt.model }, "");
      if (usage?.read === 0)
        return this.stop(user, job, "The last refresh missed the cache, so further refreshes would not help. Try a shorter interval, or this chat may use tools that a refresh can't repeat.");
      const read = usage?.read === undefined ? "" : ` Read ${usage.read.toLocaleString("en-US")} cached tokens.`;
      this.host.toast(user, "success", `Cache kept warm (${job.done} of ${job.limit})`, `Kept this chat's prompt cached.${read}`);
      if (job.done < job.limit)
        this.wait(user, job);
      else {
        this.jobs.delete(user);
        this.host.changed(user, null);
      }
    } catch (error) {
      if (request.signal.aborted) {
        if (live())
          this.wait(user, job);
        return;
      }
      if (live())
        this.stop(user, job, errorText(error));
    } finally {
      if (job.request === request)
        job.request = undefined;
    }
  }
  stop(user, job, reason) {
    if (this.jobs.get(user) === job) {
      this.jobs.delete(user);
      this.host.changed(user, null);
    }
    this.host.toast(user, "warning", "Keep Cache Warm stopped", reason);
  }
}

// src/cat-bridge.ts
var CAT_EXTENSION = "another_one";
var REQUEST = `${CAT_EXTENSION}.cache_request`;
var POLICY = { requires: ["generation"] };
var REVIEW_LIMIT_MS = 295000;

class CatBridge {
  api;
  guard;
  settings;
  epoch;
  queue = [];
  controllers = new Map;
  lastBySlot = new Map;
  constructor(api, guard, settings, epoch) {
    this.api = api;
    this.guard = guard;
    this.settings = settings;
    this.epoch = epoch;
  }
  register(drainMs = 50) {
    this.api.rpcPool.handle("cat", async (ctx) => {
      if (ctx.requesterExtensionId !== CAT_EXTENSION)
        throw new Error("Unauthorized LumiCache caller.");
      const request = await this.api.rpcPool.read(REQUEST);
      if (!request || typeof request !== "object")
        throw new Error("Invalid CAT cache request.");
      this.queue.push(request);
      return { accepted: true };
    }, POLICY);
    const timer = setInterval(() => this.drain(), drainMs);
    timer.unref?.();
    return this;
  }
  drain() {
    for (const request of this.queue.splice(0)) {
      if (request.op === "check")
        this.check(request);
      else if (request.op === "cancel")
        this.controllers.get(request.id)?.abort();
      else
        this.finish(request);
    }
  }
  generation(id) {
    return `cat:${id}`;
  }
  publish(id, value) {
    this.api.rpcPool.sync(`cat_result.${id}`, value, POLICY);
  }
  async check(request) {
    const controller = new AbortController;
    this.controllers.set(request.id, controller);
    try {
      const settings = await this.settings(request.userId);
      const slot = JSON.stringify([request.userId, request.chatId, request.slotId]);
      const previous = this.lastBySlot.get(slot);
      if (previous)
        this.guard.finish(request.userId, this.generation(previous), false);
      this.lastBySlot.set(slot, request.id);
      const messages = await this.guard.inspect(request.messages, {
        userId: request.userId,
        chatId: request.chatId,
        generationId: this.generation(request.id),
        frontendSessionId: request.session,
        isDryRun: false,
        signal: controller.signal,
        interceptorDeadlineAt: Date.now() + REVIEW_LIMIT_MS,
        mainDispatch: await connectionDispatch(this.api, request.connectionId, request.userId, request.model),
        scope: request.slotId,
        label: request.label
      }, settings, await this.epoch(request.chatId));
      this.publish(request.id, { status: "done", messages });
    } catch (error) {
      this.publish(request.id, { status: "error", error: errorText(error) });
    } finally {
      this.controllers.delete(request.id);
    }
  }
  finish(request) {
    this.guard.finish(request.userId, this.generation(request.id), request.success);
    this.api.rpcPool.unregister(`cat_result.${request.id}`);
  }
}

// src/backend.ts
var prompts = new PromptStore;
var guard = new Guard((user, chatId, session) => spindle.sendToFrontend({ type: "changed", chatId }, user, session ? { frontendSessionId: session } : undefined), (messages, context) => spindle.tokens.countMessages(messages, { userId: context.userId, model: context.mainDispatch.descriptor?.model }), new BaselineStore(spindle), (user, tone, title, message) => spindle.toast[tone](message, { title, userId: user }));
var settingsCache = new Map;
var contexts = new HostContexts;
var agent;
var health = new HealthService(spindle, (user, chat) => contexts.isActive(user, chat), (user, session, completed, name) => {
  agent?.progress(user, session, completed, name);
  spindle.sendToFrontend({ type: "simulationProgress", completed, name }, user, { frontendSessionId: session });
}, settings);
var autoRefresh = new AutoRefresh({
  generate: spindle.generate,
  prompt: (user, chat) => guard.prompt(user, chat),
  busy: (user, chat) => contexts.isActive(user, chat),
  toast: (user, tone, title, message) => {
    spindle.toast[tone](message, { title, userId: user });
  },
  changed: (user, state) => {
    spindle.sendToFrontend({ type: "keepWarm", state }, user);
  }
});
agent = new AgentBridge(spindle, guard, health, prompts);
agent.register();
function settings(user) {
  let current = settingsCache.get(user);
  if (!current) {
    current = spindle.userStorage.getJson("settings.json", { fallback: DEFAULT_SETTINGS, userId: user }).then(validateSettings);
    settingsCache.set(user, current);
    current.catch(() => {
      if (settingsCache.get(user) === current)
        settingsCache.delete(user);
    });
  }
  return current;
}
spindle.rpcPool.sync("status", { version: 1 }, { requires: [] });
async function plannedBreakEpoch(chatId) {
  try {
    const value = await spindle.rpcPool.read(`lumi_books.cache_epoch.${chatId}`);
    return typeof value?.epoch === "string" ? value.epoch : null;
  } catch (error) {
    if (/not registered/i.test(errorText(error)))
      return null;
    throw error;
  }
}
function text(value) {
  if (typeof value !== "string" || !value || value.length > 200)
    throw new Error("Invalid LumiCache request.");
  return value;
}
new CatBridge(spindle, guard, settings, plannedBreakEpoch).register();
if (!spindle.host.capabilities["interceptor-context-v1"])
  throw new Error("LumiCache requires a Lumiverse build with bound interceptor context.");
spindle.on("CHAT_DELETED", (event, user) => {
  const id = event?.id;
  if (user && typeof id === "string") {
    guard.forget(user, id);
    autoRefresh.cancel(user, id);
  }
});
spindle.on("MESSAGE_DELETED", (event, user) => {
  const chat = event?.chatId;
  if (user && typeof chat === "string")
    autoRefresh.cancel(user, chat);
});
spindle.on("GENERATION_STARTED", (event, user) => {
  if (user) {
    contexts.start(user, event);
    autoRefresh.interrupt(user, event.chatId);
  }
});
spindle.registerInterceptor(async (messages, context) => {
  const raw = context;
  if (raw.isDryRun || raw.dryRun)
    return messages;
  const config = await settings(raw.userId);
  if (config.mode === "off") {
    guard.unwatched(raw.userId, raw.chatId);
    return messages;
  }
  return guard.inspect(messages, await contexts.resolve(raw, spindle), config, await plannedBreakEpoch(raw.chatId));
}, {
  priority: 2000000000,
  required: true,
  match: { generationTypes: ["normal", "continue", "regenerate", "swipe"] }
});
spindle.on("GENERATION_ENDED", (event, user) => {
  if (!user)
    return;
  contexts.finish(user, event);
  if (guard.finish(user, event.generationId, !event.error, event.messageId))
    settings(user).then((config) => autoRefresh.start(user, event.chatId, validateSettings(config)), (error) => console.warn("[LumiCache] Could not start auto-refresh:", error));
});
spindle.on("GENERATION_STOPPED", (event, user) => {
  if (user) {
    contexts.finish(user, event);
    guard.finish(user, event.generationId, false);
  }
});
spindle.on("FRONTEND_SESSION_CLOSED", (event, user) => {
  const session = event?.frontendSessionId;
  if (user && typeof session === "string")
    guard.disconnect(user, session);
});
spindle.onFrontendMessage((raw, user, session) => {
  if (!raw || typeof raw !== "object")
    return;
  const request = raw;
  if (!session)
    return;
  if (request.type !== "request" || typeof request.id !== "string" || request.id.length > 200)
    return;
  (async () => {
    let value;
    try {
      const input = request.input ?? {};
      switch (request.operation) {
        case "agentPresence":
          agent.presence(user, session, input);
          break;
        case "agentClaim":
          value = agent.claim(user, session, text(input.id));
          break;
        case "agentFinish":
          agent.finish(user, session, text(input.id), input);
          break;
        case "diffList":
          value = prompts.list(user, session, input);
          break;
        case "diffOpen":
          value = prompts.open(user, session, input);
          break;
        case "diffPage":
          value = prompts.page(user, session, input);
          break;
        case "load": {
          const chatId = input.chatId === undefined ? undefined : text(input.chatId);
          if (chatId)
            guard.resume(user, chatId, session);
          value = { settings: await settings(user), keepWarm: autoRefresh.state(user), ...guard.view(user, chatId, session) };
          break;
        }
        case "settings": {
          const before = validateSettings(await settings(user)), next = validateSettings(input);
          await spindle.userStorage.setJson("settings.json", next, { userId: user });
          settingsCache.set(user, Promise.resolve(next));
          value = next;
          if (before.autoRefreshEnabled !== next.autoRefreshEnabled || before.autoRefreshMinutes !== next.autoRefreshMinutes || before.autoRefreshLimit !== next.autoRefreshLimit)
            autoRefresh.restart(user, next);
          spindle.sendToFrontend({ type: "changed" }, user);
          break;
        }
        case "keepWarm": {
          if (typeof input.enabled !== "boolean")
            throw new Error("Invalid Keep Cache Warm request.");
          const chatId = input.chatId === undefined ? undefined : text(input.chatId);
          const next = { ...validateSettings(await settings(user)), autoRefreshEnabled: input.enabled };
          await spindle.userStorage.setJson("settings.json", next, { userId: user });
          settingsCache.set(user, Promise.resolve(next));
          if (!next.autoRefreshEnabled)
            autoRefresh.cancel(user);
          else if (chatId && guard.prompt(user, chatId))
            autoRefresh.start(user, chatId, next);
          value = { settings: next, state: autoRefresh.state(user) };
          spindle.sendToFrontend({ type: "changed" }, user);
          break;
        }
        case "decide":
          if (typeof input.allow !== "boolean")
            throw new Error("Invalid review decision.");
          guard.decide(user, session, text(input.id), input.allow);
          break;
        case "clear":
          guard.clear(user, text(input.chatId));
          break;
        case "audit": {
          const auditInput = { chatId: text(input.chatId), ...input.connectionId ? { connectionId: text(input.connectionId) } : {} };
          const jobId = input.agentJobId === undefined ? undefined : text(input.agentJobId);
          if (jobId)
            agent.authorize(user, session, jobId, "audit", auditInput);
          const report = await health.audit(user, { ...auditInput, composition: compositionSnapshot(input.composition) });
          agent.auditResult(user, report, jobId);
          value = report;
          break;
        }
        case "prepareSimulation": {
          const auditInput = { chatId: text(input.chatId), ...input.connectionId ? { connectionId: text(input.connectionId) } : {} };
          const jobId = input.agentJobId === undefined ? undefined : text(input.agentJobId);
          if (jobId)
            agent.authorize(user, session, jobId, "simulation", auditInput);
          const ticket = await health.prepare(user, session, { ...auditInput, composition: compositionSnapshot(input.composition) });
          if (jobId)
            agent.attach(user, session, jobId, ticket);
          value = ticket;
          break;
        }
        case "simulate": {
          const ticket = text(input.id), scratch = text(input.scratchChatId);
          agent.submitted(user, session, ticket, scratch);
          const report = await health.run(user, session, ticket, scratch);
          agent.simulationResult(user, session, ticket, report);
          value = report;
          break;
        }
        case "cancelSimulation":
          health.cancel(user, session, text(input.id));
          agent.cancelledTicket(user, session, text(input.id));
          break;
        default:
          throw new Error("Unknown LumiCache operation.");
      }
      spindle.sendToFrontend({ type: "reply", id: request.id, value: prompts.pack(value, user, session) }, user, { frontendSessionId: session });
    } catch (error) {
      spindle.sendToFrontend({ type: "reply", id: request.id, error: errorText(error) }, user, { frontendSessionId: session });
    }
  })();
});
