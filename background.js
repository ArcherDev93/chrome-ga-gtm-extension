
// background.js (MV3 service worker)
// Sets install-time defaults without overwriting existing user choices.

chrome.runtime.onInstalled.addListener(() => {
  const defaults = {
    updateTitle: true,
    gtmWorkspaceCSS: true,
    tagAssistantCSS: true,
    showButtonsLinks: true,
    // If you decide to add this feature, include it here and add UI: 
    // azureDevTags: true,
    customElement: "" // Empty by default
  };

  chrome.storage.sync.get(Object.keys(defaults), (cur) => {
    const toSet = {};
    for (const [k, v] of Object.entries(defaults)) {
      if (typeof cur[k] === "undefined") toSet[k] = v;
    }
    if (Object.keys(toSet).length) chrome.storage.sync.set(toSet);
  });
});
