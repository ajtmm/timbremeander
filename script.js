/* =========================================================
   Timbre Meander — script.js
   Loads poems from /poems/manifest.json, renders a random one,
   provides "new", "copy", and "share" actions.
   ========================================================= */

(() => {
  const POEMS_DIR    = "poems/";
  const MANIFEST_URL = POEMS_DIR + "manifest.json";

  // --- DOM references ---------------------------------------------------
  const $poem      = document.getElementById("poem");
  const $btnNew    = document.getElementById("btn-new");
  const $btnCopy   = document.getElementById("btn-copy");
  const $btnShare  = document.getElementById("btn-share");
  const $toast     = document.getElementById("toast");
  const $themeSelect = document.getElementById("theme-select");

  const THEME_KEY = "timbre-meander-theme";
  const THEMES = ["cyberpunk", "minimal", "dracula", "terminal"];

  // --- Theme handling ----------------------------------------------------
  function applyTheme(theme) {
    const chosen = THEMES.includes(theme) ? theme : "cyberpunk";
    document.documentElement.setAttribute("data-theme", chosen);
    if ($themeSelect) $themeSelect.value = chosen;
    try { localStorage.setItem(THEME_KEY, chosen); } catch (err) { /* ignore */ }
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* ignore */ }
    applyTheme(saved || "cyberpunk");
    if ($themeSelect) {
      $themeSelect.addEventListener("change", (e) => applyTheme(e.target.value));
    }
  }

  // --- State -----------------------------------------------------------
  let manifest = [];          // ["whisper-of-october.md", ...]
  let lastFile = null;        // avoid repeating the same poem twice in a row
  let currentPoem = {         // currently displayed poem
    title:  "",
    author: "",
    body:   "",
    raw:    "",
  };

  // --- Toast helper ----------------------------------------------------
  let toastTimer;
  function toast(message, isError = false) {
    $toast.textContent = message;
    $toast.classList.toggle("error", !!isError);
    $toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.remove("visible"), 2200);
  }

  // --- Markdown parsing ------------------------------------------------
  // We want hard line breaks (single newlines) to be preserved, since
  // poems rely on lineation. marked.js with `breaks: true` does this.
  function configureMarked() {
    if (window.marked && marked.setOptions) {
      marked.setOptions({ breaks: true, gfm: true });
    }
  }

  /**
   * Parse a poem from markdown.
   * Convention:
   *   # Title
   *   *by Author Name*
   *
   *   poem body...
   */
  function parsePoem(markdown) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");

    let title = "";
    let author = "";
    let bodyStart = 0;

    // First non-blank line beginning with "# " is the title.
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("# ")) {
        title = trimmed.replace(/^#\s+/, "").trim();
        bodyStart = i + 1;
      }
      break;
    }

    // Next non-blank line, if italic "*by ...*" or "by ...", is the author.
    for (let i = bodyStart; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) { bodyStart = i + 1; continue; }
      const m = trimmed.match(/^\*?\s*by\s+(.+?)\s*\*?$/i);
      if (m) {
        author = m[1].trim();
        bodyStart = i + 1;
      }
      break;
    }

    const bodyMd = lines.slice(bodyStart).join("\n").trim();
    const bodyHtml = (window.marked ? marked.parse(bodyMd) : escapeHtml(bodyMd));
    const bodyText = markdownToPlainText(bodyMd);
    const authorPlain = markdownToPlainText(author);

    return { title, author, authorPlain, bodyHtml, bodyText, raw: markdown };
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Strip common inline markdown so the copy/share plain-text version is clean.
  function markdownToPlainText(md) {
    if (!md) return "";
    return md
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")  // images → alt text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // links  → link text
      .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")     // inline code
      .replace(/\*\*([^*]+)\*\*/g, "$1")         // bold **
      .replace(/__([^_]+)__/g, "$1")             // bold __
      .replace(/\*([^*]+)\*/g, "$1")             // italic *
      .replace(/_([^_]+)_/g, "$1");              // italic _
  }

  // --- Rendering -------------------------------------------------------
  function renderPoem(parsed) {
    currentPoem = {
      title:  parsed.title,
      author: parsed.authorPlain || parsed.author,
      body:   parsed.bodyText,
      raw:    parsed.raw,
    };

    const titleHtml = parsed.title? `<h1>${escapeHtml(parsed.title)}</h1>`
      : "";

    // Render the author as inline markdown so [Name](url) becomes a real link,
    // *emphasis* stays italic, etc. parseInline avoids wrapping in <p>.
    const authorInline = parsed.author? (window.marked ? marked.parseInline(parsed.author) : escapeHtml(parsed.author))
      : "";
    const authorHtml = authorInline? `<p class="author">by ${authorInline}</p>`
      : "";

    const divider = (parsed.title || parsed.author)? `<div class="divider"></div>`
      : "";

    $poem.innerHTML = `${titleHtml}${authorHtml}${divider}<div class="body">${parsed.bodyHtml}</div>`;
  }

  function showLoader() {
    $poem.innerHTML = `<div class="poem-loader"><span>&#10042;</span></div>`;
  }

  // --- Poem loading ----------------------------------------------------
  async function loadManifest() {
    try {
      const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("manifest fetch failed: " + res.status);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.poems;
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error("manifest is empty");
      }
      manifest = list;
    } catch (err) {
      console.error(err);
      $poem.innerHTML = `<p class="body" style="color: var(--red); text-align:center;">
        Could not load the poem manifest. Make sure <code>poems/manifest.json</code> exists.
      </p>`;
      toast("could not load poems", true);
    }
  }

  function pickRandomFile() {
    if (manifest.length === 1) return manifest[0];
    let pick;
    do {
      pick = manifest[Math.floor(Math.random() * manifest.length)];
    } while (pick === lastFile);
    lastFile = pick;
    return pick;
  }

  async function loadRandomPoem() {
    if (manifest.length === 0) return;

    const file = pickRandomFile();
    const url  = POEMS_DIR + file;

    $poem.classList.add("fading");
    await wait(300);
    showLoader();

    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error("poem fetch failed: " + res.status);
      const md = await res.text();
      const parsed = parsePoem(md);
      renderPoem(parsed);
    } catch (err) {
      console.error(err);
      $poem.innerHTML = `<p class="body" style="color: var(--red); text-align:center;">
        Could not load that poem.
      </p>`;
      toast("could not load poem", true);
    } finally {
      $poem.classList.remove("fading");
    }
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  // --- Formatting for copy / share -------------------------------------
  function poemAsPlainText() {
    const { title, author, body } = currentPoem;
    let out = "";
    if (title)  out += title + "\n";
    if (author) out += "by " + author + "\n";
    if (title || author) out += "\n";
    out += body.trim();
    out += "\n\n— via Timbre Meander";
    return out;
  }

  // --- Actions ---------------------------------------------------------
  async function copyPoem() {
    const text = poemAsPlainText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast("poem copied");
    } catch (err) {
      console.error(err);
      toast("copy failed", true);
    }
  }

  async function sharePoem() {
    const { title } = currentPoem;
    const text = poemAsPlainText();
    const shareData = {
      title: title ? `${title} — Timbre Meander` : "Timbre Meander",
      text,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        // success — no toast needed, the native sheet provides feedback
      } catch (err) {
        // user cancelled or share failed
        if (err && err.name !== "AbortError") {
          console.error(err);
          toast("share failed", true);
        }
      }
    } else {
      // Fallback: copy the poem text so the user can paste it anywhere.
      await copyPoem();
      toast("copied for sharing");
    }
  }

  // --- Wire up ---------------------------------------------------------
  function bindEvents() {
    $btnNew.addEventListener("click", loadRandomPoem);
    $btnCopy.addEventListener("click", copyPoem);
    $btnShare.addEventListener("click", sharePoem);

    // Keyboard shortcut: spacebar / 'n' for new poem
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "n" || e.key === "N") loadRandomPoem();
    });
  }

  // --- Init ------------------------------------------------------------
  async function init() {
    initTheme();
    configureMarked();
    bindEvents();
    await loadManifest();
    if (manifest.length > 0) await loadRandomPoem();
  }

  // marked is loaded via defer, so DOM is ready by the time this fires.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
