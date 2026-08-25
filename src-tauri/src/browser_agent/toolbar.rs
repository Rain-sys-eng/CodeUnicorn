use std::collections::HashMap;

use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

use super::{
    bind_browser_renderer_session, clear_browser_renderer_session, escape_js_string,
    origin_from_normalized_url, platform, spawn_browser_webview_session_patch, unix_time_ms,
    validate_browser_url_for_workspace, BrowserAgentFeaturePhase, BrowserSession,
    BrowserSessionStatus, BROWSER_RENDERER_WINDOW_LABEL,
};

const BROWSER_TOOLBAR_BRIDGE_HOST: &str = "browser-agent-toolbar.invalid";
const BROWSER_TOOLBAR_BRIDGE_PATH: &str = "/__ccgui_toolbar__";
const BROWSER_CONTEXT_ATTACHMENT_REQUEST_EVENT: &str = "browser-agent://attach-current-context";
const BROWSER_ELEMENT_SELECT_ENDED_EVENT: &str = "browser-agent://element-select-ended";

struct BrowserToolbarLabels {
    locale: &'static str,
    brand: &'static str,
    attach: &'static str,
    select: &'static str,
    status_ready: &'static str,
    open: &'static str,
    new_tab: &'static str,
    close: &'static str,
    collapse: &'static str,
    expand: &'static str,
}

fn browser_toolbar_labels(locale: Option<&str>) -> BrowserToolbarLabels {
    let normalized = locale.unwrap_or("zh").trim().to_ascii_lowercase();
    if normalized.starts_with("en") {
        return BrowserToolbarLabels {
            locale: "en",
            brand: "Browser Dock",
            attach: "Attach browser context",
            select: "Select page element for chat",
            status_ready: "Readable",
            open: "Open",
            new_tab: "New browser tab",
            close: "Close",
            collapse: "Collapse toolbar",
            expand: "Expand toolbar",
        };
    }
    BrowserToolbarLabels {
        locale: "zh",
        brand: "浏览器 Dock",
        attach: "关联浏览器上下文",
        select: "选择网页元素加入聊天",
        status_ready: "可读取网页信息",
        open: "打开",
        new_tab: "新建浏览器标签页",
        close: "关闭",
        collapse: "收起工具条",
        expand: "展开工具条",
    }
}

