// sites.js (consolidated, cleaned, and optimized)
const excludedDomains = ["analytics.google.com", "tagmanager.google.com", "tagassistant.google.com", "dev.azure.com"];

const featureKeys = [
  "updateTitle",
  "gtmWorkspaceCSS",
  "tagAssistantCSS",
  "showButtonsLinks",
  // If you decide to use it, re-add: "azureDevTags"
];

const LOG_COLOR = "color: #4C9AFF";
const currentDomain = window.location.hostname;

function onReady(fn) {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    queueMicrotask(fn);
  } else {
    window.addEventListener("DOMContentLoaded", fn, { once: true });
  }
}

function logSample(label, nodeList) {
  console.log(`%c${label}: count=${nodeList.length}`, LOG_COLOR);
  if (nodeList.length) {
    console.log(nodeList[0]);
    if (nodeList.length > 1) console.log(nodeList[1]);
  }
}

function showAllElements(customSelector) {
  if (excludedDomains.includes(currentDomain)) return;

  console.groupCollapsed(`%c[GA4/GTM Utility] Elements on: ${currentDomain}`, LOG_COLOR);

  logSample("Buttons", document.querySelectorAll("button"));
  logSample("Links", document.querySelectorAll("a"));

  if (customSelector) {
    const selectors = customSelector
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    selectors.forEach((selector) => {
      try {
        const nodes = document.querySelectorAll(selector);
        logSample(`(${selector})`, nodes);
      } catch (e) {
        console.warn(`Invalid selector: "${selector}"`);
      }
    });
  }

  console.groupEnd();
}

// Re-run when relevant settings change
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;

  // If custom selector changed, re-run immediately
  if (changes.customElement) {
    const newValue = changes.customElement.newValue || "";
    // Only run if feature is enabled
    chrome.storage.sync.get("showButtonsLinks", ({ showButtonsLinks }) => {
      if (showButtonsLinks) showAllElements(newValue);
    });
  }

  // If toggle flipped on, run with current custom selector
  if (changes.showButtonsLinks && changes.showButtonsLinks.newValue === true) {
    chrome.storage.sync.get("customElement", ({ customElement }) => {
      showAllElements(customElement || "");
    });
  }
});

// Initial deferred run
onReady(() => {
  chrome.storage.sync.get(["showButtonsLinks", "customElement"], ({ showButtonsLinks, customElement }) => {
    if (!showButtonsLinks || excludedDomains.includes(currentDomain)) return;

    const run = () => showAllElements(customElement || "");
    if ("requestIdleCallback" in window) {
      requestIdleCallback(run, { timeout: 3000 });
    } else {
      setTimeout(run, 3000);
    }
  });
});

// ===================== Click Crawler injector/receiver (CSP-safe) ======================
(function () {
  const CRAWLER_ID = "__ga_gtm_util_crawler_script__";

  function injectCrawlerIfNeeded() {
    return new Promise((resolve) => {
      if (document.getElementById(CRAWLER_ID)) return resolve(true);
      const s = document.createElement("script");
      s.id = CRAWLER_ID;
      s.src = chrome.runtime.getURL("crawler.js");
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function postRun({ mode, topLevelSelector }) {
    const config = {
      // base behavior (same as before)
      parentSelector: "a, button",
      includeDescendants: true,
      descendantFilter: "*",
      innerFirst: true,
      parentLast: true,
      minDelayMs: 180,
      maxDelayMs: 600,
      scrollMargin: 80,
      highlight: true,
      clickZeroSizeParents: true,
      // scope
      scopeMode: mode, // 'all' | 'exclude' | 'only'
      topLevelSelector: topLevelSelector || null,
    };

    window.postMessage({ source: "GA_UTIL", type: "CLICK_CRAWLER_RUN", payload: { config } }, "*");
  }

  function postStop({ teardown = true } = {}) {
    window.postMessage({ source: "GA_UTIL", type: "CLICK_CRAWLER_STOP", payload: { teardown } }, "*");
  }

  function postTeardown() {
    window.postMessage({ source: "GA_UTIL", type: "CLICK_CRAWLER_TEARDOWN" }, "*");
  }

  // Listen for popup messages
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return;

    (async () => {
      const needInjection = msg.type === "CLICK_CRAWLER_RUN" || msg.type === "CLICK_CRAWLER_STOP" || msg.type === "CLICK_CRAWLER_TEARDOWN";

      if (needInjection) {
        const ok = await injectCrawlerIfNeeded();
        if (!ok) {
          sendResponse({ ok: false, error: "Failed to inject crawler.js" });
          return;
        }
      }

      if (msg.type === "CLICK_CRAWLER_RUN") {
        const { mode, topLevelSelector } = msg.payload || {};
        postRun({ mode, topLevelSelector });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "CLICK_CRAWLER_STOP") {
        const { teardown = true } = msg.payload || {};
        postStop({ teardown });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "CLICK_CRAWLER_TEARDOWN") {
        postTeardown();
        sendResponse({ ok: true });
        return;
      }
    })();

    return true; // async response
  });
})();
