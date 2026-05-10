const STORAGE_KEY = "html-studio-document-v1";
const THEME_KEY = "html-studio-theme";
const SPLIT_KEY = "html-studio-split-ratio";
const HISTORY_LIMIT = 120;
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const TAGS = [
  "html", "head", "body", "main", "section", "article", "aside", "header", "footer", "nav",
  "div", "span", "p", "a", "img", "figure", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "th", "td", "form",
  "label", "input", "textarea", "select", "option", "button", "video", "audio", "canvas", "svg",
  "style", "script", "template", "details", "summary", "blockquote", "pre", "code"
];

const PLACEHOLDER_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='960' height='540' viewBox='0 0 960 540'%3E%3Crect width='960' height='540' fill='%23f3efe4'/%3E%3Cpath d='M120 420l180-190 112 118 78-82 350 154H120z' fill='%23c9b98e'/%3E%3Ccircle cx='705' cy='152' r='58' fill='%23e3b341'/%3E%3Ctext x='480' y='492' text-anchor='middle' font-family='Segoe UI,Arial' font-size='34' fill='%235d5544'%3EImage%3C/text%3E%3C/svg%3E";

const SNIPPETS = {
  h1: "<h1>标题</h1>",
  p: "<p>段落内容</p>",
  a: '<a href="https://example.com">链接文字</a>',
  img: `<img src="${PLACEHOLDER_IMAGE}" alt="示例图片">`,
  section: "<section>\n  <h2>区块标题</h2>\n  <p>区块内容</p>\n</section>",
  ul: "<ul>\n  <li>列表项</li>\n  <li>列表项</li>\n</ul>",
  table: "<table>\n  <thead>\n    <tr><th>名称</th><th>值</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>项目</td><td>内容</td></tr>\n  </tbody>\n</table>"
};

const DEFAULT_DOC = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>实时 HTML 预览</title>
  <style>
    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      color: #1e2429;
      background: #f7f5ee;
    }

    main {
      max-width: 860px;
      margin: 0 auto;
      padding: 56px 24px;
    }

    h1 {
      font-size: clamp(2rem, 6vw, 4.5rem);
      line-height: 1;
      margin: 0 0 20px;
    }

    p {
      font-size: 1.1rem;
      line-height: 1.75;
    }

    .panel {
      margin-top: 32px;
      padding: 24px;
      border: 1px solid #d8d1c3;
      border-radius: 8px;
      background: white;
    }
  </style>
</head>
<body>
  <main>
    <h1>开始编辑 HTML</h1>
    <p>左侧修改源码，右侧会实时渲染。试试插入元素、格式化代码、切换设备视图或保存文件。</p>
    <section class="panel">
      <h2>HTML5 与 CSS3 可直接预览</h2>
      <p>iframe 使用 srcdoc 渲染当前文档，样式、布局、表单和大部分浏览器原生能力都会按真实页面显示。</p>
    </section>
  </main>
