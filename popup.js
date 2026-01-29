// popup.js

document.addEventListener("DOMContentLoaded", () => {
  // Existing feature toggles
  const featureKeys = [
    "updateTitle",
    "gtmWorkspaceCSS",
    "tagAssistantCSS",
    "showButtonsLinks",
    // If you add: "azureDevTags"
  ];

  const customElementInput = document.getElementById("customElement");
  const customElementBox = document.getElementById("customElementBox");
  const accordionToggle = document.querySelector("#accordionToggle .chevron");

  chrome.storage.sync.get([...featureKeys, "customElement"], (stored) => {
    featureKeys.forEach((key) => {
      const checkbox = document.getElementById(key);
      if (!checkbox) return;
      checkbox.checked = typeof stored[key] === "boolean" ? stored[key] : false;
      checkbox.addEventListener("change", () => {
        chrome.storage.sync.set({ [key]: checkbox.checked });
      });
    });

    if (customElementInput) {
      customElementInput.value = stored.customElement || "";
      customElementInput.addEventListener("blur", () => {
        const sanitizedValue = sanitizeSelectorInput(customElementInput.value);
        chrome.storage.sync.set({ customElement: sanitizedValue });
      });
    }
  });

  if (accordionToggle && customElementBox) {
    accordionToggle.addEventListener("click", () => {
      const isOpen = customElementBox.style.display === "block";
      customElementBox.style.display = isOpen ? "none" : "block";
      accordionToggle.classList.toggle("open", !isOpen);
    });
  }

  // --- Click Crawler UI wiring (no crawler code injected yet) ---

  const modeAll = document.getElementById("crawlerModeAll");
  const modeExclude = document.getElementById("crawlerModeExclude");
  const modeOnly = document.getElementById("crawlerModeOnly");
  const topSelectorInput = document.getElementById("crawlerTopSelector");
  const runBtn = document.getElementById("runClickCrawlerBtn");
  const statusEl = document.getElementById("crawlerStatus");

  function setTopSelectorEnabled() {
    const needsInput = modeExclude.checked || modeOnly.checked;
    topSelectorInput.disabled = !needsInput;
    if (needsInput) {
      topSelectorInput.placeholder = modeExclude.checked ? "Exclude selector (e.g. header, .nav, #footer)" : "Only selector (e.g. main, .content, #app)";
    } else {
      topSelectorInput.placeholder = "e.g. header, .nav, #footer";
    }
  }

  [modeAll, modeExclude, modeOnly].forEach((r) => r && r.addEventListener("change", setTopSelectorEnabled));
  setTopSelectorEnabled();

  runBtn?.addEventListener("click", async () => {
    clearStatus();
    const mode = modeAll.checked ? "all" : modeExclude.checked ? "exclude" : "only";
    let topSelector = topSelectorInput.value.trim();
    if (mode !== "all") {
      topSelector = sanitizeSelectorInput(topSelector);
      if (!topSelector) {
        return setStatus("Provide a valid top-level selector.", true);
      }
    }

    disableRun(true);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab.");

      // Send only the instruction (no crawler code here).
      const payload = { mode, topLevelSelector: topSelector || null };

      const response = await sendMessageToTab(tab.id, {
        type: "CLICK_CRAWLER_RUN",
        payload,
      });

      if (response?.ok) {
        setStatus("Crawler request sent.", false);
      } else {
        setStatus(response?.error || "Crawler receiver not found in this page.", true);
      }
    } catch (err) {
      setStatus(err?.message || "Failed to send crawler request.", true);
    } finally {
      disableRun(false);
    }
  });

  // Below your runBtn handler
  const stopBtn = document.getElementById("stopClickCrawlerBtn");
  const teardownBtn = document.getElementById("teardownClickCrawlerBtn");

  stopBtn?.addEventListener("click", async () => {
    clearStatus();
    disableRun(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab.");

      const res = await sendMessageToTab(tab.id, {
        type: "CLICK_CRAWLER_STOP",
        payload: { teardown: true }, // stop + restore guards
      });

      setStatus(res?.ok ? "Stop sent." : res?.error || "Receiver not found.", !res?.ok);
    } catch (e) {
      setStatus(e?.message || "Failed to send stop.", true);
    } finally {
      disableRun(false);
    }
  });

  teardownBtn?.addEventListener("click", async () => {
    clearStatus();
    disableRun(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab.");

      const res = await sendMessageToTab(tab.id, {
        type: "CLICK_CRAWLER_TEARDOWN",
      });

      setStatus(res?.ok ? "Teardown sent." : res?.error || "Receiver not found.", !res?.ok);
    } catch (e) {
      setStatus(e?.message || "Failed to send teardown.", true);
    } finally {
      disableRun(false);
    }
  });

  function disableRun(disabled) {
    if (!runBtn) return;
    runBtn.disabled = disabled;
    runBtn.classList.toggle("wait", disabled);
    runBtn.classList.toggle("saving", disabled);
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#c62828" : "#4C9AFF";
  }
  function clearStatus() {
    if (!statusEl) return;
    statusEl.textContent = "";
  }

  function sendMessageToTab(tabId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res);
          }
        });
      } catch (e) {
        resolve({ ok: false, error: e?.message || "sendMessage failed" });
      }
    });
  }

  // Allow common CSS selector syntax (safe, useful)
  function sanitizeSelectorInput(input) {
    // Allowed:
    // - Alphanumerics, whitespace
    // - . # , - _ (class/id/list/separators)
    // - * > : [] () = ^ $ | quotes (common pseudo, attribute, combinators)
    return input.replace(/[^a-zA-Z0-9\s\-\_\.\,\#\*\>\:\[\]\=\^\$\|\(\)'"]/g, "");
  }
});
