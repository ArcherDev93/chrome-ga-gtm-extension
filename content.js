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
  const locURL = window.location.href; /** Used for all URL related logic */
  const isExplorationPage = location.hostname.includes("analytics.google.com") && location.href.includes("analysis") && location.href.includes("edit"); // If it's the Exploration page in GA4

  let titleUpdatesEnabled = true; // gate for any title changes
  let gaTitleIntervalId = null; // store GA4EasyTitle interval id

  /***********************
   * Title Element Observers (simple & direct)
   * - Watch the elements where GA/GTM render names.
   * - When their text changes, recompute and set document.title.
   ***********************/
  function observeTextChange(selectors, onText) {
    const sel = selectors.join(", ");
    let el = null;

    function attach() {
      el = document.querySelector(sel);
      if (!el) {
        // Try again shortly; GA/GTM often render late
        setTimeout(attach, 300);
        return;
      }

      // Initial fire
      const initial = (el.textContent || "").trim();
      CatLog("Observer attached", { selector: sel, initial });
      onText(initial);

      // Observe text changes
      const mo = new MutationObserver(() => {
        const current = (el.textContent || "").trim();
        onText(current);
      });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
    }

    attach();
  }

  function updateTitle() {
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
      const parts = text.split("-");
      if (parts.length >= 3) {
        const newTitle = parts.slice(2).join("-").trim();
        CatLog(`Document Title (GA): ${newTitle}`);
        document.title = newTitle;
      }
    }
  }

  function updateTitleFromGTM() {
    if (!titleUpdatesEnabled) return; // <-- gate
    console.groupCollapsed("%c[GA4/GTM Utility] Updating document title", LOG_COLOR);
    const elGTM = document.querySelector(".suite-up-text-name");
    if (elGTM) {
      const text = elGTM.textContent.trim();
      const lowerText = text.toLowerCase();

      if (lowerText.includes("zone") && lowerText.includes("parts")) {
        document.title = "PCC Zone";
        CatLog(`Set title from GTM (PCC Zone): ${document.title}`);
        return;
      }

      if (lowerText.includes("zone") && lowerText.includes("www")) {
        document.title = "CAT Zone";
        CatLog(`Set title from GTM (CAT Zone): ${document.title}`);
        return;
      }

      const parts = text.split("-");
      const newTitle = parts[0].trim();
      document.title = newTitle;
      CatLog(`Set title from GTM: ${newTitle}`);
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
      if (titleUpdatesEnabled && locURL.includes("workspaces")) updateTitleFromGTM();
    });
  }

  function checkGTMWorkspacePage() {
    if (locURL.includes("tagmanager.google.com") && locURL.includes("workspaces")) {
      const existingStyle = document.getElementById("gtm-workspace-style");
      if (!existingStyle) {
        const style = document.createElement("style");
        style.id = "gtm-workspace-style";
        style.textContent = GTMStylesheet;
        document.head.appendChild(style);
        CatLog("✅ Added CSS for GTM Workspace");
      }
    }

    enhanceGTMInputInteraction();
  }

  function enhanceGTMInputInteraction() {
    const inputs = document.querySelectorAll("input.gtmPredicateExpression, input.ctui-text-input");

    inputs.forEach((input) => {
      input.addEventListener("click", () => {
        const value = input.value || "";
        if (value.length <= 30) return; // Only proceed if value is longer than 30 characters

        const parent = input.closest("div"); // Adjust this selector if needed
        if (!parent) return;

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
    });
  }

  function tagAssistantCSS() {
    if (locURL.includes("tagassistant.google.com") && locURL.includes("TAG_MANAGER")) {
      CatLog("✅ Added CSS for Tag Assistant");
      const existingStyle = document.getElementById("tag-assistant-style");
      if (!existingStyle) {
        const style = document.createElement("style");
        style.id = "tag-assistant-style";
        style.textContent = TAGStylesheet;
        document.head.appendChild(style);
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

  chrome.storage.sync.get(["updateTitle", "gtmWorkspaceCSS", "tagAssistantCSS"], (toggles) => {
    const debouncedUpdate = debounce(() => {
      // stop changing titles when the flag is off
      if (toggles.updateTitle && titleUpdatesEnabled) updateTitle();
      if (toggles.gtmWorkspaceCSS) checkGTMWorkspacePage();
      if (toggles.tagAssistantCSS) tagAssistantCSS();
    }, 1000);

    const observer = new MutationObserver(debouncedUpdate);
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial run
    if (toggles.updateTitle && titleUpdatesEnabled) updateTitle();
    if (toggles.gtmWorkspaceCSS) checkGTMWorkspacePage();
    if (toggles.tagAssistantCSS) tagAssistantCSS();

    // ---- STOP TITLE CHANGES AFTER 8 SECONDS ----
    setTimeout(() => {
      titleUpdatesEnabled = false; // stop any future title mutations
      if (gaTitleIntervalId) {
        clearInterval(gaTitleIntervalId); // stop GA4EasyTitle interval
        gaTitleIntervalId = null;
      }
      CatLog("Title updates disabled (timeout)");
    }, 8000);
  });

  /******************/
  /*Exploration Page*/
  /******************/
  if (isExplorationPage) {
    let lastHeaderGroup = null;

    document.addEventListener("click", (event) => {
      const g = event.target.closest("g.header-value");
      if (g) lastHeaderGroup = g;
    });

    // ---- Toast helpers ----
    function ensureToastUI() {
      if (!document.getElementById("ga-toast-style")) {
        const style = document.createElement("style");
        style.id = "ga-toast-style";
        style.textContent = `
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
      `;
        document.head.appendChild(style);
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
      const el = event.target;
      const isEditable = el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName);
      if (isEditable) return;

      const isCopyCombo = ((event.ctrlKey || event.metaKey) && (event.key?.toLowerCase() === "c" || event.code === "KeyC")) || event.key === "`";

      if (!isCopyCombo) return;

      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed) return;

      if (!lastHeaderGroup) return;

      const combined = Array.from(lastHeaderGroup.querySelectorAll("text:not(.row-index)"))
        .map((t) => (t.textContent || "").trim())
        .join("");

      if (!combined) return;

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
});