</body>
</html>`;

const app = document.querySelector(".app-shell");
const workspace = document.querySelector(".workspace");
const splitter = document.getElementById("splitter");
const editor = document.getElementById("editor");
const visualEditor = document.getElementById("visualEditor");
const lineNumbers = document.getElementById("lineNumbers");
const highlightLayer = document.getElementById("highlightLayer");
const preview = document.getElementById("preview");
const previewStage = document.getElementById("previewStage");
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const cursorInfo = document.getElementById("cursorInfo");
const matchInfo = document.getElementById("matchInfo");
const saveState = document.getElementById("saveState");
const docStats = document.getElementById("docStats");
const previewState = document.getElementById("previewState");
const completion = document.getElementById("completion");

let fileHandle = null;
let currentName = "未命名文档";
let sourceDocument = "";
let editorMode = "source";
let renderTimer = 0;
let saveTimer = 0;
let completionItems = [];
let completionIndex = 0;
let matchRanges = [];
let foldedBlock = null;
let isResizing = false;
let undoStack = [];
let isRestoringHistory = false;

function init() {
  const cached = readStorage();
  sourceDocument = cached?.content || DEFAULT_DOC;
  editorMode = cached?.mode === "clean" ? "clean" : "source";
  currentName = cached?.name || currentName;
  fileName.textContent = currentName;
  app.dataset.theme = localStorage.getItem(THEME_KEY) || "dark";
  app.dataset.editorMode = editorMode;
  editor.setAttribute("aria-label", editorMode === "clean" ? "HTML 简洁编辑视图" : "HTML 源代码");
  renderEditorForMode();
  bindEvents();
  restoreSplitLayout();
  updateModeButtons();
  updateThemeButton();
  updateUndoButton();
  updateAll(true);
}

function bindEvents() {
  editor.addEventListener("beforeinput", recordEditBeforeInput);
  editor.addEventListener("input", onInput);
  editor.addEventListener("keydown", onKeyDown);
  editor.addEventListener("keyup", updateCursorContext);
  editor.addEventListener("click", updateCursorContext);
  editor.addEventListener("scroll", syncEditorScroll);
  editor.addEventListener("scroll", syncPreviewToEditor);
  preview.addEventListener("load", bindPreviewScroll);
  visualEditor.addEventListener("beforeinput", recordEditBeforeInput);
  visualEditor.addEventListener("input", onVisualInput);
  visualEditor.addEventListener("keydown", onVisualKeyDown);
  visualEditor.addEventListener("mouseup", updateVisualStatus);
  visualEditor.addEventListener("keyup", updateVisualStatus);
  fileInput.addEventListener("change", openPickedFile);

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => runAction(button.dataset.action));
  });

  document.querySelectorAll("[data-insert]").forEach((button) => {
    button.addEventListener("click", () => insertSnippet(button.dataset.insert));
  });

  document.querySelectorAll("[data-device]").forEach((button) => {
    button.addEventListener("click", () => setDevice(button.dataset.device));
  });

  document.querySelectorAll("[data-editor-mode]").forEach((button) => {
    button.addEventListener("click", () => switchEditorMode(button.dataset.editorMode));
  });

  document.querySelectorAll("[data-rich]").forEach((button) => {
    button.addEventListener("click", () => runRichCommand(button.dataset.rich));
  });

  splitter.addEventListener("pointerdown", startSplitResize);
  splitter.addEventListener("pointermove", moveSplitResize);
  splitter.addEventListener("pointerup", stopSplitResize);
  splitter.addEventListener("pointercancel", stopSplitResize);
  splitter.addEventListener("keydown", nudgeSplitWithKeyboard);
  window.addEventListener("resize", restoreSplitLayout);

  document.getElementById("foldBtn").addEventListener("click", toggleFold);
  document.getElementById("themeBtn").addEventListener("click", toggleTheme);
  document.getElementById("focusBtn").addEventListener("click", toggleFocus);
  document.getElementById("focusExitBtn").addEventListener("click", () => toggleFocus(false));
}

function onInput(event) {
  if (foldedBlock && !editor.value.includes(foldedBlock.marker)) {
    foldedBlock = null;
  }
  maybeAutoClose(event);
  syncSourceDocumentFromEditor();
  updateAll();
  openCompletion();
}

function onVisualInput() {
  foldedBlock = null;
  decorateVisualImages();
  editor.value = expandedEditorValue();
  syncSourceDocumentFromEditor();
  updateAll();
}

function onVisualKeyDown(event) {
  if (handleShortcuts(event)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    runRichCommand("bold");
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
    event.preventDefault();
    runRichCommand("italic");
  }
}

function updateVisualStatus() {
  if (!isVisualMode()) return;
  cursorInfo.textContent = "可视化编辑";
  matchInfo.textContent = "所见即所得";
}

function recordEditBeforeInput(event) {
  if (isRestoringHistory || event.inputType === "insertCompositionText") return;
  if (/^(insert|delete|format)/.test(event.inputType || "")) {
    pushUndoSnapshot();
  }
}

function pushUndoSnapshot() {
  if (isRestoringHistory) return;
  const snapshot = createUndoSnapshot();
  const last = undoStack[undoStack.length - 1];
  if (last && snapshotsEqual(last, snapshot)) return;
  undoStack.push(snapshot);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  updateUndoButton();
}

function createUndoSnapshot() {
  return {
    currentName,
    sourceDocument,
    editorMode,
    editorValue: editor.value,
    visualValue: visualEditor.innerHTML,
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
    foldedBlock: foldedBlock ? { ...foldedBlock } : null
  };
}

function snapshotsEqual(a, b) {
  return a.sourceDocument === b.sourceDocument
    && a.editorMode === b.editorMode
    && a.editorValue === b.editorValue
    && a.visualValue === b.visualValue
    && JSON.stringify(a.foldedBlock) === JSON.stringify(b.foldedBlock);
}

function undoLastChange() {
  const snapshot = undoStack.pop();
  if (!snapshot) return;

  isRestoringHistory = true;
  currentName = snapshot.currentName;
  sourceDocument = snapshot.sourceDocument;
  editorMode = snapshot.editorMode;
  foldedBlock = snapshot.foldedBlock ? { ...snapshot.foldedBlock } : null;
  fileName.textContent = currentName;
  app.dataset.editorMode = editorMode;
  editor.value = snapshot.editorValue;
  visualEditor.innerHTML = snapshot.visualValue || "";
  editor.setAttribute("aria-label", editorMode === "clean" ? "HTML 简洁编辑视图" : "HTML 源代码");
  updateModeButtons();
  updateAll(true);
  if (!isVisualMode()) {
    editor.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
  focusActiveEditor();
  isRestoringHistory = false;
  updateUndoButton();
}

function clearUndoHistory() {
  undoStack = [];
  updateUndoButton();
}

function updateUndoButton() {
  const undoBtn = document.getElementById("undoBtn");
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
}

function updateAll(immediate = false) {
  updateCursorContext();
  updateLineNumbers();
  updateHighlight();
  updateStats();
  schedulePreview(immediate);
  scheduleAutosave();
}

function updateHighlight() {
  if (isVisualMode()) {
    highlightLayer.innerHTML = "";
    return;
  }
  highlightLayer.innerHTML = highlightHtml(editor.value, matchRanges);
  syncEditorScroll();
}

function highlightHtml(source, ranges = []) {
  const marks = ranges.slice().sort((a, b) => a.start - b.start);
  let output = "";
  let cursor = 0;
  let markIndex = 0;
  const tokenPattern = /<!--[\s\S]*?-->|<!doctype[\s\S]*?>|<\/?[a-zA-Z][^>]*?>|&[a-zA-Z0-9#]+;/gi;

  source.replace(tokenPattern, (token, offset) => {
    output += escapeWithMatches(source.slice(cursor, offset), cursor, marks, markIndex);
    while (markIndex < marks.length && marks[markIndex].end <= offset) markIndex += 1;
    output += colorToken(token, offset, marks);
    cursor = offset + token.length;
    return token;
  });

  output += escapeWithMatches(source.slice(cursor), cursor, marks, markIndex);
  return output || " ";
}

function colorToken(token, absoluteStart, marks) {
  if (token.startsWith("<!--")) {
    return wrapMatch(escapeHtml(token), absoluteStart, absoluteStart + token.length, marks, "tok-comment");
  }
  if (/^<!doctype/i.test(token)) {
    return wrapMatch(escapeHtml(token), absoluteStart, absoluteStart + token.length, marks, "tok-doctype");
  }
  if (token.startsWith("&")) {
    return wrapMatch(escapeHtml(token), absoluteStart, absoluteStart + token.length, marks, "tok-entity");
  }

  const escaped = escapeHtml(token)
    .replace(/^(&lt;\/?)([a-zA-Z][\w:-]*)/, '<span class="tok-tag">$1</span><span class="tok-name">$2</span>')
    .replace(/([a-zA-Z_:][\w:.-]*)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g, '<span class="tok-attr">$1</span>$2<span class="tok-string">$3</span>')
    .replace(/(\/?&gt;)$/, '<span class="tok-tag">$1</span>');

  return wrapMatch(escaped, absoluteStart, absoluteStart + token.length, marks, "");
}

function escapeWithMatches(text, start, marks, markIndex) {
  let output = "";
  let cursor = 0;
  for (let i = markIndex; i < marks.length; i += 1) {
    const mark = marks[i];
    const localStart = mark.start - start;
    const localEnd = mark.end - start;
    if (localEnd <= 0) continue;
    if (localStart >= text.length) break;
    output += escapeHtml(text.slice(cursor, Math.max(0, localStart)));
    output += `<span class="tok-match">${escapeHtml(text.slice(Math.max(0, localStart), Math.min(text.length, localEnd)))}</span>`;
    cursor = Math.min(text.length, localEnd);
  }
  output += escapeHtml(text.slice(cursor));
  return output;
}

function wrapMatch(html, start, end, marks, extraClass) {
  const matched = marks.some((mark) => mark.start === start && mark.end === end);
  const classes = [extraClass, matched ? "tok-match" : ""].filter(Boolean).join(" ");
  return classes ? `<span class="${classes}">${html}</span>` : html;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function schedulePreview(immediate = false) {
  window.clearTimeout(renderTimer);
  previewState.textContent = "等待渲染";
  renderTimer = window.setTimeout(renderPreview, immediate ? 0 : 45);
}

function renderPreview() {
  preview.srcdoc = expandedSource();
  previewState.textContent = "实时渲染";
}

function scheduleAutosave() {
  saveState.textContent = "保存中";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: currentName, content: expandedSource(), mode: editorMode, savedAt: Date.now() }));
    saveState.textContent = "已自动保存";
  }, 500);
}

function readStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function updateStats() {
  if (isVisualMode()) {
    const text = visualEditor.innerText.trim();
    const blocks = visualEditor.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th").length;
    docStats.textContent = `${text.length} 字符 · ${blocks || 1} 段`;
    return;
  }
  const lines = editor.value.split("\n").length;
  docStats.textContent = `${editor.value.length} 字符 · ${lines} 行`;
}

function updateCursorContext() {
  if (isVisualMode()) {
    updateVisualStatus();
    return;
  }
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const line = before.split("\n").length;
  const col = before.length - before.lastIndexOf("\n");
  cursorInfo.textContent = `Ln ${line}, Col ${col}`;
  matchRanges = findMatchingTag(editor.value, pos);
  matchInfo.textContent = matchRanges.length ? "已匹配标签" : "标签匹配就绪";
  updateHighlight();
}

function syncEditorScroll() {
  highlightLayer.scrollTop = editor.scrollTop;
  highlightLayer.scrollLeft = editor.scrollLeft;
  lineNumbers.scrollTop = editor.scrollTop;
}

function updateLineNumbers() {
  if (isVisualMode()) {
    lineNumbers.textContent = "";
    return;
  }
  const lineCount = Math.max(1, editor.value.split("\n").length);
  lineNumbers.innerHTML = Array.from({ length: lineCount }, (_, index) => `<div>${index + 1}</div>`).join("");
  syncEditorScroll();
}

let scrollSyncLock = false;

function syncPreviewToEditor() {
  if (scrollSyncLock) return;
  const doc = preview.contentDocument;
  if (!doc?.documentElement) return;
  scrollSyncLock = true;
  const ratio = editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
  const target = ratio * Math.max(1, doc.documentElement.scrollHeight - preview.clientHeight);
  doc.defaultView.scrollTo({ top: target, behavior: "auto" });
  window.setTimeout(() => {
    scrollSyncLock = false;
  }, 30);
}

function bindPreviewScroll() {
  const win = preview.contentWindow;
  const doc = preview.contentDocument;
  if (!win || !doc?.documentElement) return;
  win.onscroll = () => {
    if (scrollSyncLock) return;
    scrollSyncLock = true;
    const ratio = win.scrollY / Math.max(1, doc.documentElement.scrollHeight - win.innerHeight);
    editor.scrollTop = ratio * Math.max(1, editor.scrollHeight - editor.clientHeight);
    window.setTimeout(() => {
      scrollSyncLock = false;
    }, 30);
  };
}

function startSplitResize(event) {
  if (isNarrowLayout()) return;
  event.preventDefault();
  isResizing = true;
  splitter.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing-layout");
  resizeSplitTo(event.clientX);
}

function moveSplitResize(event) {
  if (!isResizing) return;
  event.preventDefault();
  resizeSplitTo(event.clientX);
}

function stopSplitResize(event) {
  if (!isResizing) return;
  isResizing = false;
  if (splitter.hasPointerCapture(event.pointerId)) {
    splitter.releasePointerCapture(event.pointerId);
  }
  document.body.classList.remove("resizing-layout");
  saveCurrentSplitRatio();
}

function nudgeSplitWithKeyboard(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || isNarrowLayout()) return;
  event.preventDefault();
  const rect = workspace.getBoundingClientRect();
  const current = currentEditorWidth();
  const step = event.shiftKey ? 80 : 24;
  let next = current;
  if (event.key === "ArrowLeft") next -= step;
  if (event.key === "ArrowRight") next += step;
  if (event.key === "Home") next = minimumEditorWidth(rect.width);
  if (event.key === "End") next = maximumEditorWidth(rect.width);
  applySplitWidth(next);
  saveCurrentSplitRatio();
}

function resizeSplitTo(clientX) {
  const rect = workspace.getBoundingClientRect();
  applySplitWidth(clientX - rect.left);
}

function applySplitWidth(width) {
  const rect = workspace.getBoundingClientRect();
  const splitterWidth = splitter.offsetWidth || 12;
  const available = Math.max(1, rect.width - splitterWidth);
  const clamped = Math.min(maximumEditorWidth(rect.width), Math.max(minimumEditorWidth(rect.width), width));
  workspace.style.setProperty("--editor-pane-width", `${clamped}px`);
  splitter.setAttribute("aria-valuemin", String(Math.round(minimumEditorWidth(rect.width))));
  splitter.setAttribute("aria-valuemax", String(Math.round(maximumEditorWidth(rect.width))));
  splitter.setAttribute("aria-valuenow", String(Math.round(clamped)));
  splitter.setAttribute("aria-valuetext", `编辑区 ${Math.round((clamped / available) * 100)}%`);
}

function restoreSplitLayout() {
  if (isNarrowLayout()) {
    workspace.style.removeProperty("--editor-pane-width");
    return;
  }
  const saved = Number(localStorage.getItem(SPLIT_KEY));
  const ratio = Number.isFinite(saved) && saved > 0 ? saved : 0.5;
  const rect = workspace.getBoundingClientRect();
  const splitterWidth = splitter.offsetWidth || 12;
  applySplitWidth((rect.width - splitterWidth) * ratio);
}

function saveCurrentSplitRatio() {
  if (isNarrowLayout()) return;
  const rect = workspace.getBoundingClientRect();
  const splitterWidth = splitter.offsetWidth || 12;
  const ratio = currentEditorWidth() / Math.max(1, rect.width - splitterWidth);
  localStorage.setItem(SPLIT_KEY, String(Math.min(0.82, Math.max(0.18, ratio))));
}

function currentEditorWidth() {
  const value = workspace.style.getPropertyValue("--editor-pane-width");
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed)) return parsed;
  const editorPane = document.querySelector(".editor-pane");
  return editorPane?.getBoundingClientRect().width || 0;
}

function minimumEditorWidth(totalWidth) {
  return totalWidth < 980 ? 300 : 360;
}

function maximumEditorWidth(totalWidth) {
  const splitterWidth = splitter.offsetWidth || 12;
  const minPreview = totalWidth < 980 ? 300 : 360;
  return Math.max(minimumEditorWidth(totalWidth), totalWidth - splitterWidth - minPreview);
}

function isNarrowLayout() {
  return window.matchMedia("(max-width: 1100px)").matches;
}

function findMatchingTag(source, pos) {
  const tokens = parseTags(source);
  const current = tokens.find((token) => pos >= token.start && pos <= token.end) || nearestToken(tokens, pos);
  if (!current || current.selfClosing || current.name.startsWith("!")) return [];
  const match = current.closing ? findOpenForClose(tokens, current) : findCloseForOpen(tokens, current);
  return match ? [{ start: current.start, end: current.end }, { start: match.start, end: match.end }] : [{ start: current.start, end: current.end }];
}

function nearestToken(tokens, pos) {
  const before = [...tokens].reverse().find((token) => token.start <= pos);
  return before && pos - before.end < 3 ? before : null;
}

function parseTags(source) {
  const tokens = [];
  const tagPattern = /<\/?([a-zA-Z][\w:-]*)(?:\s[^<>]*?)?>/g;
  let match;
  while ((match = tagPattern.exec(source))) {
    const raw = match[0];
    const name = match[1].toLowerCase();
    const closing = raw.startsWith("</");
    const selfClosing = VOID_TAGS.has(name) || /\/>$/.test(raw);
    tokens.push({ name, closing, selfClosing, start: match.index, end: match.index + raw.length });
  }
  return tokens;
}

function findCloseForOpen(tokens, token) {
  let depth = 0;
  for (const next of tokens.filter((item) => item.start > token.start)) {
    if (next.name !== token.name || next.selfClosing) continue;
    if (!next.closing) depth += 1;
    if (next.closing && depth === 0) return next;
    if (next.closing) depth -= 1;
  }
  return null;
}

function findOpenForClose(tokens, token) {
  let depth = 0;
  const previous = tokens.filter((item) => item.start < token.start).reverse();
  for (const next of previous) {
    if (next.name !== token.name || next.selfClosing) continue;
    if (next.closing) depth += 1;
    if (!next.closing && depth === 0) return next;
    if (!next.closing) depth -= 1;
  }
  return null;
}

function onKeyDown(event) {
  if (handleShortcuts(event)) return;
  if (handleCompletionKeys(event)) return;

  if (event.key === "Tab") {
    event.preventDefault();
    insertAtSelection("  ");
  }

  if (event.key === "Enter") {
    smartNewLine(event);
  }
}

function handleShortcuts(event) {
  const ctrl = event.ctrlKey || event.metaKey;
  if (!ctrl && event.key !== "F11" && event.key !== "Escape") return false;

  if (ctrl && !event.shiftKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoLastChange();
    return true;
  }
  if (ctrl && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveDocument();
    return true;
  }
  if (ctrl && event.key.toLowerCase() === "o") {
    event.preventDefault();
    openDocument();
    return true;
  }
  if (ctrl && event.key.toLowerCase() === "n") {
    event.preventDefault();
    newDocument();
    return true;
  }
  if (ctrl && event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    formatDocument();
    return true;
  }
  if (event.key === "F11") {
    event.preventDefault();
    toggleFocus();
    return true;
  }
  if (event.key === "Escape") {
    if (app.classList.contains("focus-mode")) {
      event.preventDefault();
      toggleFocus(false);
      return true;
    }
    completion.hidden = true;
    return false;
  }
  return false;
}

function smartNewLine(event) {
  const pos = editor.selectionStart;
  const beforeLine = editor.value.slice(0, pos).split("\n").pop();
  const currentIndent = beforeLine.match(/^\s*/)[0];
  const extra = /<([a-zA-Z][\w:-]*)(?:\s[^>]*)?>\s*$/.test(beforeLine) && !/\/>\s*$/.test(beforeLine) ? "  " : "";
  event.preventDefault();
  insertAtSelection(`\n${currentIndent}${extra}`);
}

function maybeAutoClose(event) {
  if (event.inputType !== "insertText" || event.data !== ">") return;
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const match = before.match(/<([a-zA-Z][\w:-]*)(?:\s[^<>]*)?>$/);
  if (!match) return;
  const tag = match[1].toLowerCase();
  if (VOID_TAGS.has(tag) || before.endsWith("/>")) return;
  const close = `</${tag}>`;
  editor.setRangeText(close, pos, pos, "end");
  editor.selectionStart = editor.selectionEnd = pos;
}

function openCompletion() {
  const context = completionContext();
  if (!context) {
    completion.hidden = true;
    return;
  }

  completionItems = context.items.slice(0, 10);
  completionIndex = 0;
  if (!completionItems.length) {
    completion.hidden = true;
    return;
  }

  completion.innerHTML = completionItems.map((item, index) => (
    `<button type="button" class="${index === 0 ? "active" : ""}" data-index="${index}"><span>${item.label}</span><span>${item.kind}</span></button>`
  )).join("");
  completion.querySelectorAll("button").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      acceptCompletion(Number(button.dataset.index));
    });
  });
  completion.hidden = false;
}

function completionContext() {
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const closeMatch = before.match(/<\/([a-zA-Z]*)$/);
  if (closeMatch) {
    const stack = getOpenTagStack(editor.value.slice(0, pos));
    const prefix = closeMatch[1].toLowerCase();
    return {
      replaceStart: pos - prefix.length,
      items: stack.reverse()
        .filter((tag) => tag.startsWith(prefix))
        .map((tag) => ({ label: tag, kind: "close" }))
    };
  }

  const openMatch = before.match(/<([a-zA-Z]*)$/);
  if (openMatch) {
    const prefix = openMatch[1].toLowerCase();
    return {
      replaceStart: pos - prefix.length,
      items: TAGS
        .filter((tag) => tag.startsWith(prefix))
        .map((tag) => ({ label: tag, kind: VOID_TAGS.has(tag) ? "void" : "tag" }))
    };
  }
  return null;
}

function handleCompletionKeys(event) {
  if (completion.hidden) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const dir = event.key === "ArrowDown" ? 1 : -1;
    completionIndex = (completionIndex + dir + completionItems.length) % completionItems.length;
    completion.querySelectorAll("button").forEach((button, index) => button.classList.toggle("active", index === completionIndex));
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    acceptCompletion(completionIndex);
    return true;
  }
  return false;
}

function acceptCompletion(index) {
  const context = completionContext();
  const item = completionItems[index];
  if (!context || !item) return;
  editor.setSelectionRange(context.replaceStart, editor.selectionStart);
  insertAtSelection(item.label);
  completion.hidden = true;
}

function getOpenTagStack(source) {
  const stack = [];
  for (const token of parseTags(source)) {
    if (token.selfClosing) continue;
    if (!token.closing) {
      stack.push(token.name);
    } else {
      const index = stack.lastIndexOf(token.name);
      if (index >= 0) stack.splice(index, 1);
    }
  }
  return stack;
}

function insertAtSelection(text, selectOffset = null) {
  pushUndoSnapshot();
  const start = editor.selectionStart;
  editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, "end");
  if (selectOffset !== null) {
    editor.selectionStart = editor.selectionEnd = start + selectOffset;
  }
  editor.focus();
  syncSourceDocumentFromEditor();
  updateAll();
}

function insertSnippet(name) {
  const snippet = SNIPPETS[name];
  if (!snippet) return;
  if (isVisualMode()) {
    insertVisualHtml(snippet);
    return;
  }
  insertAtSelection(snippet);
}

function runRichCommand(command) {
  if (!isVisualMode()) return;
  pushUndoSnapshot();
  ensureVisualSelection();

  if (command === "h1" || command === "h2" || command === "p") {
    document.execCommand("formatBlock", false, command);
  } else if (command === "bold") {
    document.execCommand("bold");
  } else if (command === "italic") {
    document.execCommand("italic");
  } else if (command === "ul") {
    document.execCommand("insertUnorderedList");
  } else if (command === "ol") {
    document.execCommand("insertOrderedList");
  } else if (command === "link") {
    const url = window.prompt("输入链接地址", "https://");
    if (url) document.execCommand("createLink", false, url);
  } else if (command === "image") {
    const url = window.prompt("输入图片地址", PLACEHOLDER_IMAGE);
    if (url) document.execCommand("insertHTML", false, `<img src="${escapeAttribute(url)}" alt="图片">`);
  }

  visualEditor.focus();
  onVisualInput();
}

function insertVisualHtml(html) {
  pushUndoSnapshot();
  ensureVisualSelection();
  document.execCommand("insertHTML", false, html);
  visualEditor.focus();
  onVisualInput();
}

function ensureVisualSelection() {
  visualEditor.focus();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !visualEditor.contains(selection.anchorNode)) {
    const range = document.createRange();
    range.selectNodeContents(visualEditor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

function runAction(action) {
  const actions = {
    new: newDocument,
    open: openDocument,
    save: saveDocument,
    undo: undoLastChange,
    "export-clean": exportCleanDocument,
    "export-styled": exportStyledDocument,
    format: formatDocument
  };
  actions[action]?.();
}

function switchEditorMode(mode) {
  if (!["source", "clean"].includes(mode) || mode === editorMode) return;
  pushUndoSnapshot();
  sourceDocument = expandedSource();
  foldedBlock = null;
  editorMode = mode;
  app.dataset.editorMode = mode;
  renderEditorForMode();
  editor.setAttribute("aria-label", mode === "clean" ? "HTML 简洁编辑视图" : "HTML 源代码");
  completion.hidden = true;
  updateModeButtons();
  updateAll(true);
  decorateVisualImages();
  focusActiveEditor();
}

function updateModeButtons() {
  document.querySelectorAll("[data-editor-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.editorMode === editorMode);
  });
}

function editorTextForMode() {
  return editorMode === "clean" ? extractBodyContent(sourceDocument) : sourceDocument;
}

function renderEditorForMode() {
  const content = editorTextForMode();
  editor.value = content;
  visualEditor.innerHTML = editorMode === "clean" ? normalizeVisualContent(content) : "";
  decorateVisualImages();
}

async function newDocument() {
  if (!window.confirm("新建文档会替换当前编辑内容，已自动保存的内容仍保留。继续？")) return;
  pushUndoSnapshot();
  fileHandle = null;
  foldedBlock = null;
  sourceDocument = DEFAULT_DOC;
  currentName = "未命名文档";
  fileName.textContent = currentName;
  renderEditorForMode();
  updateAll(true);
}

async function openDocument() {
  if ("showOpenFilePicker" in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "HTML 文件", accept: { "text/html": [".html", ".htm"] } }]
      });
      const file = await handle.getFile();
      pushUndoSnapshot();
      sourceDocument = await file.text();
      renderEditorForMode();
      foldedBlock = null;
      fileHandle = handle;
      currentName = file.name;
      fileName.textContent = currentName;
      updateAll(true);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  fileInput.click();
}

function openPickedFile() {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pushUndoSnapshot();
    sourceDocument = String(reader.result || "");
    renderEditorForMode();
    foldedBlock = null;
    currentName = file.name;
    fileName.textContent = currentName;
    fileHandle = null;
    updateAll(true);
  };
  reader.readAsText(file);
  fileInput.value = "";
}

async function saveDocument() {
  const content = expandedSource();
  if (fileHandle?.createWritable) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      saveState.textContent = "已保存到文件";
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  download(`${baseFileName()}.html`, content, "text/html;charset=utf-8");
  saveState.textContent = "已下载保存";
}

function exportStyledDocument() {
  const content = ensureCompleteHtml(expandedSource());
  download(`${baseFileName()}-export.html`, content, "text/html;charset=utf-8");
}

function exportCleanDocument() {
  download(`${baseFileName()}-source.html`, expandedSource(), "text/html;charset=utf-8");
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function baseFileName() {
  return (currentName || "document").replace(/\.(html?|txt)$/i, "") || "document";
}

function ensureCompleteHtml(content) {
  if (/<!doctype html>/i.test(content) && /<html[\s>]/i.test(content)) return content;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapePlain(baseFileName())}</title>
</head>
<body>
${content}
</body>
</html>`;
}

