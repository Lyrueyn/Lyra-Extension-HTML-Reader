(() => {
  "use strict";

  const host = window.chrome && window.chrome.webview ? window.chrome.webview : null;
  const params = new URLSearchParams(location.search);
  const editorOrigin = params.get("extensionsOrigin") || "https://lyra-extensions.local";
  const bookAssetsOrigin = params.get("bookAssetsOrigin") || "";
  const isFilePreview = location.protocol === "file:";
  const EDIT_CHANNEL = "lyra-editor";

  const state = {
    html: "",
    title: params.get("name") || "未命名.html",
    path: "",
    dirty: false,
    mode: "read",
    editorReady: false,
    editorInited: false,
    saveTimer: 0,
    requestId: 1,
      projectMode: params.get("project") === "1",
      projectName: params.get("projectName") || "",
      projectFiles: [],
      projectRoot: "",
      currentRel: "",
      currentDir: "",
      baseHref: bookAssetsOrigin ? bookAssetsOrigin.replace(/\/?$/, "/") : "",
  };

  const $ = (id) => document.getElementById(id);

  function setStatus(text, tone) {
    const el = $("status");
    el.textContent = text;
    el.style.color = tone === "error" ? "#b91c1c" : tone === "ok" ? "#0f766e" : "";
  }

  function showError(err) {
    $("errorText").textContent = String(err && err.message ? err.message : err);
    $("errorMask").hidden = false;
    setStatus("出错", "error");
  }

  function bytesToBase64(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64 || "");
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  }
  function decodeText(b64) {
    return new TextDecoder("utf-8", { fatal: false }).decode(base64ToBytes(b64));
  }
  function encodeText(text) {
    return bytesToBase64(new TextEncoder().encode(text || ""));
  }

  function hostCall(type, payload) {
    return new Promise((resolve, reject) => {
      if (!host) { reject(new Error("请从璃鸢镜扩展中打开 HTML 阅读器")); return; }
      const requestId = String(state.requestId++);
      const timer = setTimeout(() => reject(new Error("宿主响应超时")), 15000);
      const onMessage = (event) => {
        const d = event.data || {};
        if (d.type === type + ".result" && d.requestId === requestId) {
          clearTimeout(timer);
          try { host.removeEventListener("message", onMessage); } catch { }
          resolve(d);
        }
      };
      host.addEventListener("message", onMessage);
      host.postMessage(Object.assign({ type: type, requestId: requestId }, payload || {}));
    });
  }

  function withBookBase(html) {
    const imageCss = '<style>img, video, canvas, svg { max-width: 100%; min-width: 0; height: auto; }</style>';
    if (!bookAssetsOrigin) {
      if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, "<head$1>" + imageCss);
      if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, "<html$1><head>" + imageCss + "</head>");
      return "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">" + imageCss + "</head><body>" + html + "</body></html>";
    }
    const origin = bookAssetsOrigin.replace(/\/?$/, "/");
    const base = '<base href="' + origin.replace(/"/g, "&quot;") + '">' + imageCss;
    if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, "<head$1>" + base);
    if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, "<html$1><head>" + base + "</head>");
    return "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">" + base + "</head><body>" + html + "</body></html>";
  }
  function wrapRead(html) {
    const value = String(html || "");
    if (/<html[\s>]/i.test(value)) return withBookBase(value);
    return withBookBase("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head><body>" + value + "</body></html>");
  }
  function renderRead() {
    const frame = $("readFrame");
    frame.srcdoc = wrapRead(state.html || "<p style='color:#888'>空 HTML 文件</p>");
    frame.onload = () => { bindTocScroll(); updateReadProgress(); };
  }
  function scheduleTocActive() {
    updateReadProgress();
    clearTimeout(state.tocScrollTimer);
    state.tocScrollTimer = setTimeout(updateTocActive, 50);
  }
  function bindTocScroll() {
    try {
      const win = $("readFrame").contentWindow;
      if (!win) return;
      win.removeEventListener("scroll", scheduleTocActive);
      win.addEventListener("scroll", scheduleTocActive, { passive: true });
      updateTocActive();
      updateReadProgress();
    } catch { }
  }
  function updateTocActive() {
    const panel = $("tocPanel");
    const items = Array.from(document.querySelectorAll(".toc-item"));
    if (!items.length) return;
    try {
      const win = $("readFrame").contentWindow;
      const doc = $("readFrame").contentDocument;
      if (!win || !doc) return;
      const headings = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6"));
      if (!headings.length) return;
      const threshold = Math.max(80, (win.innerHeight || 700) * 0.24);
      let active = 0;
      headings.forEach((heading, index) => {
        if (heading.getBoundingClientRect().top <= threshold) active = index;
      });
      items.forEach((item, index) => item.classList.toggle("active", index === active));
      updateReadProgress();
      if (panel && !panel.hidden && items[active]) items[active].scrollIntoView({ block: "nearest" });
    } catch { }
  }

  function editorUrl() {
    if (isFilePreview) return "../Lyra-Extension-HTML-Editor/index.html?embedded=1&extensionsOrigin=" + encodeURIComponent(editorOrigin);
    return editorOrigin + "/html-editor/index.html?embedded=1&v=290&extensionsOrigin=" + encodeURIComponent(editorOrigin);
  }
  function editorTargetOrigin() {
    return isFilePreview ? "*" : editorOrigin;
  }
  function sendEditor(type, extra) {
    const frame = $("editFrame");
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(Object.assign({ channel: EDIT_CHANNEL, type: type }, extra || {}), editorTargetOrigin());
  }
  function sendEditorDocument() {
    sendEditor(state.editorInited ? "set-document" : "init", { html: state.html, title: state.title, assetMode: "external", baseHref: bookAssetsOrigin });
    state.editorInited = true;
  }
  function ensureEditor() {
    const frame = $("editFrame");
    if (frame.dataset.loaded === "1") return;
    frame.dataset.loaded = "1";
    frame.src = editorUrl();
    frame.addEventListener("load", () => {
      state.editorReady = false;
      state.editorInited = false;
      // 编辑器会先发 ready；若 ready 丢包，1.2 秒后兜底 init。
      setTimeout(() => { if (!state.editorInited) sendEditorDocument(); }, 1200);
    });
  }

  function markDirty() {
    state.dirty = true;
    setStatus("编辑中…");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { saveNow().catch(showError); }, 700);
  }

  async function saveNow() {
    clearTimeout(state.saveTimer);
    if (!state.dirty) return;
    try {
      const payload = { data: encodeText(state.html) };
      if (state.projectMode && state.currentRel) payload.path = state.currentRel;
      const res = await hostCall("host.workspace.save", payload);
      if (!res || !res.ok) throw new Error((res && res.error) || "保存失败");
      state.dirty = false;
      setStatus("已保存", "ok");
    } catch (e) {
      setStatus("保存失败", "error");
      throw e;
    }
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    const editing = mode === "edit";
    $("readModeBtn").classList.toggle("active", !editing);
    $("editModeBtn").classList.toggle("active", editing);
    $("readFrame").hidden = editing;
    $("editFrame").hidden = !editing;
      if ($("readProgress")) $("readProgress").hidden = editing;
      const toc = $("tocPanel");
      if (toc) toc.hidden = true;
    if (editing) {
      ensureEditor();
      if (state.editorInited) sendEditorDocument();
      setStatus("编辑模式");
    } else {
        renderToc();
      renderRead();
      saveNow().catch(() => {});
      setStatus("阅读模式");
    }
  }

  function collectLocalMediaRefs(html) {
    const refs = new Set();
    String(html || '').replace(/<(img|video|audio|source|track)\b[^>]*>/gi, (tag) => {
      tag.replace(/\b(?:src|poster)\s*=\s*(["'])([^"']+)\1/gi, (m, q, url) => { refs.add(url); return m; });
      tag.replace(/\bsrcset\s*=\s*(["'])([^"']+)\1/gi, (m, q, value) => {
        value.split(',').forEach((part) => {
          const url = part.trim().split(/\s+/)[0];
          if (url) refs.add(url);
        });
        return m;
      });
      return tag;
    });
      String(html || '').replace(/<link\b[^>]*>/gi, (tag) => {
        const href = (tag.match(/\bhref\s*=\s*(["'])([^"']+)\1/i) || [])[2];
        const rel = (tag.match(/\brel\s*=\s*(["'])([^"']+)\1/i) || [])[2] || "";
        if (href && (!rel || /stylesheet|icon|preload|modulepreload/i.test(rel))) refs.add(href);
        return tag;
      });
      String(html || '').replace(/<script\b[^>]*>/gi, (tag) => {
        const src = (tag.match(/\bsrc\s*=\s*(["'])([^"']+)\1/i) || [])[2];
        if (src) refs.add(src);
        return tag;
      });
    String(html || '').replace(/url\(\s*(["']?)([^)'"]+)\1\s*\)/gi, (m, q, url) => { refs.add(url); return m; });
    return refs;
  }
  function localMediaSkipped(url) {
    const value = String(url || '').trim();
    if (!value) return true;
    if (/^(data:|blob:|https?:|\/\/|#|mailto:|javascript:|tel:|about:)/i.test(value)) return true;
    if (/^assets\//i.test(value)) return true;
    if (value.includes('{{') || value.includes('}}')) return true;
    return false;
  }
  async function migrateLocalAssets() {
    if (!host || isFilePreview) return;
    const refs = collectLocalMediaRefs(state.html);
    let migrated = 0;
    const failed = [];
    for (const ref of refs) {
      if (localMediaSkipped(ref)) continue;
      try {
        const res = await hostCall("host.file.import", { path: ref });
        if (res && res.ok && res.path) {
          state.html = String(state.html).split(ref).join(res.path);
          migrated += 1;
        } else {
          failed.push(ref + "（" + ((res && res.error) || "导入失败") + "）");
        }
      } catch (e) {
        failed.push(ref + "（" + String((e && e.message) || e) + "）");
      }
    }
    if (migrated > 0) {
      await hostCall("host.workspace.save", { data: encodeText(state.html) });
      state.dirty = false;
      setStatus("已迁移 " + migrated + " 个媒体到 assets/", "ok");
    } else if (failed.length) {
      setStatus("有 " + failed.length + " 个本地媒体未能迁移：" + failed[0], "error");
    }
    return migrated;
  }

    function collectToc() {
      try {
        const doc = new DOMParser().parseFromString(String(state.html || ""), "text/html");
        return Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6"))
          .map((el) => ({ level: Number(el.tagName.slice(1)) || 1, text: (el.textContent || "").replace(/\s+/g, " ").trim() }))
          .filter((item) => item.text);
      } catch { return []; }
    }
    function renderToc() {
      state.headings = collectToc();
      const panel = $("tocPanel");
      const list = $("tocList");
      const btn = $("tocBtn");
      if (!panel || !list || !btn) return;
      btn.hidden = state.headings.length === 0;
      btn.textContent = "目录" + (state.headings.length ? " " + state.headings.length : "");
      list.innerHTML = "";
      if (!state.headings.length) {
        const empty = document.createElement("div");
        empty.className = "toc-empty";
        empty.textContent = "没有标题";
        list.appendChild(empty);
        return;
      }
      state.headings.forEach((item, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "toc-item";
        row.textContent = item.text;
        row.style.paddingLeft = 7 + (item.level - 1) * 12 + "px";
        row.title = item.text;
        row.addEventListener("click", () => jumpToHeading(index));
        list.appendChild(row);
      });
    }
    function jumpToHeading(index) {
      if (state.mode !== "read") setMode("read");
      setTimeout(() => {
        try {
          const doc = $("readFrame").contentDocument;
          const nodes = doc ? doc.querySelectorAll("h1,h2,h3,h4,h5,h6") : [];
          if (nodes[index]) nodes[index].scrollIntoView({ behavior: "smooth", block: "start" });
        } catch { }
      }, state.mode === "read" ? 40 : 280);
    }
    $("tocBtn").addEventListener("click", () => {
      const panel = $("tocPanel");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderToc();
    });
    $("tocCloseBtn").addEventListener("click", () => { $("tocPanel").hidden = true; });

  function clearFindMarks() {
    try {
      const doc = $("readFrame").contentDocument;
      if (!doc) return;
      const marks = Array.from(doc.querySelectorAll("mark.lyra-find-mark"));
      const parents = new Set();
      marks.forEach((mark) => {
        const parent = mark.parentNode;
        if (!parent) return;
        parents.add(parent);
        parent.replaceChild(doc.createTextNode(mark.textContent || ""), mark);
      });
      parents.forEach((parent) => parent.normalize());
    } catch { }
  }
  function openFindBar() {
    const bar = $("findBar");
    if (!bar) return;
    bar.hidden = false;
    const input = $("findInput");
    input.focus();
    input.select();
  }
  function closeFindBar() {
    const bar = $("findBar");
    if (bar) bar.hidden = true;
    clearFindMarks();
    state.findMarks = [];
    state.findIndex = -1;
  }
  function updateFindCount() {
    const count = $("findCount");
    if (!count) return;
    const total = (state.findMarks || []).length;
    count.textContent = total ? (state.findIndex + 1) + "/" + total : "0/0";
  }
  function selectFindMark(index) {
    const marks = state.findMarks || [];
    if (!marks.length) { updateFindCount(); return; }
    state.findIndex = (index + marks.length) % marks.length;
    marks.forEach((mark, i) => mark.classList.toggle("current", i === state.findIndex));
    try { marks[state.findIndex].scrollIntoView({ behavior: "smooth", block: "center" }); } catch { }
    updateFindCount();
  }
  function runFind(query) {
    clearFindMarks();
    state.findMarks = [];
    state.findIndex = -1;
    const value = String(query || "");
    if (!value) { updateFindCount(); return; }
    try {
      const doc = $("readFrame").contentDocument;
      if (!doc || !doc.body) { updateFindCount(); return; }
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentNode;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = (parent.tagName || "").toLowerCase();
          if (["script", "style", "noscript", "textarea", "input", "select", "option"].includes(tag)) return NodeFilter.FILTER_REJECT;
          if (parent.closest && parent.closest("mark.lyra-find-mark")) return NodeFilter.FILTER_REJECT;
          return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const needle = value.toLowerCase();
      const marks = [];
      for (const node of nodes) {
        const text = node.nodeValue || "";
        const lower = text.toLowerCase();
        let at = lower.indexOf(needle);
        if (at < 0) continue;
        const fragment = doc.createDocumentFragment();
        let last = 0;
        while (at >= 0) {
          fragment.appendChild(doc.createTextNode(text.slice(last, at)));
          const mark = doc.createElement("mark");
          mark.className = "lyra-find-mark";
          mark.textContent = text.slice(at, at + value.length);
          fragment.appendChild(mark);
          marks.push(mark);
          last = at + value.length;
          at = lower.indexOf(needle, last);
        }
        fragment.appendChild(doc.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(fragment, node);
      }
      state.findMarks = marks;
      if (marks.length) selectFindMark(0);
      else updateFindCount();
    } catch { updateFindCount(); }
  }
  function moveFind(delta) {
    const marks = state.findMarks || [];
    if (!marks.length) { runFind($("findInput").value || ""); return; }
    selectFindMark(state.findIndex + delta);
  }
  function updateReadProgress() {
    const bar = $("readProgress");
    const fill = $("readProgressFill");
    if (!bar || !fill) return;
    if (state.mode !== "read") { bar.hidden = true; return; }
    try {
      const win = $("readFrame").contentWindow;
      const doc = $("readFrame").contentDocument;
      if (!win || !doc || !doc.documentElement) return;
      const max = Math.max(1, (doc.documentElement.scrollHeight || 0) - (win.innerHeight || 0));
      const y = Math.max(0, win.scrollY || 0);
      const percent = Math.min(100, (y / max) * 100);
      fill.style.width = percent.toFixed(2) + "%";
      bar.hidden = false;
      bar.title = "阅读进度 " + Math.round(percent) + "%";
    } catch { }
  }

function renderProjectList() {
  const list = $("projectList");
  if (!list) return;
  list.innerHTML = "";
  if (!state.projectFiles.length) {
    const empty = document.createElement("div");
    empty.className = "project-empty";
    empty.textContent = "项目里没有 HTML 文件";
    list.appendChild(empty);
    return;
  }
  state.projectFiles.forEach((file) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "project-item" + (file.rel === state.currentRel ? " active" : "");
    const dir = file.dir ? file.dir + "/" : "";
    if (dir) {
      const span = document.createElement("span");
      span.className = "project-dir";
      span.textContent = dir;
      btn.appendChild(span);
    }
    btn.appendChild(document.createTextNode(file.title || file.rel));
    btn.title = file.rel;
    btn.addEventListener("click", () => { openProjectFile(file.rel).catch(showError); });
    list.appendChild(btn);
  });
}
async function openProjectFile(rel) {
  if (state.dirty) await saveNow();
  const res = await hostCall("host.workspace.load", { path: rel });
  if (!res || !res.ok) throw new Error((res && res.error) || "读取项目文件失败");
  state.currentRel = res.rel || rel;
  const dir = state.currentRel.includes("/") ? state.currentRel.slice(0, state.currentRel.lastIndexOf("/")) : "";
  state.currentDir = dir;
  state.baseHref = bookAssetsOrigin ? bookAssetsOrigin.replace(/\/?$/, "/") + (dir ? dir + "/" : "") : "";
  state.title = res.name || state.currentRel.split("/").pop();
  state.html = res.data ? decodeText(res.data) : "";
  state.path = res.path || state.currentRel;
  state.dirty = false;
  $("fileName").textContent = state.title;
  $("filePath").textContent = state.projectName + " / " + state.currentRel;
  document.title = (state.projectName || state.title) + " · HTML 项目";
  renderToc();
  renderRead();
  renderProjectList();
  const panel = $("projectPanel");
  if (panel) panel.hidden = true;
  setStatus("已加载 " + state.currentRel, "ok");
  if (state.mode === "edit" && state.editorInited) sendEditorDocument();
}
async function initProject() {
  const info = await hostCall("host.project.list");
  if (!info || !info.ok) throw new Error((info && info.error) || "读取项目失败");
  state.projectName = info.name || state.projectName || "HTML 项目";
  state.projectRoot = info.root || "";
  state.projectFiles = Array.isArray(info.files) ? info.files : [];
  $("fileName").textContent = state.projectName;
  $("filePath").textContent = state.projectRoot;
  document.title = state.projectName + " · HTML 项目";
  $("projectTitle").textContent = state.projectName;
  $("projectBtn").hidden = false;
  renderProjectList();
  if (!state.projectFiles.length) throw new Error("项目里没有 .html/.htm 文件，请先新建项目。");
  const target = state.projectFiles.find((f) => f.isIndex) || state.projectFiles[0];
  await openProjectFile(target.rel);
  if (host) host.postMessage({ type: "host.ready" });
}
async function initLegacy() {
    $("filePath").textContent = params.get("name") || "";
    document.title = state.title + " · HTML 阅读器";
    try {
      const res = await hostCall("host.workspace.load");
      if (!res || !res.ok) throw new Error((res && res.error) || "读取 HTML 文件失败");
      state.path = res.path || "";
      if (res.data) state.html = decodeText(res.data);
      if (!state.html.trim()) {
        state.html = "<h1>" + state.title.replace(/[<>&]/g, "") + "</h1>\n<p>这是一个空 HTML 文件，点击右上角“编辑”开始写。</p>";
      }
        renderToc();
      renderRead();
      setStatus("已加载", "ok");
      const migrated = await migrateLocalAssets();
      if (migrated > 0) renderRead();
      if (host) host.postMessage({ type: "host.ready" });
      $("filePath").textContent = state.path || params.get("name") || "";
    } catch (e) {
      showError(e);
    }
}

  async function handleEditorFileRequest(request) {
    const command = String(request.command || "");
    const extra = Object.assign({}, request);
    delete extra.requestId; delete extra.type; delete extra.channel; delete extra.command;
    if (state.projectMode) {
      const withDir = (value) => {
        if (!value || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("//")) return value;
        return (state.currentDir ? state.currentDir + "/" : "") + String(value).replace(/^\/+/, "");
      };
      if (extra.path) extra.path = withDir(extra.path);
      if (extra.from) extra.from = withDir(extra.from);
      if (extra.to) extra.to = withDir(extra.to);
    }
    try {
      const res = await hostCall(command, extra);
      sendEditor("file-result", {
        requestId: request.requestId,
        ok: !!(res && res.ok),
        error: (res && res.error) || "",
        path: (res && res.path) || "",
      });
    } catch (e) {
      sendEditor("file-result", { requestId: request.requestId, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  async function saveReaderAsset(request) {
    try {
      const safeName = String(request.name || "image").replace(/[^\w.\-]+/g, "_").slice(-80) || "image";
      const dot = safeName.lastIndexOf(".");
      const ext = dot >= 0 ? safeName.slice(dot) : ".png";
      const stem = (dot >= 0 ? safeName.slice(0, dot) : safeName) || "image";
      const dirPrefix = state.projectMode && state.currentDir ? state.currentDir + "/" : "";
      const path = dirPrefix + "assets/" + Date.now().toString(36) + "-" + stem + ext;
      const res = await hostCall("host.file.save", { path: path, data: request.data || "" });
      if (!res || !res.ok) throw new Error((res && res.error) || "保存图片失败");
      const displayPath = state.projectMode && state.currentDir && path.startsWith(state.currentDir + "/") ? path.slice(state.currentDir.length + 1) : path;
      sendEditor("asset-result", { requestId: request.requestId, ok: true, path: displayPath });
      setStatus("已插入图片", "ok");
    } catch (e) {
      sendEditor("asset-result", { requestId: request.requestId, ok: false, error: String(e && e.message ? e.message : e) });
      setStatus("图片保存失败", "error");
    }
  }

  window.addEventListener("message", (event) => {
    const frame = $("editFrame");
    if (!frame || event.source !== frame.contentWindow) return;
    const d = event.data || {};
    if (d.channel !== EDIT_CHANNEL) return;
    if (d.type === "file-request") { handleEditorFileRequest(d); return; }
    if (d.type === "asset-request") {
      saveReaderAsset(d);
      return;
    }
    if (d.type === "ready") {
      state.editorReady = true;
      if (!state.editorInited) sendEditorDocument();
      setStatus("编辑器已就绪", "ok");
    } else if (d.type === "loaded") {
      setStatus("编辑模式");
    } else if (d.type === "change") {
      state.html = d.html || "";
      markDirty();
          renderToc();
    }
  });

  $("readModeBtn").addEventListener("click", () => setMode("read"));
  $("findInput").addEventListener("input", () => runFind($("findInput").value));
  $("findInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); moveFind(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); closeFindBar(); }
  });
  $("findPrev").addEventListener("click", () => moveFind(-1));
  $("findNext").addEventListener("click", () => moveFind(1));
  $("findClose").addEventListener("click", closeFindBar);
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openFindBar(); }
    else if (e.key === "Escape" && !$("findBar").hidden) closeFindBar();
  });
  $("projectBtn").addEventListener("click", () => {
    const panel = $("projectPanel");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderProjectList();
  });
  $("projectCloseBtn").addEventListener("click", () => { $("projectPanel").hidden = true; });
  $("editModeBtn").addEventListener("click", () => setMode("edit"));
  $("saveBtn").addEventListener("click", () => saveNow().catch(showError));
  $("errorClose").addEventListener("click", () => { $("errorMask").hidden = true; });

  async function init() {
    if (state.projectMode) {
      try { await initProject(); } catch (e) { showError(e); if (host) host.postMessage({ type: "host.ready" }); }
      return;
    }
    await initLegacy();
  }

  init();
})();