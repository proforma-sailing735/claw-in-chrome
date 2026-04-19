(function () {
  if (!globalThis.chrome?.runtime?.id) {
    return;
  }

  const uiContract = globalThis.__CP_CONTRACT__?.ui || {};
  const PANEL_ID = "cp-options-visualizer-panel";
  const ANCHOR_ID = "cp-options-visualizer-anchor";
  const BUTTON_ATTR = "data-cp-visualizer-launch";
  const ROOT_ATTR = "data-cp-visualizer-root";
  const PRIMARY_BUTTON_CLASS = "px-6 py-3 bg-brand-100 text-oncolor-100 rounded-xl hover:bg-brand-100/90 transition-all font-large disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2";
  const PREFERRED_LOCALE_STORAGE_KEY = uiContract.PREFERRED_LOCALE_STORAGE_KEY || "preferred_locale";

  const STRINGS = {
    zh: {
      updatesTitle: "扩展更新",
      cardTitle: "执行可视化",
      cardSubtitle: "打开一个独立全屏页，用真实的本地会话数据查看请求、工具执行步骤和最终答复。",
      cardMeta: "默认优先显示当前 activeSession；没有运行中的请求时，会自动回退到最近一次本地会话。",
      buttonLabel: "打开执行可视化",
      openFailed: "打开执行可视化失败：{message}",
      unknown: "未知原因"
    },
    en: {
      updatesTitle: "Extension updates",
      cardTitle: "Execution visualizer",
      cardSubtitle: "Open a standalone full-screen page that shows the request, tool execution steps, and final answer from real local session data.",
      cardMeta: "It prefers the current activeSession and falls back to the most recent local session when nothing is running.",
      buttonLabel: "Open visualizer",
      openFailed: "Failed to open visualizer: {message}",
      unknown: "unknown reason"
    }
  };

  let renderScheduled = false;
  let openStatus = null;
  let mountRetryBudget = 0;

  function buildRenderSignature(strings) {
    const currentStrings = strings || getStrings();
    return [
      getLocaleKey(),
      currentStrings.cardTitle,
      currentStrings.cardSubtitle,
      currentStrings.cardMeta,
      currentStrings.buttonLabel,
      openStatus?.kind || "",
      openStatus?.text || ""
    ].join("||");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function interpolate(template, values) {
    return String(template || "").replace(/\{(\w+)\}/g, function (_, key) {
      return values && values[key] != null ? String(values[key]) : "";
    });
  }

  function normalizeLocaleKey(value) {
    const locale = String(value || "").trim().toLowerCase();
    if (!locale) {
      return "";
    }
    return locale.startsWith("zh") ? "zh" : "en";
  }

  function getLocaleKey() {
    const pageText = String(document.body?.innerText || document.body?.textContent || "");
    if (pageText.includes("Claw in Chrome 设置") || pageText.includes("扩展更新") || pageText.includes("选项")) {
      return "zh";
    }
    const htmlLang = String(document.documentElement.lang || "").toLowerCase();
    if (htmlLang.startsWith("zh")) {
      return "zh";
    }
    return normalizeLocaleKey(navigator.language) || "en";
  }

  async function readPreferredLocaleKey() {
    try {
      const stored = await chrome.storage.local.get(PREFERRED_LOCALE_STORAGE_KEY);
      return normalizeLocaleKey(stored[PREFERRED_LOCALE_STORAGE_KEY]);
    } catch {
      return "";
    }
  }

  async function buildVisualizerTargetUrl() {
    const baseUrl = chrome.runtime.getURL("visualizer.html");
    const separator = baseUrl.includes("?") ? "&" : "?";
    const localeKey = await readPreferredLocaleKey() || getLocaleKey();
    return baseUrl + separator + "locale=" + encodeURIComponent(localeKey === "zh" ? "zh-CN" : "en-US");
  }

  function getStrings() {
    return STRINGS[getLocaleKey()];
  }

  function getActiveTab() {
    const hash = String(window.location.hash || "").replace(/^#/, "");
    return (hash.split("?")[0] || "permissions").toLowerCase();
  }

  function getHashQuery() {
    const hash = String(window.location.hash || "").replace(/^#/, "");
    const parts = hash.split("?");
    return new URLSearchParams(parts[1] || "");
  }

  function isOptionsRootView() {
    if (getActiveTab() !== "options") {
      return false;
    }
    const subview = String(getHashQuery().get("provider") || "").trim().toLowerCase();
    return !subview;
  }

  function findUpdatePanel() {
    const strings = getStrings();
    return Array.from(document.querySelectorAll("section")).find(function (section) {
      const heading = section.querySelector("h3");
      return heading && String(heading.textContent || "").trim() === strings.updatesTitle;
    }) || null;
  }

  function ensureAnchor(updatePanel) {
    let anchor = document.getElementById(ANCHOR_ID);
    if (!anchor) {
      anchor = document.createElement("div");
      anchor.id = ANCHOR_ID;
      anchor.hidden = true;
      anchor.setAttribute("aria-hidden", "true");
    }
    if (updatePanel.nextElementSibling !== anchor) {
      updatePanel.insertAdjacentElement("afterend", anchor);
    }
    return anchor;
  }

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(ANCHOR_ID)?.remove();
  }

  function getErrorMessage(error) {
    const raw = String(error?.message || error || "").trim();
    return raw || getStrings().unknown;
  }

  function openWithWindow(url) {
    try {
      return !!window.open(url, "_blank", "noopener");
    } catch {
      return false;
    }
  }

  function setOpenError(error) {
    openStatus = {
      kind: "error",
      text: interpolate(getStrings().openFailed, {
        message: getErrorMessage(error)
      })
    };
    scheduleRender();
  }

  async function openVisualizerPage() {
    const targetUrl = await buildVisualizerTargetUrl();
    openStatus = null;
    scheduleRender();

    try {
      if (globalThis.chrome?.tabs?.create) {
        chrome.tabs.create({
          url: targetUrl
        }, function () {
          if (chrome.runtime.lastError) {
            if (!openWithWindow(targetUrl)) {
              setOpenError(chrome.runtime.lastError.message);
              return;
            }
          }
          if (openStatus) {
            openStatus = null;
            scheduleRender();
          }
        });
        return;
      }
    } catch (error) {
      if (!openWithWindow(targetUrl)) {
        setOpenError(error);
      }
      return;
    }

    if (!openWithWindow(targetUrl)) {
      setOpenError("unable to create tab");
    }
  }

  function buildPanel() {
    const strings = getStrings();
    const renderSignature = buildRenderSignature(strings);
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("section");
      panel.id = PANEL_ID;
      panel.className = "cp-page-card cp-page-panel bg-bg-100 border border-border-300 rounded-xl px-6 pt-6 pb-6 md:px-8 md:pt-8 md:pb-8";
      panel.setAttribute(ROOT_ATTR, "true");
    }
    panel.style.marginTop = "24px";
    panel.style.position = "relative";
    panel.style.zIndex = "1";
    panel.style.pointerEvents = "auto";
    if (panel.dataset.cpVisualizerSignature === renderSignature) {
      return panel;
    }
    panel.innerHTML = `
      <div class="cp-page-stack" style="display:flex; flex-direction:column; gap:16px;">
        <div>
          <h3 class="cp-page-heading text-text-100 font-xl-bold">${escapeHtml(strings.cardTitle)}</h3>
          <p class="cp-page-subheading text-text-300 font-base">${escapeHtml(strings.cardSubtitle)}</p>
        </div>
        <div class="cp-page-meta" data-tone="loading">${escapeHtml(strings.cardMeta)}</div>
        ${openStatus ? `<div class="cp-page-status" data-kind="${escapeHtml(openStatus.kind || "error")}">${escapeHtml(openStatus.text || "")}</div>` : ""}
        <div class="cp-page-btn-row">
          <button
            type="button"
            class="${escapeHtml(PRIMARY_BUTTON_CLASS)}"
            ${BUTTON_ATTR}="true"
            aria-label="${escapeHtml(strings.buttonLabel)}"
            title="${escapeHtml(strings.buttonLabel)}"
          >${escapeHtml(strings.buttonLabel)}</button>
        </div>
      </div>
    `;
    const button = panel.querySelector("[" + BUTTON_ATTR + "]");
    if (button) {
      button.style.pointerEvents = "auto";
      button.onclick = function () {
        openVisualizerPage().catch(function (error) {
          setOpenError(error);
        });
      };
    }
    panel.dataset.cpVisualizerSignature = renderSignature;
    return panel;
  }

  function renderPanel() {
    if (!isOptionsRootView()) {
      removePanel();
      return true;
    }
    const updatePanel = findUpdatePanel();
    if (!updatePanel) {
      removePanel();
      return false;
    }
    const anchor = ensureAnchor(updatePanel);
    const panel = buildPanel();
    if (anchor.nextElementSibling !== panel) {
      anchor.insertAdjacentElement("afterend", panel);
    }
    return true;
  }

  function requestMountRetries(attempts) {
    const nextAttempts = Number.isFinite(Number(attempts)) ? Math.max(0, Number(attempts)) : 0;
    if (nextAttempts > mountRetryBudget) {
      mountRetryBudget = nextAttempts;
    }
    scheduleRender();
  }

  function scheduleRender() {
    if (renderScheduled) {
      return;
    }
    renderScheduled = true;
    const scheduler = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : function (callback) {
        return setTimeout(callback, 16);
      };
    scheduler(function () {
      renderScheduled = false;
      const mounted = renderPanel();
      if (!mounted && mountRetryBudget > 0) {
        mountRetryBudget -= 1;
        scheduleRender();
        return;
      }
      mountRetryBudget = 0;
    });
  }

  function bootstrap() {
    requestMountRetries(120);
    window.addEventListener("hashchange", function () {
      requestMountRetries(120);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, {
      once: true
    });
  } else {
    bootstrap();
  }
})();