function escapePlain(text) {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function formatDocument() {
  pushUndoSnapshot();
  if (isVisualMode()) {
    sourceDocument = composeDocumentWithBody(sourceDocument, expandedEditorValue());
    visualEditor.innerHTML = normalizeVisualContent(extractBodyContent(sourceDocument));
    editor.value = visualEditor.innerHTML;
    updateAll(true);
    return;
  }
  const formatted = editorMode === "clean" ? formatHtml(expandedEditorValue()) : formatHtml(expandedSource());
  foldedBlock = null;
  editor.value = formatted;
  syncSourceDocumentFromEditor();
  updateAll(true);
}

function formatHtml(source) {
  const tokens = source
    .replace(/>\s+</g, "><")
    .match(/<!--[\s\S]*?-->|<!doctype[\s\S]*?>|<[^>]+>|[^<]+/gi) || [];
  let indent = 0;
  const lines = [];

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const isClosing = /^<\//.test(trimmed);
    const isOpening = /^<([a-zA-Z][\w:-]*)\b/.test(trimmed) && !/\/>$/.test(trimmed);
    const tagName = (trimmed.match(/^<\/?([a-zA-Z][\w:-]*)/) || [])[1]?.toLowerCase();
    const isVoid = tagName && VOID_TAGS.has(tagName);
    const isInlineText = !trimmed.startsWith("<");

    if (isClosing) indent = Math.max(0, indent - 1);
    lines.push(`${"  ".repeat(indent)}${trimmed}`);
    if (isOpening && !isVoid && !/^<(script|style)\b/i.test(trimmed) && !isInlineText) indent += 1;
  }

  return lines.join("\n");
}

