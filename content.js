// content.js
/***********************
 * Global CatLog (safe prefix + color)
 ***********************/
function CatLog() {
  var args = Array.prototype.slice.call(arguments);
  var prefix = "%c[GA4/GTM Utility]";
  var color = (typeof LOG_COLOR !== "undefined" && LOG_COLOR) || (typeof window !== "undefined" && window.LOG_COLOR) || "color:#4C9AFF";

  if (args.length && typeof args[0] === "string") {
    args[0] = prefix + " " + args[0];
  } else {
    args.unshift(prefix);
  }

  args.splice(1, 0, color);
  try {
    console.log.apply(console, args);
  } catch (e) {
    console.log(prefix, args);
  }
}

// Content.js
window.addEventListener("load", (event) => {
  const LOG_COLOR = "color: #4C9AFF";
  window.LOG_COLOR = LOG_COLOR; // expose for CatLog

  const GTMStylesheet = `
      .sheet-scrollpane .gtm-predicate-summary-row {
        white-space: normal !important;
        font-size: 1.2rem;
      }
      .sheet-scrollpane .gtm-predicate-summary-row span:last-of-type {
        background: #ffe362;
        font-family: monospace;
        font-size: 1.2rem;
      }
    `;
  const TAGStylesheet = `
      .gtm-debug-trigger-property-container {
        position: relative;
      }
      .gtm-debug-trigger-property-container .gtm-debug-card__title .icon.icon-check::after {
        content: " ";
        position: absolute;
        width: 100%;
        height: 100%;
        display: block;
        background: #2fc13121;
        left: 0;
        top: 0px;
        user-select: none;
        pointer-events: none;
      }
    `;
  const getLocURL = () => window.location.href; /** Used for all URL related logic */

  function ensureStyleTag(styleId, cssText) {
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      (document.head || document.documentElement).appendChild(style);
    }

    if (style.textContent !== cssText) {
      style.textContent = cssText;
    }

    return style;
  }

  const isExplorationRoute = () => {
    const url = location.href;
    const hash = location.hash || "";
    const isMatch = location.hostname.includes("analytics.google.com") && (hash.includes("/analysis/") || hash.includes("/explore") || hash.includes("/edit/") || url.includes("analysis") || url.includes("explore") || url.includes("/edit/"));
    CatLog(`Exploration route check: ${isMatch}`, { url, hash });
    return isMatch;
  };

  let titleUpdatesEnabled = true; // gate for any title changes
  let gaTitleIntervalId = null; // store GA4EasyTitle interval id
  let lastAppliedTitle = "";
  let gtmInputClickBound = false;
  const featureToggles = {
    updateTitle: true,
    gtmWorkspaceCSS: true,
    tagAssistantCSS: true,
  };

  /***********************
   * Title Element Observers (simple & direct)
   * - Watch the elements where GA/GTM render names.
   * - When their text changes, recompute and set document.title.
   ***********************/
  function observeTextChange(selectors, onText) {
    const sel = selectors.join(", ");
    let el = null;
    let lastText = "";
    let moText = null;

    function attach() {
      const nextEl = document.querySelector(sel);
      if (!nextEl) {
        // Try again shortly; GA/GTM often render late
        setTimeout(attach, 300);
        return;
      }

      if (nextEl === el) return;

      if (moText) moText.disconnect();
      el = nextEl;
      lastText = "";

      // Initial fire
      const initial = (el.textContent || "").trim();
      CatLog("Observer attached", { selector: sel, initial });
      if (initial !== lastText) {
        lastText = initial;
        onText(initial);
      }

      // Observe text changes
      moText = new MutationObserver(() => {
        const current = (el.textContent || "").trim();
        if (current === lastText) return;
        lastText = current;
        onText(current);
      });
      moText.observe(el, { childList: true, characterData: true, subtree: true });
    }

    const moDom = new MutationObserver(() => {
      if (!el || !el.isConnected) {
        attach();
        return;
      }

      const currentEl = document.querySelector(sel);
      if (currentEl && currentEl !== el) attach();
    });
    moDom.observe(document.body, { childList: true, subtree: true });

    attach();
  }

  function setDocumentTitle(nextTitle, source = "") {
    const normalized = (nextTitle || "").trim();
    if (!normalized) return;
    if (normalized === lastAppliedTitle && normalized === document.title) return;
    lastAppliedTitle = normalized;
    document.title = normalized;
    if (source) CatLog(`Set title (${source}): ${normalized}`);
  }

  function updateTitle() {
    const locURL = getLocURL();
    if (locURL.includes("analytics.google.com")) updateTitleFromGA();
    if (locURL.includes("tagmanager.google.com") && locURL.includes("workspaces")) updateTitleFromGTM();
    console.groupEnd();
  }

  function updateTitleFromGA() {
    if (!titleUpdatesEnabled) return; // <-- gate
    console.groupCollapsed("%c[GA4/GTM Utility] Updating document title", LOG_COLOR);
    const elGA = document.querySelector(".gmp-text-name") || document.querySelector(".gmp-title-text");
    if (elGA) {
      const text = elGA.textContent.trim();
      const parts = text
        .split("-")
        .map((p) => p.trim())
        .filter(Boolean);

      let newTitle = text;
      if (parts.length >= 2) {
        newTitle = parts.slice(-2).join(" - ").trim();
      }

      setDocumentTitle(newTitle, "GA");
    }
  }

  const GTM_TITLE_SELECTORS = [".suite-up-text-name", '[data-test-id="workspace-name"]', '[data-test-id="container-title"]', '[data-test-id="environment-name"]'];

  function getGtmTitleElement() {
    for (const selector of GTM_TITLE_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && (el.textContent || "").trim()) return el;
    }
    return null;
  }

  function updateTitleFromGTM() {
    if (!titleUpdatesEnabled) return; // <-- gate
    console.groupCollapsed("%c[GA4/GTM Utility] Updating document title", LOG_COLOR);
    const elGTM = getGtmTitleElement();
    if (elGTM) {
      const text = elGTM.textContent.trim();
      const lowerText = text.toLowerCase();

      if (lowerText.includes("zone") && lowerText.includes("parts")) {
        setDocumentTitle("PCC Zone", "GTM PCC Zone");
        return;
      }

      if (lowerText.includes("zone") && lowerText.includes("www")) {
        setDocumentTitle("CAT Zone", "GTM CAT Zone");
        return;
      }

      const parts = text.split("-");
      const newTitle = parts[0].trim();
      setDocumentTitle(newTitle, "GTM");
    }
  }

  // 🔭 NEW: Element observers (no history/dataLayer)
  // GA title element(s)
  if (location.hostname.includes("analytics.google.com")) {
    observeTextChange([".gmp-text-name", ".gmp-title-text"], () => {
      if (titleUpdatesEnabled) updateTitleFromGA();
    });
  }

  // GTM title element(s)
  if (location.hostname.includes("tagmanager.google.com")) {
    observeTextChange([".suite-up-text-name", '[data-test-id="workspace-name"]', '[data-test-id="container-title"]', '[data-test-id="environment-name"]'], () => {
      if (titleUpdatesEnabled && getLocURL().includes("workspaces")) updateTitleFromGTM();
    });
  }

  function checkGTMWorkspacePage() {
    const locURL = getLocURL();
    if (locURL.includes("tagmanager.google.com") && locURL.includes("workspaces")) {
      const hadStyle = !!document.getElementById("gtm-workspace-style");
      ensureStyleTag("gtm-workspace-style", GTMStylesheet);
      if (!hadStyle) {
        CatLog("✅ Added CSS for GTM Workspace");
      }
    }

    enhanceGTMInputInteraction();
  }

  function enhanceGTMInputInteraction() {
    if (gtmInputClickBound) return;
    gtmInputClickBound = true;

    document.addEventListener("click", (event) => {
      const input = event.target.closest("input.gtmPredicateExpression, input.ctui-text-input");
      if (!input) return;

      const value = input.value || "";
      if (value.length <= 30) return; // Only proceed if value is longer than 30 characters

      const parent = input.closest("div");
      if (!parent || !parent.parentNode) return;

      // Avoid duplicating textarea
      if (parent.nextSibling && parent.nextSibling.classList?.contains("gtm-textarea-wrapper")) return;

      const wrapper = document.createElement("div");
      wrapper.className = "gtm-textarea-wrapper";
      wrapper.style.marginTop = "8px";

      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.width = "100%";
      textarea.rows = 4;
      textarea.style.fontSize = "1.2rem";
      textarea.style.padding = "6px";
      textarea.style.boxSizing = "border-box";

      textarea.addEventListener("blur", () => {
        input.value = textarea.value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });

      wrapper.appendChild(textarea);
      parent.parentNode.insertBefore(wrapper, parent.nextSibling);
    });
  }

  function tagAssistantCSS() {
    const locURL = getLocURL();
    if (locURL.includes("tagassistant.google.com") && locURL.includes("TAG_MANAGER")) {
      const hadStyle = !!document.getElementById("tag-assistant-style");
      ensureStyleTag("tag-assistant-style", TAGStylesheet);
      if (!hadStyle) {
        CatLog("✅ Added CSS for Tag Assistant");
      }
    }
  }
  function debounce(fn, delay) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  const debouncedUpdate = debounce(() => {
    // stop changing titles when the flag is off
    if (featureToggles.updateTitle && titleUpdatesEnabled) updateTitle();
    if (featureToggles.gtmWorkspaceCSS) checkGTMWorkspacePage();
    if (featureToggles.tagAssistantCSS) tagAssistantCSS();
  }, 1000);

  chrome.storage.sync.get(["updateTitle", "gtmWorkspaceCSS", "tagAssistantCSS"], (storedToggles) => {
    for (const key of Object.keys(featureToggles)) {
      if (typeof storedToggles[key] === "boolean") featureToggles[key] = storedToggles[key];
    }

    // SPA navigation watcher (pushState/replaceState/popstate)
    const dispatchLocationChange = () => window.dispatchEvent(new Event("ga-util-location-change"));
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () {
      const ret = origPush.apply(this, arguments);
      dispatchLocationChange();
      return ret;
    };
    history.replaceState = function () {
      const ret = origReplace.apply(this, arguments);
      dispatchLocationChange();
      return ret;
    };
    window.addEventListener("popstate", dispatchLocationChange);
    window.addEventListener("ga-util-location-change", debouncedUpdate);

    const observer = new MutationObserver(debouncedUpdate);
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial run
    debouncedUpdate();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    let didToggleChange = false;
    for (const key of Object.keys(featureToggles)) {
      if (changes[key] && typeof changes[key].newValue === "boolean") {
        featureToggles[key] = changes[key].newValue;
        didToggleChange = true;
      }
    }

    if (didToggleChange) debouncedUpdate();
  });

  /******************/
  /*Exploration Page*/
  /******************/
  let lastHeaderGroup = null;
  let explorationBound = false;
  let explorationObserver = null;
  let lastMousePos = { x: 0, y: 0 };

  function bindExplorationCopy() {
    if (explorationBound) return;
    explorationBound = true;
    CatLog("Exploration copy bindings attached");

    document.addEventListener("mousemove", (event) => {
      lastMousePos = { x: event.clientX, y: event.clientY };
    });

    document.addEventListener("click", (event) => {
      const g = event.target.closest("g.header-value");
      if (g) lastHeaderGroup = g;
      CatLog("Exploration click detected", { hasHeader: !!g, targetTag: event.target.tagName });
    });

    // ---- Toast helpers ----
    function ensureToastUI() {
      if (!document.getElementById("ga-toast-style")) {
        ensureStyleTag(
          "ga-toast-style",
          `
        .ga-toast-container {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 999999;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
        }
        .ga-toast {
          pointer-events: auto;
          background: #ffffff;
          color: #212121;
          border: 1px solid #ececec;
          border-radius: 6px;
          padding: 8px 12px;
          box-shadow: 0 6px 16px rgba(0,0,0,0.2);
          font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 120ms ease, transform 120ms ease;
        }
        .ga-toast.show { opacity: 1; transform: translateY(0); }
      `,
        );
      }
      if (!document.getElementById("ga-toast-container")) {
        const container = document.createElement("div");
        container.className = "ga-toast-container";
        container.id = "ga-toast-container";
        document.body.appendChild(container);
      }
    }

    function showToast(message = "Copied!", durationMs = 2000) {
      ensureToastUI();
      const container = document.getElementById("ga-toast-container");
      const toast = document.createElement("div");
      toast.className = "ga-toast";
      toast.textContent = message;

      container.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add("show"));

      const remove = () => {
        toast.classList.remove("show");
        setTimeout(() => {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 140);
      };

      setTimeout(remove, durationMs);
    }
    // ---- /Toast helpers ----

    // Ctrl+C / Cmd+C or backtick to copy header values
    document.addEventListener("keydown", async (event) => {
      const isCopyCombo = ((event.ctrlKey || event.metaKey) && (event.key?.toLowerCase() === "c" || event.code === "KeyC")) || event.key === "`";

      if (isCopyCombo) {
        CatLog("Copy key pressed", { key: event.key, code: event.code, isExplorationRoute: isExplorationRoute(), hash: location.hash });
      }

      if (!isExplorationRoute()) return;

      const el = event.target;
      const isEditable = el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName);
      if (isEditable) return;

      if (!isCopyCombo) return;

      CatLog("Exploration copy shortcut detected", { key: event.key, code: event.code });

      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed) return;

      if (!lastHeaderGroup || !lastHeaderGroup.isConnected) {
        const hoverEl = document.elementFromPoint(lastMousePos.x, lastMousePos.y);
        const hoverGroup = hoverEl ? hoverEl.closest("g.header-value") : null;
        if (hoverGroup) lastHeaderGroup = hoverGroup;
        CatLog("Exploration hover header lookup", { found: !!hoverGroup });
      }

      if (!lastHeaderGroup || !lastHeaderGroup.isConnected) {
        const anyHeader = document.querySelector("g.header-value");
        if (anyHeader) lastHeaderGroup = anyHeader;
        CatLog("Exploration fallback header lookup", { found: !!anyHeader });
      }

      if (!lastHeaderGroup) return;

      const combined = Array.from(lastHeaderGroup.querySelectorAll("text:not(.row-index)"))
        .map((t) => (t.textContent || "").trim())
        .join("");

      if (!combined) return;

      CatLog("Exploration copy payload", { text: combined });

      event.preventDefault();

      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(combined);
          CatLog(`Copied: ${combined}`);
          showToast("Copied!");
          return;
        } catch (err) {
          // fall through to manual hint
        }
      }

      const ta = document.createElement("textarea");
      ta.value = combined;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();

      const isMac = navigator.platform.toUpperCase().includes("MAC");
      showToast(`Press ${isMac ? "⌘" : "Ctrl"}+C to copy`, 2000);

      setTimeout(() => {
        ta.remove();
      }, 2200);
    });
  }

  function initExplorationCopy() {
    CatLog("Exploration init check", { routeMatch: isExplorationRoute(), hash: location.hash });
    if (!isExplorationRoute()) return;
    bindExplorationCopy();
    const anyHeader = document.querySelector("g.header-value");
    if (anyHeader) lastHeaderGroup = anyHeader;
    CatLog("Exploration init complete", { foundHeader: !!anyHeader, totalHeaders: document.querySelectorAll("g.header-value").length });
  }

  const debouncedExplorationInit = debounce(initExplorationCopy, 400);
  debouncedExplorationInit();
  CatLog("Exploration init scheduled");

  explorationObserver = new MutationObserver(debouncedExplorationInit);
  explorationObserver.observe(document.body, { childList: true, subtree: true });
  CatLog("Exploration observer active");

  window.addEventListener("ga-util-location-change", debouncedExplorationInit);
});
