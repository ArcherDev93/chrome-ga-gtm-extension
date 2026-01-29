// crawler.js
/**
 * Click Crawler (anchors/buttons + all descendants)
 * - DOM order (top → bottom) for parents
 * - Per parent: descendants (inner→outer), then parent
 * - Blocks only navigation (anchors, form submits, window.open, history API)
 * - GTM handlers still receive events (no propagation is stopped)
 * - STOP & teardown included
 * - Scope filtering: 'all' | 'exclude' | 'only' with topLevelSelector
 * - Dropdown support: rescanAfterClick ('none' | 'parent' | 'each') + rescanWaitMs
 *
 * Public API:
 *   window.__clickCrawler.run({
 *     maxParents, maxPerParent,
 *     scopeMode: 'all'|'exclude'|'only',
 *     topLevelSelector: string|null,
 *     rescanAfterClick: 'none'|'parent'|'each',
 *     rescanWaitMs: number
 *   })
 *   window.__clickCrawler.stop({ teardown?: boolean })
 *   window.__clickCrawler.teardown()
 *   window.__clickCrawler.config(newCfg)
 *   window.__clickCrawler.status()
 */
(function () {
  if (window.__clickCrawler?.stop) {
    try {
      window.__clickCrawler.stop({ teardown: true });
    } catch {}
  }

  // --------------------------- Configuration --------------------------------
  const defaultCfg = {
    parentSelector: "a, button",
    includeDescendants: true,
    descendantFilter: "*",
    innerFirst: true,
    parentLast: true,
    maxParents: Infinity,
    maxPerParent: Infinity,
    minDelayMs: 180,
    maxDelayMs: 600,
    scrollMargin: 80,
    highlight: true,
    clickZeroSizeParents: true,

    // Scope filtering
    scopeMode: "all", // 'all' | 'exclude' | 'only'
    topLevelSelector: null, // CSS selector or null

    // Dropdown handling
    rescanAfterClick: "none", // 'none' | 'parent' | 'each'
    rescanWaitMs: 300,

    // In defaultCfg
    rescanRoot: "parent", // 'parent' | 'closest' | 'topLevel'
    rescanClosestSelector: "li",
  };

  // ------------------------------ State -------------------------------------
  const state = {
    interceptorsActive: false,
    undoFns: [],
    abort: false,
    pendingTimer: null,
    isRunning: false,
    cfg: { ...defaultCfg },
    globalSeen: new Set(),
  };

  // ------------------------------ Utils -------------------------------------
  const log = (...args) => console.log("[crawler]", ...args);
  const warn = (...args) => console.warn("[crawler]", ...args);

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const sleep = (ms) => {
    clearTimeout(state.pendingTimer);
    return new Promise((resolve) => {
      state.pendingTimer = setTimeout(resolve, ms);
    });
  };

  const shouldAbort = () => state.abort === true;

  function isActionable(el) {
    if (!el || !(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (el.tagName === "BUTTON" && (el.disabled || el.getAttribute("aria-disabled") === "true")) return false;
    return true;
  }

  function parentEligible(el, cfg) {
    if (isActionable(el)) return true;
    if (cfg.clickZeroSizeParents && el.tagName === "A") {
      const anyChild = !!el.querySelector(cfg.descendantFilter);
      if (anyChild) return true;
    }
    return Array.from(el.querySelectorAll(cfg.descendantFilter)).some(isActionable);
  }

  async function bringIntoView(el, cfg) {
    const rect = el.getBoundingClientRect();
    const topTarget = Math.max(0, window.scrollY + rect.top - innerHeight / 2 + cfg.scrollMargin);
    window.scrollTo({ top: topTarget, behavior: "smooth" });
    for (let waited = 0; waited < 250; waited += 50) {
      if (shouldAbort()) return;
      // eslint-disable-next-line no-await-in-loop
      await sleep(50);
    }
  }

  function flash(el, cfg) {
    if (!cfg.highlight) return;
    const prev = el.style.outline;
    el.style.outline = "2px solid #ff3b30";
    setTimeout(() => {
      el.style.outline = prev;
    }, 320);
  }

  function synthClick(targetEl) {
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
    try {
      targetEl.focus?.({ preventScroll: true });
    } catch {}
    try {
      targetEl.dispatchEvent(new MouseEvent("mouseover", opts));
    } catch {}
    try {
      targetEl.dispatchEvent(new MouseEvent("mousedown", opts));
    } catch {}
    try {
      targetEl.dispatchEvent(new MouseEvent("mouseup", opts));
    } catch {}
    try {
      targetEl.dispatchEvent(new MouseEvent("click", opts));
    } catch {}
  }

  function getRescanRoot(parent, cfg) {
    if (cfg.rescanRoot === "topLevel" && cfg.topLevelSelector) {
      const container = parent.closest(cfg.topLevelSelector);
      if (container) return container;
    }
    if (cfg.rescanRoot === "closest" && cfg.rescanClosestSelector) {
      const n = parent.closest(cfg.rescanClosestSelector);
      if (n) return n;
    }
    return parent;
  }

  function collectTargetsWithin(root, cfg) {
    let nodes = Array.from(root.querySelectorAll(cfg.descendantFilter)).filter(isActionable);
    if (cfg.innerFirst) nodes = nodes.reverse();
    return nodes;
  }

  // ----------------------- Navigation-only suppression ----------------------
  function installNavGuards() {
    if (state.interceptorsActive) return;

    const anchorGuard = function (e) {
      const a = e.target.closest && e.target.closest("a");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      const looksNavigational = href && href !== "#" && !href.toLowerCase().startsWith("javascript:");
      const isHashOnly = href.startsWith("#");
      if (looksNavigational || isHashOnly) e.preventDefault();
    };
    window.addEventListener("click", anchorGuard, { capture: true, passive: false });
    state.undoFns.push(() => window.removeEventListener("click", anchorGuard, { capture: true }));

    const submitGuard = (e) => e.preventDefault();
    window.addEventListener("submit", submitGuard, { capture: true, passive: false });
    state.undoFns.push(() => window.removeEventListener("submit", submitGuard, { capture: true }));

    const originalOpen = window.open;
    const originalAssign = window.location.assign;
    const originalReplace = window.location.replace;
    const originalPushState = history.pushState;
    const originalRepState = history.replaceState;

    window.open = function () {
      return null;
    };
    window.location.assign = function () {};
    window.location.replace = function () {};
    history.pushState = function () {};
    history.replaceState = function () {};

    state.undoFns.push(() => {
      window.open = originalOpen;
    });
    state.undoFns.push(() => {
      window.location.assign = originalAssign;
    });
    state.undoFns.push(() => {
      window.location.replace = originalReplace;
    });
    state.undoFns.push(() => {
      history.pushState = originalPushState;
    });
    state.undoFns.push(() => {
      history.replaceState = originalRepState;
    });

    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload, { capture: true });
    state.undoFns.push(() => window.removeEventListener("beforeunload", onBeforeUnload, { capture: true }));

    state.interceptorsActive = true;
  }

  function uninstallNavGuards() {
    while (state.undoFns.length) {
      try {
        state.undoFns.pop()();
      } catch {}
    }
    state.interceptorsActive = false;
  }

  // ------------------- Build per-parent click target list -------------------
  function buildTargetsForParent(parent, cfg) {
    const list = [];

    if (cfg.includeDescendants) {
      let descendants = Array.from(parent.querySelectorAll(cfg.descendantFilter)).filter((node) => node !== parent && isActionable(node));
      if (cfg.innerFirst) descendants = descendants.reverse();
      list.push(...descendants);
    }

    const parentOk = isActionable(parent) || (cfg.clickZeroSizeParents && parent.tagName === "A");
    if (parentOk) {
      if (cfg.parentLast) list.push(parent);
      else list.unshift(parent);
    }

    const seen = new Set();
    const deduped = [];
    for (const n of list) {
      if (!seen.has(n)) {
        seen.add(n);
        deduped.push(n);
        if (deduped.length >= cfg.maxPerParent) break;
      }
    }
    return deduped;
  }

  // --------------------------- Scope Filtering ------------------------------
  function filterByScope(parents, cfg) {
    const mode = (cfg.scopeMode || "all").toLowerCase();
    const sel = (cfg.topLevelSelector || "").trim();
    if (mode === "all" || !sel) return parents;

    let containerNodes = [];
    try {
      containerNodes = Array.from(document.querySelectorAll(sel));
    } catch {
      return parents;
    }
    if (!containerNodes.length) return mode === "only" ? [] : parents;

    const isInsideAnyContainer = (el) => containerNodes.some((c) => c.contains(el));

    if (mode === "exclude") return parents.filter((el) => !isInsideAnyContainer(el));
    if (mode === "only") return parents.filter((el) => isInsideAnyContainer(el));
    return parents;
  }

  // -------------------------------- Run -------------------------------------
  async function run(options = {}) {
    if (state.isRunning) {
      log("Already running; ignoring concurrent run()");
      return;
    }
    state.cfg = { ...state.cfg, ...options };
    const cfg = state.cfg;

    state.abort = false;
    state.isRunning = true;
    state.globalSeen.clear();
    clearTimeout(state.pendingTimer);

    installNavGuards();

    let parents = Array.from(document.querySelectorAll(cfg.parentSelector)).filter((el) => parentEligible(el, cfg));
    parents = filterByScope(parents, cfg);
    if (Number.isFinite(cfg.maxParents)) parents = parents.slice(0, cfg.maxParents);

    log(
      `Parents: ${parents.length} | scopeMode=${cfg.scopeMode} | topLevelSelector=${cfg.topLevelSelector || "∅"} | includeDescendants=${!!cfg.includeDescendants} | rescan=${cfg.rescanAfterClick}(${cfg.rescanWaitMs}ms)`,
    );

    for (let p = 0; p < parents.length; p++) {
      if (shouldAbort()) break;

      const parent = parents[p];
      if (!document.contains(parent)) continue;

      await bringIntoView(parent, cfg);
      if (shouldAbort()) break;

      const targets = buildTargetsForParent(parent, cfg);
      if (!targets.length) continue;

      // Track which targets we already queued within this parent loop to prevent local re-queue dupes
      const localQueued = new Set(targets);

      for (let i = 0; i < targets.length; i++) {
        if (shouldAbort()) break;

        const el = targets[i];
        if (!document.contains(el)) continue;
        if (state.globalSeen.has(el)) continue;
        if (!isActionable(el) && !(cfg.clickZeroSizeParents && el === parent && el.tagName === "A")) continue;

        flash(el, cfg);

        const delay = rand(cfg.minDelayMs, cfg.maxDelayMs);
        for (let waited = 0; waited < delay; waited += 50) {
          if (shouldAbort()) break;
          // eslint-disable-next-line no-await-in-loop
          await sleep(Math.min(50, delay - waited));
        }
        if (shouldAbort()) break;

        try {
          synthClick(el);
          state.globalSeen.add(el);
        } catch (err) {
          warn("click failed on element:", el, err);
        }

        // ---------------------- RESCAN AFTER CLICK (dropdowns) ----------------------
        const clickedIsParent = el === parent;
        const shouldRescan = cfg.rescanAfterClick === "each" || (cfg.rescanAfterClick === "parent" && clickedIsParent);

        if (shouldRescan) {
          // Wait for UI to update (dropdown/accordion animations)
          const wait = Math.max(0, Number.isFinite(cfg.rescanWaitMs) ? cfg.rescanWaitMs : 0);
          for (let waited = 0; waited < wait; waited += 50) {
            if (shouldAbort()) break;
            // eslint-disable-next-line no-await-in-loop
            await sleep(Math.min(50, wait - waited));
          }
          if (shouldAbort()) break;

          // NEW: rescan within a container that includes siblings (e.g., the <li>)
          const root = getRescanRoot(parent, cfg);

          // IMPORTANT: limit to clickable nodes (e.g., anchors/buttons) via descendantFilter
          let newTargets = collectTargetsWithin(root, cfg).filter((n) => !state.globalSeen.has(n) && !localQueued.has(n));

          // Respect maxPerParent cap by limiting how many we add
          if (Number.isFinite(cfg.maxPerParent)) {
            const remaining = Math.max(0, cfg.maxPerParent - targets.length);
            if (remaining <= 0) newTargets = [];
            else if (newTargets.length > remaining) newTargets = newTargets.slice(0, remaining);
          }

          // Enqueue newly revealed items
          for (const n of newTargets) {
            targets.push(n);
            localQueued.add(n);
          }
        }
        // ---------------------------------------------------------------------------
      }
    }

    clearTimeout(state.pendingTimer);
    state.pendingTimer = null;
    state.isRunning = false;

    log(state.abort ? "Aborted." : "Done.");
  }

  // ------------------------------- Stop/Teardown ----------------------------
  function stop({ teardown = true } = {}) {
    state.abort = true;
    clearTimeout(state.pendingTimer);
    state.pendingTimer = null;
    try {
      window.stop?.();
    } catch {}
    if (teardown) uninstallNavGuards();
    state.isRunning = false;
    log("STOP requested; exiting safely…");
  }

  function teardown() {
    uninstallNavGuards();
    log("Navigation restored.");
  }

  // ------------------------------ Public API --------------------------------
  window.__clickCrawler = {
    run,
    stop,
    teardown,
    config(newCfg = {}) {
      state.cfg = { ...state.cfg, ...newCfg };
      return { ...state.cfg };
    },
    status() {
      return {
        running: state.isRunning,
        interceptorsActive: state.interceptorsActive,
        pendingTimer: !!state.pendingTimer,
        cfg: { ...state.cfg },
      };
    },
  };

  // ------------------------------ Message Bridge -----------------------------
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (!data || data.source !== "GA_UTIL") return;

    try {
      if (data.type === "CLICK_CRAWLER_RUN") {
        const cfg = data.payload && data.payload.config ? data.payload.config : {};
        window.__clickCrawler.run(cfg);
      } else if (data.type === "CLICK_CRAWLER_STOP") {
        const teardown = !!(data.payload && data.payload.teardown);
        window.__clickCrawler.stop({ teardown });
      } else if (data.type === "CLICK_CRAWLER_TEARDOWN") {
        window.__clickCrawler.teardown();
      }
    } catch (e) {
      console.warn("[crawler] message handling failed", e);
    }
  });

  log("Ready. Start: __clickCrawler.run({ scopeMode:'all'|'exclude'|'only', topLevelSelector:'#app', rescanAfterClick:'parent'|'each', rescanWaitMs:300 })");
})();