function toggleTheme() {
  app.dataset.theme = app.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, app.dataset.theme);
  updateThemeButton();
}

function updateThemeButton() {
  const themeBtn = document.getElementById("themeBtn");
  const label = app.dataset.theme === "dark" ? "切换到浅色主题" : "切换到深色主题";
  themeBtn.title = label;
  themeBtn.setAttribute("aria-label", label);
}

function toggleFocus(force) {
  if (typeof force === "boolean") {
    app.classList.toggle("focus-mode", force);
  } else {
    app.classList.toggle("focus-mode");
  }
  focusActiveEditor();
}

function focusActiveEditor() {
  if (isVisualMode()) {
    visualEditor.focus();
  } else {
    editor.focus();
  }
}

function setDevice(device) {
  previewStage.dataset.device = device === "desktop" ? "" : device;
  document.querySelectorAll("[data-device]").forEach((button) => button.classList.toggle("active", button.dataset.device === device));
}

function toggleFold() {
  if (isVisualMode()) {
    matchInfo.textContent = "可视化模式无需折叠";
    return;
  }
  pushUndoSnapshot();
  if (foldedBlock) {
    const markerStart = editor.value.indexOf(foldedBlock.marker);
    if (markerStart >= 0) {
      editor.setRangeText(foldedBlock.content, markerStart, markerStart + foldedBlock.marker.length, "end");
      editor.setSelectionRange(markerStart, markerStart + foldedBlock.content.length);
    }
    foldedBlock = null;
    matchInfo.textContent = "已展开代码块";
    updateAll(true);
    editor.focus();
    return;
  }

  const ranges = findMatchingTag(editor.value, editor.selectionStart);
  if (ranges.length < 2) {
    matchInfo.textContent = "当前位置没有可折叠标签";
    return;
  }

  const [a, b] = ranges.sort((left, right) => left.start - right.start);
  const content = editor.value.slice(a.end, b.start);
  if (!content.trim()) {
    matchInfo.textContent = "空标签无需折叠";
    return;
  }

  const tag = (editor.value.slice(a.start, a.end).match(/^<([a-zA-Z][\w:-]*)/) || [])[1] || "tag";
  const lineCount = content.split("\n").length;
  const marker = `\n  <!-- folded ${tag}: ${lineCount} lines -->\n`;
  foldedBlock = { marker, content };
  editor.setRangeText(marker, a.end, b.start, "end");
  editor.setSelectionRange(a.end, a.end + marker.length);
  matchInfo.textContent = `已折叠 <${tag}> 代码块`;
  updateAll(true);
  editor.focus();
}

