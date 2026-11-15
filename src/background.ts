let creatingOffscreenDocument: Promise<void> | undefined;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.some((context) => context.documentUrl === url)) return;
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['IFRAME_SCRIPTING'],
      justification: 'Run Firebase Google sign-in in the hosted helper page required by Manifest V3.',
    }).finally(() => { creatingOffscreenDocument = undefined; });
  }
  await creatingOffscreenDocument;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'APPLYAI_SIGN_IN') return false;
  (async () => {
    await ensureOffscreenDocument();
    try {
      const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'APPLYAI_OFFSCREEN_AUTH' });
      if (result?.error) throw new Error(result.error);
      if (!result?.idToken || !result?.accessToken) throw new Error('Google sign-in did not return usable credentials.');
      sendResponse({ idToken: result.idToken, accessToken: result.accessToken });
    } finally {
      await chrome.offscreen.closeDocument();
    }
  })().catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'Could not sign in with Google.' }));
  return true;
});