fn browser_agent_toolbar_script(
    browser_session_id: &str,
    workspace_id: &str,
    current_url: &str,
    title: Option<&str>,
    tabs_json: &str,
    locale: Option<&str>,
) -> String {
    let labels = browser_toolbar_labels(locale);
    let mut script = String::from(
        r#"(function () {
  const sessionId = "#,
    );
    script.push_str(&escape_js_string(browser_session_id));
    script.push_str(
        r#";
  const workspaceId = "#,
    );
    script.push_str(&escape_js_string(workspace_id));
    script.push_str(
        r#";
  const currentUrl = "#,
    );
    script.push_str(&escape_js_string(current_url));
    script.push_str(
        r#";
  const pageTitle = "#,
    );
    script.push_str(&escape_js_string(title.unwrap_or("")));
    script.push_str(
        r#";
  const locale = "#,
    );
    script.push_str(&escape_js_string(labels.locale));
    script.push_str(
        r#";
  const labels = {
    brand: "#,
    );
    script.push_str(&escape_js_string(labels.brand));
    script.push_str(
        r#",
    attach: "#,
    );
    script.push_str(&escape_js_string(labels.attach));
    script.push_str(
        r#",
    select: "#,
    );
    script.push_str(&escape_js_string(labels.select));
    script.push_str(
        r#",
    statusReady: "#,
    );
    script.push_str(&escape_js_string(labels.status_ready));
    script.push_str(
        r#",
    open: "#,
    );
    script.push_str(&escape_js_string(labels.open));
    script.push_str(
        r#",
    newTab: "#,
    );
    script.push_str(&escape_js_string(labels.new_tab));
    script.push_str(
        r#",
    close: "#,
    );
    script.push_str(&escape_js_string(labels.close));
    script.push_str(
        r#",
    collapse: "#,
    );
    script.push_str(&escape_js_string(labels.collapse));
    script.push_str(
        r#",
    expand: "#,
    );
    script.push_str(&escape_js_string(labels.expand));
    script.push_str(
        r#",
  };
  const tabs = "#,
    );
    script.push_str(tabs_json);
    script.push_str(
        r#";
  const EXPANDED_HEIGHT = 64;
  const COLLAPSED_HEIGHT = 30;
  const hostId = "ccgui-browser-agent-toolbar";
  const bridgeBase = "https://browser-agent-toolbar.invalid/__ccgui_toolbar__";
  const escapeHtml = (value) => String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const normalizeDraftUrl = (value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  };
  let nextOpenCreatesTab = false;
  let collapsed = false;
  try {
    collapsed = window.localStorage.getItem("ccgui.browserAgent.toolbarCollapsed") === "1";
  } catch (storageReadError) {}
  const sendBridgeAction = (action, extraParams = {}) => {
    const params = new URLSearchParams({
      action,
      sessionId,
      workspaceId,
      locale,
      ...extraParams,
    });
    window.location.href = `${bridgeBase}?${params.toString()}`;
  };
  const host = document.getElementById(hostId) || document.createElement("div");
  host.id = hostId;
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.right = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "auto";
  if (!host.parentNode) {
    (document.documentElement || document.body).appendChild(host);
  }
  const body = document.body;
  const applyChromeHeight = () => {
    const height = collapsed ? COLLAPSED_HEIGHT : EXPANDED_HEIGHT;
    host.style.height = `${height}px`;
    host.style.top = collapsed ? "auto" : "0";
    host.style.bottom = collapsed ? "0" : "auto";
    if (!body) return;
    if (body.dataset.mossxBrowserToolbarPaddingTop === undefined) {
      body.dataset.mossxBrowserToolbarPaddingTop = body.style.paddingTop || "";
    }
    if (body.dataset.mossxBrowserToolbarPaddingBottom === undefined) {
      body.dataset.mossxBrowserToolbarPaddingBottom = body.style.paddingBottom || "";
    }
    const originalPaddingTop = body.dataset.mossxBrowserToolbarPaddingTop || "";
    const originalPaddingBottom = body.dataset.mossxBrowserToolbarPaddingBottom || "";
    body.style.paddingTop = collapsed
      ? originalPaddingTop
      : originalPaddingTop.trim()
        ? `calc(${originalPaddingTop} + ${height}px)`
        : `${height}px`;
    body.style.paddingBottom = collapsed
      ? originalPaddingBottom.trim()
        ? `calc(${originalPaddingBottom} + ${height}px)`
        : `${height}px`
      : originalPaddingBottom;
  };
  applyChromeHeight();
  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  const displayUrl = currentUrl || window.location.href || "";
  const tabLabel = pageTitle || document.title || displayUrl || labels.brand;
  const normalizedTabs = Array.isArray(tabs) && tabs.length > 0
    ? tabs
    : [{ browserSessionId: sessionId, title: tabLabel, url: displayUrl, status: "ready" }];
  const tabMarkup = normalizedTabs.map((tab) => {
    const tabId = String(tab.browserSessionId || "");
    const label = String(tab.title || tab.url || labels.brand);
    const activeClass = tabId === sessionId ? " is-active" : "";
    return `<button class="tab${activeClass}" type="button" data-tab-id="${escapeHtml(tabId)}" title="${escapeHtml(label)}"><span>◉ ${escapeHtml(label)}</span></button>`;
  }).join("");
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .chrome {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .island {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 5px;
        max-width: calc(100vw - 24px);
        padding: 5px 6px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.82);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.9);
        color: #1f2937;
      }
      .dot {
        width: 7px;
        height: 7px;
        margin: 0 2px 0 8px;
        border-radius: 999px;
        background: #16a34a;
        flex: none;
      }
      .tablist {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 0 1 auto;
        max-width: min(38vw, 520px);
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .tablist::-webkit-scrollbar { display: none; }
      .tab {
        display: inline-flex;
        align-items: center;
        max-width: 200px;
        height: 26px;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #6b7280;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }
      .tab:hover { background: rgba(15, 23, 42, 0.06); color: #111827; }
      .tab.is-active { background: rgba(15, 23, 42, 0.1); color: #111827; }
      .tab span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .plus {
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #6b7280;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        flex: none;
      }
      .plus:hover { background: rgba(15, 23, 42, 0.06); color: #111827; }
      .status {
        flex: none;
        padding: 3px 10px;
        border-radius: 999px;
        background: rgba(37, 99, 235, 0.12);
        color: #1d4ed8;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }
      form {
        display: flex;
        align-items: center;
        flex: 0 1 auto;
        min-width: 0;
        gap: 4px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.75);
        padding: 2px 2px 2px 12px;
      }
      input {
        width: 220px;
        min-width: 80px;
        height: 26px;
        border: 0;
        background: transparent;
        color: #111827;
        font: 500 12px ui-monospace, "SF Mono", Menlo, monospace;
        outline: none;
        padding: 0;
      }
      .open {
        height: 26px;
        border: 0;
        border-radius: 999px;
        background: #1f2937;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        padding: 0 14px;
        flex: none;
      }
      .open:hover { background: #111827; }
      .select, .close, .min {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #4b5563;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        flex: none;
      }
      .select:hover, .close:hover, .min:hover { background: rgba(15, 23, 42, 0.06); color: #111827; }
      .select-icon {
        position: relative;
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 1.6px solid currentColor;
        border-radius: 999px;
      }
      .select-icon::before,
      .select-icon::after {
        content: "";
        position: absolute;
        inset: 50% auto auto 50%;
        background: currentColor;
        transform: translate(-50%, -50%);
      }
      .select-icon::before { width: 20px; height: 1.6px; }
      .select-icon::after { width: 1.6px; height: 20px; }
      .attach {
        flex: none;
        height: 28px;
        border: 1px solid rgba(37, 99, 235, 0.4);
        border-radius: 999px;
        background: rgba(37, 99, 235, 0.08);
        color: #1d4ed8;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        padding: 0 12px;
        white-space: nowrap;
      }
      .attach:hover { background: rgba(37, 99, 235, 0.14); }
      .min {
        width: 30px;
        border-left: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 0 999px 999px 0;
      }
      .restore { display: none; }
      .chrome.is-collapsed { display: block; }
      .chrome.is-collapsed .island { display: none; }
      .chrome.is-collapsed .restore {
        pointer-events: auto;
        display: flex;
        align-items: stretch;
        width: 100%;
        height: 100%;
        border: 0;
        border-top: 1px solid rgba(15, 23, 42, 0.1);
        background: rgba(248, 250, 252, 0.92);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        cursor: pointer;
        padding: 0;
        text-align: left;
        font: 11px ui-monospace, "SF Mono", Menlo, monospace;
        color: #64748b;
      }
      .seg {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 14px;
        position: relative;
        white-space: nowrap;
      }
      .seg::after {
        content: "";
        position: absolute;
        right: -8px;
        top: 0;
        z-index: 1;
        border-left: 8px solid transparent;
        border-top: 15px solid transparent;
        border-bottom: 15px solid transparent;
      }
      .seg-status { background: #2563eb; color: #fff; font-weight: 700; }
      .seg-status::after { border-left-color: #2563eb; }
      .seg-host {
        background: #e2e8f0;
        color: #1f2937;
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .seg-host::after { border-left-color: #e2e8f0; }
      .rest {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 14px;
        padding: 0 14px 0 22px;
        min-width: 0;
      }
      .rest .ws { color: #94a3b8; overflow: hidden; text-overflow: ellipsis; }
      .rest .up { color: #2563eb; font-weight: 700; }
      .restore:hover .up { text-decoration: underline; }
    </style>
    <div class="chrome${collapsed ? " is-collapsed" : ""}">
      <div class="island">
        <span class="dot" aria-hidden="true"></span>
        <div class="tablist">${tabMarkup}</div>
        <button class="plus" type="button" data-action="new" aria-label="${escapeHtml(labels.newTab)}">+</button>
        <span class="status">${escapeHtml(labels.statusReady)}</span>
        <form data-open-form>
          <input data-url-input value="${escapeHtml(displayUrl)}" spellcheck="false" autocomplete="off" />
          <button class="open" type="submit">${escapeHtml(labels.open)}</button>
        </form>
        <button class="select" type="button" data-action="select" title="${escapeHtml(labels.select)}" aria-label="${escapeHtml(labels.select)}"><span class="select-icon" aria-hidden="true"></span></button>
        <button class="attach" type="button" data-action="attach">${escapeHtml(labels.attach)}</button>
        <button class="close" type="button" data-action="close" aria-label="${escapeHtml(labels.close)}">×</button>
        <button class="min" type="button" data-action="collapse" title="${escapeHtml(labels.collapse)}" aria-label="${escapeHtml(labels.collapse)}">—</button>
      </div>
      <button class="restore" type="button" data-action="expand" aria-label="${escapeHtml(labels.expand)}" title="${escapeHtml(labels.expand)}">
        <span class="seg seg-status"><span class="dot" style="margin:0" aria-hidden="true"></span>${escapeHtml(labels.statusReady)}</span>
        <span class="seg seg-host">${escapeHtml(tabLabel)}</span>
        <span class="rest"><span class="ws">${escapeHtml(workspaceId || "")}</span><span class="up">${escapeHtml(labels.expand)} ▴</span></span>
      </button>
    </div>
  `;
  const form = shadow.querySelector("[data-open-form]");
  const input = shadow.querySelector("[data-url-input]");
  const newButton = shadow.querySelector('[data-action="new"]');
  const attachButton = shadow.querySelector('[data-action="attach"]');
  const selectButton = shadow.querySelector('[data-action="select"]');
  const closeButton = shadow.querySelector('[data-action="close"]');
  shadow.querySelectorAll("[data-tab-id]").forEach((tabButton) => {
    tabButton.addEventListener("click", () => {
      const targetSessionId = tabButton.getAttribute("data-tab-id") || "";
      if (targetSessionId) {
        sendBridgeAction("activate", { targetSessionId });
      }
    });
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const normalized = normalizeDraftUrl(input?.value);
    if (normalized) {
      sendBridgeAction("open", {
        url: normalized,
        newTab: nextOpenCreatesTab ? "1" : "0",
      });
      nextOpenCreatesTab = false;
    }
  });
  newButton?.addEventListener("click", () => {
    nextOpenCreatesTab = true;
    if (input) {
      input.value = "";
      input.focus();
    }
  });
  attachButton?.addEventListener("click", () => sendBridgeAction("attach"));
  selectButton?.addEventListener("click", () => sendBridgeAction("select"));
  closeButton?.addEventListener("click", () => sendBridgeAction("close"));
  const chrome = shadow.querySelector(".chrome");
  const setCollapsed = (next) => {
    collapsed = Boolean(next);
    chrome?.classList.toggle("is-collapsed", collapsed);
    applyChromeHeight();
    try {
      window.localStorage.setItem("ccgui.browserAgent.toolbarCollapsed", collapsed ? "1" : "0");
    } catch (storageWriteError) {}
  };
  shadow.querySelector('[data-action="collapse"]')?.addEventListener("click", () => setCollapsed(true));
  shadow.querySelector('[data-action="expand"]')?.addEventListener("click", () => setCollapsed(false));
})();"#,
    );
    script
}

pub(crate) fn browser_element_selector_script(
    browser_session_id: &str,
    workspace_id: &str,
    locale: Option<&str>,
) -> String {
    let labels = browser_toolbar_labels(locale);
    let kind_heading = if labels.locale == "en" {
        "Heading"
    } else {
        "标题"
    };
    let kind_button = if labels.locale == "en" {
        "Button"
    } else {
        "按钮"
    };
    let kind_link = if labels.locale == "en" {
        "Link"
    } else {
        "链接"
    };
    let kind_list = if labels.locale == "en" {
        "List"
    } else {
        "列表"
    };
    let kind_paragraph = if labels.locale == "en" {
        "Paragraph"
    } else {
        "段落"
    };
    let kind_image = if labels.locale == "en" {
        "Image"
    } else {
        "图片"
    };
    let kind_code = if labels.locale == "en" {
        "Code"
    } else {
        "代码"
    };
    let kind_excerpt = if labels.locale == "en" {
        "Excerpt"
    } else {
        "摘录"
    };
    let mut script = String::from(
        r#"(function () {
  const sessionId = "#,
    );
    script.push_str(&escape_js_string(browser_session_id));
    script.push_str(
        r#";
  const workspaceId = "#,
    );
    script.push_str(&escape_js_string(workspace_id));
    script.push_str(
        r#";
  const kindLabels = {
    heading: "#,
    );
    script.push_str(&escape_js_string(kind_heading));
    script.push_str(
        r#",
    button: "#,
    );
    script.push_str(&escape_js_string(kind_button));
    script.push_str(
        r#",
    link: "#,
    );
    script.push_str(&escape_js_string(kind_link));
    script.push_str(
        r#",
    list: "#,
    );
    script.push_str(&escape_js_string(kind_list));
    script.push_str(
        r#",
    paragraph: "#,
    );
    script.push_str(&escape_js_string(kind_paragraph));
    script.push_str(
        r#",
    image: "#,
    );
    script.push_str(&escape_js_string(kind_image));
    script.push_str(
        r#",
    code: "#,
    );
    script.push_str(&escape_js_string(kind_code));
    script.push_str(
        r#",
    excerpt: "#,
    );
    script.push_str(&escape_js_string(kind_excerpt));
    script.push_str(
        r##"
  };
  const bridgeBase = "https://browser-agent-toolbar.invalid/__ccgui_toolbar__";
  const cleanupKey = "__ccguiBrowserElementSelectorCleanup";
  const selectorRootAttribute = "data-ccgui-browser-selector-root";
  if (typeof window[cleanupKey] === "function") {
    window[cleanupKey]();
  }

  const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const elementText = (element) => normalizeText(element.innerText || element.textContent || "").slice(0, 1200);
  const directText = (element) => Array.from(element.childNodes || [])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => normalizeText(node.textContent))
    .filter(Boolean)
    .join(" ")
    .slice(0, 640);
  const escapeSelectorPart = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  };
  const selectorHint = (element) => {
    const tag = String(element.tagName || "element").toLowerCase();
    const id = element.id ? `#${escapeSelectorPart(element.id)}` : "";
    const testId = element.getAttribute("data-testid") || element.getAttribute("data-test-id");
    if (testId) return `${tag}[data-testid="${String(testId).slice(0, 80).replaceAll('"', '\\"')}"]`;
    const className = String(element.className || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    const parent = element.parentElement;
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
      const ordinal = sameTagSiblings.indexOf(element) + 1;
      if (sameTagSiblings.length > 1 && ordinal > 0) {
        return `${tag}${id}:nth-of-type(${ordinal})`.slice(0, 160);
      }
    }
    return `${tag}${id}${className ? `.${className}` : ""}`.slice(0, 160);
  };
  const isSensitive = (element) => {
    const identity = [
      element.getAttribute("type"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
    ].join(" ").toLowerCase();
    return /password|token|secret|authorization|cookie|api[_-]?key/.test(identity);
  };
  const semanticTagScore = (tag) => {
    if (tag === "a" || tag === "button" || tag === "input" || tag === "select" || tag === "textarea" || tag === "summary") return 100;
    if (/^h[1-6]$/.test(tag)) return 82;
    if (tag === "p" || tag === "li" || tag === "td" || tag === "th" || tag === "blockquote" || tag === "figcaption") return 72;
    if (tag === "img" || tag === "svg" || tag === "video" || tag === "canvas") return 68;
    if (tag === "label" || tag === "code" || tag === "pre" || tag === "dt" || tag === "dd") return 58;
    if (tag === "span" || tag === "strong" || tag === "em" || tag === "small") return 30;
    return 0;
  };
  const inferredRole = (element) => {
    const explicitRole = normalizeText(element.getAttribute("role"));
    if (explicitRole) return explicitRole;
    const tag = String(element.tagName || "").toLowerCase();
    const inputType = String(element.getAttribute("type") || "text").toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "input" && ["checkbox", "radio"].includes(inputType)) return inputType;
    if (tag === "input" || tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img" || tag === "svg") return "img";
    if (tag === "p") return "paragraph";
    if (tag === "li") return "listitem";
    if (tag === "td" || tag === "th") return "cell";
    return null;
  };
  const isInteractive = (element) => {
    const tag = String(element.tagName || "").toLowerCase();
    const role = normalizeText(element.getAttribute("role")).toLowerCase();
    return tag === "a" || tag === "button" || tag === "summary" || tag === "input" || tag === "select" || tag === "textarea" || role === "button" || role === "link";
  };
  const isContentUnit = (element) => {
    const tag = String(element.tagName || "").toLowerCase();
    const role = normalizeText(element.getAttribute("role")).toLowerCase();
    if (isInteractive(element)) return true;
    if (/^h[1-6]$/.test(tag) || tag === "p" || tag === "li" || tag === "td" || tag === "th" || tag === "blockquote" || tag === "figcaption" || tag === "pre" || tag === "dt" || tag === "dd" || tag === "img" || tag === "figure" || tag === "label") return true;
    return role === "heading" || role === "paragraph" || role === "listitem" || role === "article" || role === "img" || role === "cell";
  };
  const promoteToContentUnit = (element) => {
    if (isInteractive(element)) return element;
    let current = element;
    for (let depth = 0; depth < 8 && current; depth += 1) {
      const rect = visibleRect(current);
      if (rect && isContentUnit(current)) {
        const areaRatio = (rect.width * rect.height) / Math.max(1, (window.innerWidth || 1) * (window.innerHeight || 1));
        if (areaRatio <= 0.28) return current;
      }
      current = current.parentElement;
    }
    return element;
  };
  const candidateKind = (candidate) => {
    const role = String(candidate.role || "").toLowerCase();
    const tag = String(candidate.tag || "").toLowerCase();
    if (role === "heading" || /^h[1-6]$/.test(tag)) return "heading";
    if (role === "button" || tag === "button" || tag === "summary") return "button";
    if (role === "link" || tag === "a") return "link";
    if (role === "listitem" || tag === "li") return "list";
    if (role === "paragraph" || tag === "p") return "paragraph";
    if (role === "img" || tag === "img" || tag === "figure") return "image";
    if (tag === "pre" || tag === "code") return "code";
    return "excerpt";
  };
  const isSelectorChrome = (element) => Boolean(
    element.closest(`[${selectorRootAttribute}]`) ||
    element.closest("#ccgui-browser-agent-toolbar")
  );
  const eventTouchesToolbarChrome = (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.some((entry) =>
      entry instanceof Element && Boolean(entry.closest("#ccgui-browser-agent-toolbar"))
    );
  };
  const visibleRect = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
    return rect;
  };
  const elementLabel = (element, text, sensitive) => normalizeText(
    element.getAttribute("aria-label") ||
    element.getAttribute("alt") ||
    element.getAttribute("title") ||
    element.getAttribute("placeholder") ||
    (sensitive ? "" : text),
  ).slice(0, 640);
  const hrefFor = (element) => {
    const rawHref = element.getAttribute("href");
    if (!rawHref) return null;
    try {
      return new URL(rawHref, window.location.href).href;
    } catch {
      return rawHref;
    }
  };
  const candidateScore = (element, index, rect) => {
    const tag = String(element.tagName || "").toLowerCase();
    const role = inferredRole(element);
    const text = elementText(element);
    const ownText = directText(element);
    const label = elementLabel(element, text, isSensitive(element));
    const viewportArea = Math.max(1, (window.innerWidth || 1) * (window.innerHeight || 1));
    const area = rect.width * rect.height;
    const areaRatio = area / viewportArea;
    let score = semanticTagScore(tag) + Math.max(0, 18 - index * 2);
    if (role) score += 18;
    if (label) score += 18;
    if (ownText) score += 16;
    if (text) score += Math.min(16, Math.ceil(text.length / 40));
    if (hrefFor(element)) score += 18;
    if ((tag === "li" || role === "listitem") && text) score += 16;
    if ((tag === "p" || role === "paragraph") && text) score += 12;
    if (isInteractive(element)) score += 10;
    if (!isInteractive(element) && text.length < 4 && tag !== "img" && tag !== "svg") score -= 24;
    if (tag === "ul" || tag === "ol") score -= 80;
    if (tag === "html" || tag === "body") score -= 260;
    if (tag === "main" || tag === "section" || tag === "article" || tag === "header" || tag === "footer" || tag === "nav" || tag === "aside") score -= 96;
    if (tag === "div" && !role && !label && !ownText) score -= 68;
    if (tag === "div" && areaRatio > 0.08) score -= 38;
    if (areaRatio > 0.36) score -= 120;
    else if (areaRatio > 0.18) score -= 64;
    else if (areaRatio > 0.08) score -= 28;
    if (rect.width > (window.innerWidth || 1) * 0.9) score -= 38;
    return { element, rect, score, area, role, tag, text, label };
  };
  const chooseCandidate = (clientX, clientY) => {
    const stack = (document.elementsFromPoint?.(clientX, clientY) || [])
      .filter((element) => element instanceof Element)
      .filter((element) => !isSelectorChrome(element))
      .map((element) => promoteToContentUnit(element));
    const uniqueStack = [];
    const seenElements = new Set();
    stack.forEach((element) => {
      if (seenElements.has(element)) return;
      seenElements.add(element);
      uniqueStack.push(element);
    });
    const candidates = uniqueStack
      .map((element, index) => {
        const rect = visibleRect(element);
        return rect ? candidateScore(element, index, rect) : null;
      })
      .filter(Boolean)
      .filter((candidate) => candidate.score >= 28)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.area - right.area;
      });
    return candidates[0] || null;
  };

  const host = document.createElement("div");
  host.setAttribute(selectorRootAttribute, "true");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:block;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
        display: block;
      }
      * { box-sizing: border-box; }
      .selector-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .selector-dim {
        position: absolute;
        inset: 0;
        background: transparent;
      }
      .selector-outline {
        position: absolute;
        border: 2px solid #2563eb;
        border-radius: 8px;
        background: rgba(37, 99, 235, 0.16);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.88), 0 0 0 3px rgba(37, 99, 235, 0.28);
        pointer-events: none;
      }
      .selector-card {
        position: absolute;
        width: min(340px, calc(100vw - 24px));
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.96);
        color: #1f2328;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
        padding: 10px 12px;
        overflow: hidden;
      }
      .selector-kicker {
        color: #2563eb;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      .selector-label {
        display: -webkit-box;
        margin-top: 3px;
        overflow: hidden;
        color: #1f2328;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.35;
        white-space: normal;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .selector-meta,
      .selector-page {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
      .selector-meta {
        margin-top: 8px;
        color: #4b5563;
        font-size: 11px;
        font-weight: 600;
      }
      .selector-page {
        margin-top: 4px;
        color: #9aa1ad;
        font-size: 11px;
        font-weight: 600;
      }
      @media (prefers-color-scheme: dark) {
        .selector-card {
          border-color: rgba(255, 255, 255, 0.1);
          background: rgba(28, 31, 36, 0.96);
          color: #f3f4f6;
        }
        .selector-kicker { color: #93c5fd; }
        .selector-label { color: #f3f4f6; }
        .selector-meta { color: #c2c7d0; }
        .selector-page { color: #8b919a; }
      }
      .is-hidden { display: none; }
    </style>
    <div class="selector-layer">
      <div class="selector-dim"></div>
      <div class="selector-outline is-hidden"></div>
      <div class="selector-card is-hidden">
        <div class="selector-kicker"></div>
        <div class="selector-label"></div>
        <div class="selector-meta"></div>
        <div class="selector-page"></div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(host);
  const outline = shadow.querySelector(".selector-outline");
  const card = shadow.querySelector(".selector-card");
  const cardKicker = shadow.querySelector(".selector-kicker");
  const cardLabel = shadow.querySelector(".selector-label");
  const cardMeta = shadow.querySelector(".selector-meta");
  const cardPage = shadow.querySelector(".selector-page");
  let activeCandidate = null;
  let paintedElement = null;
  const clearPaintedElement = () => {
    if (!paintedElement) return;
    paintedElement.style.outline = paintedElement.getAttribute("data-ccgui-prev-outline") || "";
    paintedElement.style.outlineOffset = paintedElement.getAttribute("data-ccgui-prev-outline-offset") || "";
    paintedElement.removeAttribute("data-ccgui-prev-outline");
    paintedElement.removeAttribute("data-ccgui-prev-outline-offset");
    paintedElement = null;
  };
  const paintElement = (element) => {
    if (paintedElement === element) return;
    clearPaintedElement();
    if (!element || !element.style) return;
    paintedElement = element;
    paintedElement.setAttribute("data-ccgui-prev-outline", paintedElement.style.outline || "");
    paintedElement.setAttribute("data-ccgui-prev-outline-offset", paintedElement.style.outlineOffset || "");
    paintedElement.style.outline = "2px solid #2563eb";
    paintedElement.style.outlineOffset = "2px";
  };

  const describeCandidate = (candidate) => {
    const kind = candidateKind(candidate);
    const role = candidate.role || candidate.tag;
    const label = candidate.label || candidate.text || hrefFor(candidate.element) || kindLabels[kind] || candidate.tag;
    const size = `${Math.round(candidate.rect.width)}x${Math.round(candidate.rect.height)}`;
    const origin = `${Math.round(candidate.rect.left)},${Math.round(candidate.rect.top)}`;
    const documentOrigin = `${Math.round((window.scrollX || 0) + candidate.rect.left)},${Math.round((window.scrollY || 0) + candidate.rect.top)}`;
    return {
      kicker: kindLabels[kind] || kindLabels.excerpt,
      label: label.slice(0, 140),
      meta: `${candidate.tag} · role=${role} · ${size} · xy=${origin} · doc=${documentOrigin}`,
      page: normalizeText(document.title || window.location.hostname || window.location.href).slice(0, 140),
    };
  };
  const positionCard = (rect) => {
    const margin = 12;
    const cardWidth = Math.min(360, Math.max(260, window.innerWidth - margin * 2));
    card.style.width = `${cardWidth}px`;
    card.style.left = `${clamp(rect.left, margin, Math.max(margin, window.innerWidth - cardWidth - margin))}px`;
    card.style.top = `${Math.min(rect.bottom + margin, window.innerHeight - 96)}px`;
    requestAnimationFrame(() => {
      const cardRect = card.getBoundingClientRect();
      const nextLeft = clamp(cardRect.left, margin, Math.max(margin, window.innerWidth - cardRect.width - margin));
      const nextTop = cardRect.bottom > window.innerHeight - margin
        ? Math.max(margin, rect.top - cardRect.height - margin)
        : cardRect.top;
      card.style.left = `${nextLeft}px`;
      card.style.top = `${nextTop}px`;
    });
  };
  const hideOverlay = () => {
    activeCandidate = null;
    clearPaintedElement();
    outline.classList.add("is-hidden");
    card.classList.add("is-hidden");
  };
  const showOverlay = (candidate) => {
    activeCandidate = candidate;
    paintElement(candidate.element);
    const rect = candidate.rect;
    outline.classList.remove("is-hidden");
    card.classList.remove("is-hidden");
    outline.style.left = `${Math.max(0, rect.left)}px`;
    outline.style.top = `${Math.max(0, rect.top)}px`;
    outline.style.width = `${rect.width}px`;
    outline.style.height = `${rect.height}px`;
    const description = describeCandidate(candidate);
    cardKicker.textContent = description.kicker;
    cardLabel.textContent = description.label;
    cardMeta.textContent = description.meta;
    cardPage.textContent = description.page;
    positionCard(rect);
  };
  const updateOverlay = (event) => {
    const candidate = chooseCandidate(event.clientX, event.clientY);
    if (!candidate) {
      hideOverlay();
      return;
    }
    showOverlay(candidate);
  };
  const cleanup = () => {
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    clearPaintedElement();
    host.remove();
    window[cleanupKey] = undefined;
  };
  const siblingText = (element, direction) => {
    const item = element.closest("li,[role='listitem']") || element;
    const sibling = direction === "previous" ? item.previousElementSibling : item.nextElementSibling;
    if (!sibling || isSelectorChrome(sibling)) return null;
    const text = normalizeText(sibling.innerText || sibling.textContent || "");
    return text ? text.slice(0, 160) : null;
  };
  const listContext = (element) => {
    const item = element.closest("li,[role='listitem']") || (String(element.tagName || "").toLowerCase() === "li" ? element : null);
    const parent = item?.parentElement;
    if (!item || !parent) return { index: null, length: null };
    const items = Array.from(parent.children).filter((child) => {
      const tag = String(child.tagName || "").toLowerCase();
      const role = normalizeText(child.getAttribute("role")).toLowerCase();
      return tag === "li" || role === "listitem";
    });
    const index = items.indexOf(item) + 1;
    return {
      index: index > 0 ? index : null,
      length: items.length > 0 ? items.length : null,
    };
  };
  const closestHeadingText = (element) => {
    let current = element;
    while (current) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (/^H[1-6]$/.test(sibling.tagName)) {
          const text = normalizeText(sibling.innerText || sibling.textContent || "");
          if (text) return text.slice(0, 120);
        }
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
    }
    return null;
  };
  const ancestorLabel = (element) => {
    let current = element.parentElement;
    for (let depth = 0; depth < 6 && current; depth += 1) {
      const tag = String(current.tagName || "").toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = normalizeText(current.innerText || current.textContent || "");
        if (text) return text.slice(0, 120);
      }
      const labelled = normalizeText(current.getAttribute("aria-label") || current.getAttribute("data-label") || "");
      if (labelled) return labelled.slice(0, 120);
      if (tag === "summary") {
        const text = normalizeText(current.innerText || current.textContent || "");
        if (text) return text.slice(0, 120);
      }
      current = current.parentElement;
    }
    return closestHeadingText(element);
  };
  const cssPath = (element) => {
    const parts = [];
    let current = element;
    for (let depth = 0; depth < 6 && current && current !== document.documentElement; depth += 1) {
      const tag = String(current.tagName || "element").toLowerCase();
      if (current.id) {
        parts.unshift(`${tag}#${escapeSelectorPart(current.id)}`);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        const ordinal = sameTag.indexOf(current) + 1;
        parts.unshift(sameTag.length > 1 && ordinal > 0 ? `${tag}:nth-of-type(${ordinal})` : tag);
      } else {
        parts.unshift(tag);
      }
      current = parent;
    }
    return parts.join(" > ").slice(0, 240);
  };
  const collectLocate = (element, rect) => {
    const scrollX = window.scrollX || 0;
    const scrollY = window.scrollY || 0;
    const list = listContext(element);
    return {
      documentX: scrollX + rect.x,
      documentY: scrollY + rect.y,
      viewportX: rect.x,
      viewportY: rect.y,
      width: rect.width,
      height: rect.height,
      scrollX,
      scrollY,
      listIndex: list.index,
      listLength: list.length,
      previousText: siblingText(element, "previous"),
      nextText: siblingText(element, "next"),
      ancestorLabel: ancestorLabel(element),
      cssPath: cssPath(element),
    };
  };
  const sendSelection = (candidate) => {
    const element = candidate.element;
    const rect = element.getBoundingClientRect();
    const sensitive = isSensitive(element);
    const text = sensitive ? "" : elementText(element);
    const label = elementLabel(element, text, sensitive);
    const locate = collectLocate(element, rect);
    const payload = {
      tagName: String(element.tagName || "element").toLowerCase(),
      role: inferredRole(element),
      label: label || null,
      text: text || null,
      href: hrefFor(element),
      selectorHint: selectorHint(element),
      sensitive,
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      viewport: {
        width: window.innerWidth || null,
        height: window.innerHeight || null,
        scrollX: window.scrollX || 0,
        scrollY: window.scrollY || 0,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      locate,
      selectedAt: Date.now(),
    };
    const params = new URLSearchParams({
      action: "selectedElement",
      sessionId,
      workspaceId,
      payload: JSON.stringify(payload),
    });
    window.location.href = `${bridgeBase}?${params.toString()}`;
  };
  function onPointerMove(event) {
    updateOverlay(event);
  }
  function onClick(event) {
    if (eventTouchesToolbarChrome(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const candidate = activeCandidate || chooseCandidate(event.clientX, event.clientY);
    if (candidate) {
      sendSelection(candidate);
      showOverlay(candidate);
    }
  }
  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      cleanup();
      const params = new URLSearchParams({
        action: "cancelSelect",
        sessionId,
        workspaceId,
      });
      window.location.href = `${bridgeBase}?${params.toString()}`;
    }
  }
  window[cleanupKey] = cleanup;
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
})();"##,
    );
    script
}

pub(crate) fn browser_element_selector_stop_script() -> String {
    String::from(
        r#"(function () {
  const cleanup = window.__ccguiBrowserElementSelectorCleanup;
  if (typeof cleanup === "function") cleanup();
})();"#,
    )
}

async fn inject_browser_agent_toolbar_from_state(
    app: AppHandle,
    window: tauri::WebviewWindow<tauri::Wry>,
    active_browser_session_id: String,
    current_url: Option<String>,
    title: Option<String>,
    locale: Option<String>,
) {
    let (workspace_id, active_url, active_title, tabs_json) = {
        let state = app.state::<AppState>();
        let sessions = state.browser_sessions.lock().await;
        let Some(active_session) = sessions.get(active_browser_session_id.as_str()) else {
            return;
        };
        let workspace_id = active_session.workspace_id.clone();
        let active_url = current_url.unwrap_or_else(|| active_session.normalized_url.clone());
        let active_title = title.or_else(|| active_session.title.clone());
        let mut tabs = sessions
            .values()
            .filter(|session| {
                session.workspace_id == workspace_id
                    && session.status != BrowserSessionStatus::Closed
            })
            .cloned()
            .collect::<Vec<_>>();
        tabs.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        let tabs_json = serde_json::to_string(
            &tabs
                .iter()
                .map(|session| {
                    serde_json::json!({
                        "browserSessionId": session.browser_session_id,
                        "title": session.title.as_deref().unwrap_or(""),
                        "url": session.normalized_url,
                        "status": session.status,
                    })
                })
                .collect::<Vec<_>>(),
        )
        .unwrap_or_else(|_| "[]".to_string());
        (workspace_id, active_url, active_title, tabs_json)
    };

    let script = browser_agent_toolbar_script(
        active_browser_session_id.as_str(),
        workspace_id.as_str(),
        active_url.as_str(),
        active_title.as_deref(),
        tabs_json.as_str(),
        locale.as_deref(),
    );
    let _ = window.eval(script);
}

pub(super) fn spawn_browser_toolbar_injection(
    app: AppHandle,
    window: tauri::WebviewWindow<tauri::Wry>,
    active_browser_session_id: String,
    current_url: Option<String>,
    title: Option<String>,
    locale: Option<String>,
) {
    tauri::async_runtime::spawn(async move {
        inject_browser_agent_toolbar_from_state(
            app,
            window,
            active_browser_session_id,
            current_url,
            title,
            locale,
        )
        .await;
    });
}

async fn open_browser_toolbar_url(
    app: AppHandle,
    current_browser_session_id: String,
    workspace_id: String,
    raw_url: String,
    new_tab: bool,
    locale: Option<String>,
) {
    let validation =
        validate_browser_url_for_workspace(raw_url.as_str(), Some(workspace_id.as_str()));
    let normalized_url = match validation.normalized_url.clone() {
        Some(normalized_url) => normalized_url,
        None => {
            spawn_browser_webview_session_patch(
                app,
                current_browser_session_id,
                Some(BrowserSessionStatus::Blocked),
                Some(raw_url),
                None,
                validation.blocked_reason,
                validation.diagnostic.map(|diagnostic| diagnostic.message),
            );
            return;
        }
    };

    let now = unix_time_ms();
    let active_session = {
        let state = app.state::<AppState>();
        let mut sessions = state.browser_sessions.lock().await;
        if new_tab {
            let browser_session_id = format!("browser-session-{}", uuid::Uuid::new_v4());
            let session = BrowserSession {
                browser_session_id: browser_session_id.clone(),
                workspace_id: workspace_id.clone(),
                label: "Browser Agent · browser-agent-window".to_string(),
                url: normalized_url.clone(),
                normalized_url: normalized_url.clone(),
                origin: origin_from_normalized_url(normalized_url.as_str()),
                title: None,
                favicon_ref: None,
                status: BrowserSessionStatus::Loading,
                feature_phase: BrowserAgentFeaturePhase::ReadOnlySnapshot,
                platform_capability: platform::current_platform_capability(),
                linked_thread_id: None,
                linked_task_run_id: None,
                linked_orchestration_task_id: None,
                last_snapshot_id: None,
                last_action_id: None,
                error_code: None,
                diagnostic_message: None,
                created_at: now,
                updated_at: now,
                last_activated_at: now,
                closed_at: None,
            };
            sessions.insert(browser_session_id, session.clone());
            session
        } else {
            let session = if sessions.contains_key(current_browser_session_id.as_str()) {
                sessions.get_mut(current_browser_session_id.as_str())
            } else {
                sessions.values_mut().find(|session| {
                    session.workspace_id == workspace_id
                        && session.status != BrowserSessionStatus::Closed
                })
            };
            let Some(session) = session else {
                return;
            };
            session.url = normalized_url.clone();
            session.normalized_url = normalized_url.clone();
            session.origin = origin_from_normalized_url(normalized_url.as_str());
            session.status = BrowserSessionStatus::Loading;
            session.error_code = None;
            session.diagnostic_message = None;
            session.updated_at = now;
            session.last_activated_at = now;
            session.clone()
        }
    };

    bind_browser_renderer_session(active_session.browser_session_id.as_str());
    if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
        spawn_browser_toolbar_injection(
            app.clone(),
            window.clone(),
            active_session.browser_session_id.clone(),
            Some(active_session.normalized_url.clone()),
            active_session.title.clone(),
            locale,
        );
        if let Ok(parsed_url) = active_session.normalized_url.parse::<tauri::Url>() {
            let _ = window.navigate(parsed_url);
        }
    }
}

async fn activate_browser_toolbar_session(
    app: AppHandle,
    target_browser_session_id: String,
    expected_workspace_id: Option<String>,
    locale: Option<String>,
) {
    let session = {
        let state = app.state::<AppState>();
        let sessions = state.browser_sessions.lock().await;
        sessions.get(target_browser_session_id.as_str()).cloned()
    };
    let Some(session) = session else {
        return;
    };
    if session.status == BrowserSessionStatus::Closed {
        return;
    }
    if let Some(expected_workspace_id) = expected_workspace_id.as_deref() {
        if session.workspace_id != expected_workspace_id {
            return;
        }
    }
    bind_browser_renderer_session(session.browser_session_id.as_str());
    if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
        spawn_browser_toolbar_injection(
            app.clone(),
            window.clone(),
            session.browser_session_id.clone(),
            Some(session.normalized_url.clone()),
            session.title.clone(),
            locale,
        );
        let _ = window.show();
        let _ = window.set_focus();
        if let Ok(parsed_url) = session.normalized_url.parse::<tauri::Url>() {
            let _ = window.navigate(parsed_url);
        }
    }
}

async fn close_browser_toolbar_session(
    app: AppHandle,
    browser_session_id: String,
    expected_workspace_id: Option<String>,
    locale: Option<String>,
) {
    let next_session = {
        let state = app.state::<AppState>();
        let mut sessions = state.browser_sessions.lock().await;
        let Some(session_workspace_id) = sessions
            .get(browser_session_id.as_str())
            .map(|session| session.workspace_id.clone())
        else {
            return;
        };
        if let Some(expected_workspace_id) = expected_workspace_id.as_deref() {
            if session_workspace_id != expected_workspace_id {
                return;
            }
        }
        let now = unix_time_ms();
        if let Some(session) = sessions.get_mut(browser_session_id.as_str()) {
            session.status = BrowserSessionStatus::Closed;
            session.updated_at = now;
            session.closed_at = Some(now);
        }
        {
            let workspace_id = session_workspace_id;
            let mut candidates = sessions
                .values()
                .filter(|session| {
                    session.workspace_id == workspace_id
                        && session.status != BrowserSessionStatus::Closed
                })
                .cloned()
                .collect::<Vec<_>>();
            candidates.sort_by(|left, right| right.last_activated_at.cmp(&left.last_activated_at));
            candidates.into_iter().next()
        }
    };

    clear_browser_renderer_session(browser_session_id.as_str());
    match next_session {
        Some(session) => {
            activate_browser_toolbar_session(
                app,
                session.browser_session_id,
                Some(session.workspace_id),
                locale,
            )
            .await;
        }
        None => {
            if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
                let _ = window.close();
            }
        }
    }
}

fn selected_element_attachment_request(
    workspace_id: &str,
    browser_session_id: &str,
    payload: &str,
) -> Option<serde_json::Value> {
    let selected_element = serde_json::from_str::<serde_json::Value>(payload).ok()?;
    Some(serde_json::json!({
        "workspaceId": workspace_id,
        "browserSessionId": browser_session_id,
        "selectedElement": selected_element,
    }))
}

pub(super) fn handle_browser_toolbar_navigation(
    app: &AppHandle,
    raw_url: &str,
    browser_session_id: &str,
    workspace_id: &str,
) -> bool {
    let Ok(url) = raw_url.parse::<tauri::Url>() else {
        return false;
    };
    if url.host_str() != Some(BROWSER_TOOLBAR_BRIDGE_HOST)
        || url.path() != BROWSER_TOOLBAR_BRIDGE_PATH
    {
        return false;
    }
    let action = url
        .query_pairs()
        .find_map(|(key, value)| (key == "action").then(|| value.into_owned()))
        .unwrap_or_default();
    let query_pairs = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<HashMap<_, _>>();
    let toolbar_browser_session_id =
        normalize_toolbar_query_value(query_pairs.get("sessionId"), browser_session_id);
    let toolbar_workspace_id =
        normalize_toolbar_query_value(query_pairs.get("workspaceId"), workspace_id);
    let toolbar_locale = query_pairs
        .get("locale")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    match action.as_str() {
        "activate" => {
            let target_browser_session_id = query_pairs
                .get("targetSessionId")
                .map(|value| {
                    normalize_toolbar_query_value(Some(value), toolbar_browser_session_id.as_str())
                })
                .unwrap_or_else(|| toolbar_browser_session_id.clone());
            let app_for_action = app.clone();
            let locale = toolbar_locale.clone();
            tauri::async_runtime::spawn(async move {
                activate_browser_toolbar_session(
                    app_for_action,
                    target_browser_session_id,
                    Some(toolbar_workspace_id),
                    locale,
                )
                .await;
            });
        }
        "open" => {
            if let Some(url) = query_pairs.get("url").cloned() {
                let app_for_action = app.clone();
                let current_browser_session_id = toolbar_browser_session_id.clone();
                let workspace_id = toolbar_workspace_id.clone();
                let locale = toolbar_locale.clone();
                let new_tab = parse_toolbar_boolean(query_pairs.get("newTab"));
                tauri::async_runtime::spawn(async move {
                    open_browser_toolbar_url(
                        app_for_action,
                        current_browser_session_id,
                        workspace_id,
                        url,
                        new_tab,
                        locale,
                    )
                    .await;
                });
            }
        }
        "attach" => {
            let _ = app.emit_to(
                "main",
                BROWSER_CONTEXT_ATTACHMENT_REQUEST_EVENT,
                serde_json::json!({
                    "workspaceId": toolbar_workspace_id.as_str(),
                    "browserSessionId": toolbar_browser_session_id.as_str(),
                }),
            );
        }
        "select" => {
            if let Some(window) = app.get_webview_window(BROWSER_RENDERER_WINDOW_LABEL) {
                let script = browser_element_selector_script(
                    toolbar_browser_session_id.as_str(),
                    toolbar_workspace_id.as_str(),
                    toolbar_locale.as_deref(),
                );
                let _ = window.eval(script);
            }
        }
        "selectedElement" => {
            if let Some(payload) = query_pairs.get("payload") {
                if let Some(request) = selected_element_attachment_request(
                    toolbar_workspace_id.as_str(),
                    toolbar_browser_session_id.as_str(),
                    payload,
                ) {
                    let _ = app.emit_to("main", BROWSER_CONTEXT_ATTACHMENT_REQUEST_EVENT, request);
                }
            }
        }
        "cancelSelect" => {
            let _ = app.emit_to(
                "main",
                BROWSER_ELEMENT_SELECT_ENDED_EVENT,
                serde_json::json!({
                    "browserSessionId": toolbar_browser_session_id.as_str(),
                }),
            );
        }
        "close" => {
            let app_for_action = app.clone();
            let browser_session_id = toolbar_browser_session_id.clone();
            let locale = toolbar_locale.clone();
            tauri::async_runtime::spawn(async move {
                close_browser_toolbar_session(
                    app_for_action,
                    browser_session_id,
                    Some(toolbar_workspace_id),
                    locale,
                )
                .await;
            });
        }
        _ => {}
    }
    true
}

fn normalize_toolbar_query_value(value: Option<&String>, fallback: &str) -> String {
    value
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn parse_toolbar_boolean(value: Option<&String>) -> bool {
    value
        .map(|value| {
            let normalized = value.trim();
            normalized == "1" || normalized.eq_ignore_ascii_case("true")
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{
        browser_element_selector_script, browser_element_selector_stop_script,
        normalize_toolbar_query_value, parse_toolbar_boolean, selected_element_attachment_request,
    };

    #[test]
    fn normalize_toolbar_query_value_trims_or_falls_back_for_empty_input() {
        assert_eq!(
            normalize_toolbar_query_value(Some(&" session-1 ".to_string()), "fallback"),
            "session-1",
        );
        assert_eq!(
            normalize_toolbar_query_value(Some(&"   ".to_string()), "fallback"),
            "fallback",
        );
        assert_eq!(normalize_toolbar_query_value(None, "fallback"), "fallback");
    }

    #[test]
    fn parse_toolbar_boolean_accepts_only_explicit_truthy_values() {
        assert!(parse_toolbar_boolean(Some(&"1".to_string())));
        assert!(parse_toolbar_boolean(Some(&" TRUE ".to_string())));
        assert!(!parse_toolbar_boolean(Some(&"0".to_string())));
        assert!(!parse_toolbar_boolean(Some(&"yes".to_string())));
        assert!(!parse_toolbar_boolean(None));
    }

    #[test]
    fn selected_element_attachment_request_preserves_structured_payload() {
        let request = selected_element_attachment_request(
            "workspace-1",
            "session-1",
            r#"{"tagName":"p","text":"Example text","bounds":{"x":1,"y":2,"width":3,"height":4},"viewport":{"width":800,"height":600,"scrollX":0,"scrollY":0,"devicePixelRatio":1},"selectedAt":100}"#,
        )
        .expect("valid selected element payload");

        assert_eq!(request["workspaceId"], "workspace-1");
        assert_eq!(request["browserSessionId"], "session-1");
        assert_eq!(request["selectedElement"]["tagName"], "p");
        assert_eq!(request["selectedElement"]["bounds"]["width"], 3);
    }

    #[test]
    fn selector_script_prefers_semantic_candidates_over_layout_containers() {
        let script = browser_element_selector_script("session-1", "workspace-1", None);

        assert!(script.contains("document.elementsFromPoint"));
        assert!(script.contains("semanticTagScore"));
        assert!(script.contains("promoteToContentUnit"));
        assert!(script.contains(r#"tag === "html" || tag === "body""#));
        assert!(script.contains(r#"tag === "main" || tag === "section""#));
        assert!(script.contains("selector-card"));
        assert!(script.contains("selector-kicker"));
        assert!(script.contains("position:fixed;inset:0;z-index:2147483646"));
        assert!(script.contains("background: rgba(37, 99, 235, 0.16)"));
        assert!(script.contains("paintedElement.style.outline = \"2px solid #2563eb\""));
        assert!(!script.contains(":host { all: initial; }"));
        assert!(script.contains("kindLabels"));
        assert!(script.contains("role: inferredRole(element)"));
        assert!(script.contains("eventTouchesToolbarChrome"));
        assert!(script.contains("if (eventTouchesToolbarChrome(event))"));
        assert!(script.contains("sendSelection(candidate);"));
        assert!(script.contains("showOverlay(candidate);"));
        assert!(script.contains(r#"action: "cancelSelect""#));
        assert!(script.contains("role=${role}"));
        assert!(script.contains("xy=${origin}"));
        assert!(script.contains("collectLocate"));
        assert!(script.contains("documentX"));
        assert!(script.contains("previousText"));
        assert!(script.contains("cssPath"));
        assert!(!script.contains("updateOverlay(event.target)"));
        assert!(!script.contains("cleanup();\n    if (candidate)"));
    }

    #[test]
    fn selector_script_uses_english_kind_labels_for_en_locale() {
        let script = browser_element_selector_script("session-1", "workspace-1", Some("en"));
        assert!(script.contains("heading: \"Heading\""));
        assert!(script.contains("paragraph: \"Paragraph\""));
        assert!(!script.contains("heading: \"标题\""));
    }

    #[test]
    fn selector_stop_script_only_invokes_existing_cleanup() {
        let script = browser_element_selector_stop_script();
        assert!(script.contains("__ccguiBrowserElementSelectorCleanup"));
        assert!(script.contains("if (typeof cleanup === \"function\") cleanup()"));
        assert!(!script.contains("sendSelection"));
    }
}