function syncSourceDocumentFromEditor() {
  sourceDocument = expandedSource();
}

function expandedEditorValue() {
  if (isVisualMode()) return sanitizeVisualHtml(visualEditor.innerHTML);
  if (!foldedBlock) return editor.value;
  return editor.value.replace(foldedBlock.marker, foldedBlock.content);
}

function expandedSource() {
  const visibleSource = expandedEditorValue();
  return editorMode === "clean" ? composeDocumentWithBody(sourceDocument, visibleSource) : visibleSource;
}

function extractBodyContent(source) {
  const match = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) return source;
  return stripSharedIndent(match[1].replace(/^\s*\n/, "").replace(/\n\s*$/, ""));
}

function composeDocumentWithBody(baseSource, bodyContent) {
  const body = indentBodyContent(bodyContent);
  if (/<body\b[^>]*>[\s\S]*?<\/body>/i.test(baseSource)) {
    return baseSource.replace(/(<body\b[^>]*>)[\s\S]*?(<\/body>)/i, `$1${body}$2`);
  }
  return ensureCompleteHtml(bodyContent);
}

function stripSharedIndent(content) {
  const lines = content.split("\n");
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => (line.match(/^\s*/) || [""])[0].length);
  const shared = indents.length ? Math.min(...indents) : 0;
  return shared ? lines.map((line) => line.slice(Math.min(shared, line.length))).join("\n") : content;
}

