let creatingOffscreenDocument: Promise<void> | undefined;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Google sign-in timed out. Check the hosted sign-in page and try again.')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.id !== 'number') return;
  const origin = tab.url && /^https?:/.test(tab.url) ? new URL(tab.url).origin : '';
  const tabContext = { tabId: tab.id, origin };
  // Open directly in the click handler so Chrome recognizes its user gesture.
  void Promise.all([
    chrome.storage.session.set({ applyAiActiveTab: tabContext }),
    chrome.sidePanel.open({ tabId: tab.id }),
  ]).catch(() => undefined);
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
    try {
      await withTimeout(ensureOffscreenDocument(), 15_000);
      const result = await withTimeout(chrome.runtime.sendMessage({ target: 'offscreen', type: 'APPLYAI_OFFSCREEN_AUTH' }), 60_000);
      if (result?.error) throw new Error(result.error);
      if (!result?.idToken || !result?.accessToken) throw new Error('Google sign-in did not return usable credentials.');
      sendResponse({ idToken: result.idToken, accessToken: result.accessToken });
    } finally {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (contexts.length) await chrome.offscreen.closeDocument();
    }
  })().catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'Could not sign in with Google.' }));
  return true;
});
