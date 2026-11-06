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
    $("readFrame").srcdoc = wrapRead(state.html || "<p style='color:#888'>空 HTML 文件</p>");
  }

  function editorUrl() {
    if (isFilePreview) return "../Lyra-Extension-HTML-Editor/index.html?embedded=1&extensionsOrigin=" + encodeURIComponent(editorOrigin);
    return editorOrigin + "/html-editor/index.html?embedded=1&v=285&extensionsOrigin=" + encodeURIComponent(editorOrigin);
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
      const res = await hostCall("host.workspace.save", { data: encodeText(state.html) });
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

  async function init() {
    $("fileName").textContent = state.title;
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

  async function saveReaderAsset(request) {
    try {
      const safeName = String(request.name || "image").replace(/[^\w.\-]+/g, "_").slice(-80) || "image";
      const dot = safeName.lastIndexOf(".");
      const ext = dot >= 0 ? safeName.slice(dot) : ".png";
      const stem = (dot >= 0 ? safeName.slice(0, dot) : safeName) || "image";
      const path = "assets/" + Date.now().toString(36) + "-" + stem + ext;
      const res = await hostCall("host.file.save", { path: path, data: request.data || "" });
      if (!res || !res.ok) throw new Error((res && res.error) || "保存图片失败");
      sendEditor("asset-result", { requestId: request.requestId, ok: true, path: res.path || path });
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
  $("editModeBtn").addEventListener("click", () => setMode("edit"));
  $("saveBtn").addEventListener("click", () => saveNow().catch(showError));
  $("errorClose").addEventListener("click", () => { $("errorMask").hidden = true; });

  init();
})();