function indentBodyContent(content) {
  if (!content.trim()) return "";
  return `\n${content.split("\n").map((line) => (line ? `  ${line}` : "")).join("\n")}\n`;
}

function isVisualMode() {
  return editorMode === "clean";
}

function normalizeVisualContent(content) {
  const cleaned = sanitizeVisualHtml(content).trim();
  return decorateImageWidgets(cleaned || "<p><br></p>");
}

function decorateVisualImages() {
  if (!isVisualMode()) return;
  visualEditor.querySelectorAll("img").forEach((image) => {
    if (!image.closest(".visual-image-card")) {
      image.replaceWith(createImageWidget(image.getAttribute("src") || "", image.getAttribute("alt") || "图片"));
    }
  });
  visualEditor.querySelectorAll(".visual-image-card img").forEach((image) => {
    image.loading = "lazy";
    image.decoding = "async";
    if (!image.getAttribute("alt")) image.setAttribute("alt", "图片");
    image.title = image.getAttribute("src") || "图片";
    image.onerror = () => {
      image.classList.add("image-missing");
      image.alt = `图片无法显示：${image.getAttribute("src") || "缺少地址"}`;
    };
    image.onload = () => {
      image.classList.remove("image-missing");
    };
    if (!image.getAttribute("src")) {
      image.classList.add("image-missing");
      image.alt = "图片无法显示：缺少地址";
    }
  });
}

