const authHelperUrl = import.meta.env.VITE_FIREBASE_AUTH_HELPER_URL;
const helperOrigin = authHelperUrl ? new URL(authHelperUrl).origin : '';
const iframe = document.createElement('iframe');
iframe.src = authHelperUrl ?? 'about:blank';
document.body.append(iframe);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message?.type !== 'APPLYAI_OFFSCREEN_AUTH') return false;
  if (!authHelperUrl || !helperOrigin) {
    sendResponse({ error: 'Set VITE_FIREBASE_AUTH_HELPER_URL and deploy the Firebase auth helper before signing in.' });
    return false;
  }
  const onResult = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== helperOrigin || event.data?.type !== 'APPLYAI_GOOGLE_SIGN_IN_RESULT') return;
    window.removeEventListener('message', onResult);
    sendResponse(event.data);
  };
  window.addEventListener('message', onResult);
  iframe.addEventListener('load', () => iframe.contentWindow?.postMessage({ type: 'APPLYAI_BEGIN_GOOGLE_SIGN_IN' }, helperOrigin), { once: true });
  iframe.src = authHelperUrl;
  return true;
});
