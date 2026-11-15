chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'APPLYAI_OPEN_DASHBOARD') {
    chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