function decorateImageWidgets(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("img").forEach((image) => {
    image.replaceWith(createImageWidget(image.getAttribute("src") || "", image.getAttribute("alt") || "图片"));
  });
  return template.innerHTML;
}

function createImageWidget(src, alt) {
  const figure = document.createElement("figure");
  figure.className = "visual-image-card";
  figure.contentEditable = "false";
  figure.dataset.src = src;
  figure.dataset.alt = alt;

  const image = document.createElement("img");
  image.setAttribute("src", src || PLACEHOLDER_IMAGE);
  image.setAttribute("alt", alt || "图片");

  const caption = document.createElement("figcaption");
  caption.className = "visual-image-caption";
  caption.textContent = src ? `图片：${src}` : "图片：缺少地址";

  figure.append(image, caption);
  return figure;
}

function sanitizeVisualHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll(".visual-image-card").forEach((widget) => {
    const image = widget.querySelector("img");
    const cleanImage = document.createElement("img");
    cleanImage.setAttribute("src", widget.dataset.src || image?.getAttribute("src") || "");
    cleanImage.setAttribute("alt", widget.dataset.alt || image?.getAttribute("alt") || "图片");
    widget.replaceWith(cleanImage);
  });
  template.content.querySelectorAll("script,iframe,object,embed,meta,link,style,title").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    node.classList.remove("image-missing", "visual-image-card", "visual-image-caption");
    [...node.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name) || attr.name === "loading" || attr.name === "decoding" || attr.name === "contenteditable" || attr.name.startsWith("data-")) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return template.innerHTML;
}

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

init();
