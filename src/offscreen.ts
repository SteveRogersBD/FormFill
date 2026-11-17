const authHelperUrl = import.meta.env.VITE_FIREBASE_AUTH_HELPER_URL;
const helperOrigin = authHelperUrl ? new URL(authHelperUrl).origin : '';
const iframe = document.createElement('iframe');
let helperLoaded = false;
iframe.addEventListener('load', () => { helperLoaded = true; }, { once: true });
iframe.src = authHelperUrl ?? 'about:blank';
document.body.append(iframe);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message?.type !== 'APPLYAI_OFFSCREEN_AUTH') return false;
  if (!authHelperUrl || !helperOrigin) {
    sendResponse({ error: 'Set VITE_FIREBASE_AUTH_HELPER_URL and deploy the Firebase auth helper before signing in.' });
    return false;
  }
  let completed = false;
  let timeoutId: ReturnType<typeof setTimeout>;
  const finish = (result: { error?: string; idToken?: string; accessToken?: string }) => {
    if (completed) return;
    completed = true;
    clearTimeout(timeoutId);
    window.removeEventListener('message', onResult);
    iframe.removeEventListener('load', beginAuth);
    sendResponse(result);
  };
  const onResult = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== helperOrigin || event.data?.type !== 'APPLYAI_GOOGLE_SIGN_IN_RESULT') return;
    finish(event.data);
  };
  const beginAuth = () => {
    if (!iframe.contentWindow) {
      finish({ error: 'Could not open the hosted Google sign-in page.' });
      return;
    }
    iframe.removeEventListener('load', beginAuth);
    iframe.contentWindow.postMessage({ type: 'APPLYAI_BEGIN_GOOGLE_SIGN_IN' }, helperOrigin);
  };
  window.addEventListener('message', onResult);
  timeoutId = setTimeout(() => finish({ error: 'The hosted sign-in page did not respond. Check Firebase Hosting and Authentication settings, then try again.' }), 45_000);
  if (helperLoaded) beginAuth();
  else iframe.addEventListener('load', beginAuth, { once: true });
  return true;
});
