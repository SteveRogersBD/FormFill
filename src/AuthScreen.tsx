import { useState } from 'react';

export function AuthScreen({ onLogin, sidePanel, setupRequired = false }: { onLogin: () => Promise<void>; sidePanel: boolean; setupRequired?: boolean }) {
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const startLogin = async () => {
    setWorking(true);
    setError('');
    try { await onLogin(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Google sign-in failed.'); }
    finally { setWorking(false); }
  };
  return <main className={`auth-shell ${sidePanel ? 'auth-compact' : ''}`}>
    <div className="brand-mark">A</div>
    <p className="eyebrow">YOUR APPLICATION COPILOT</p>
    <h1>{setupRequired ? 'Connect your Firebase project' : 'Make every application easier.'}</h1>
    <p className="muted">{setupRequired ? 'Add your Firebase web app settings to .env.local. The dashboard uses Google sign-in, Cloud Storage for your PDF, and Firestore for your reviewed profile.' : 'Keep your profile ready, then fill supported job forms with answers you can review.'}</p>
    {setupRequired && <pre className="setup-note">VITE_FIREBASE_API_KEY=…{`\n`}VITE_FIREBASE_AUTH_DOMAIN=…{`\n`}VITE_FIREBASE_PROJECT_ID=…{`\n`}VITE_FIREBASE_STORAGE_BUCKET=…{`\n`}VITE_FIREBASE_APP_ID=…</pre>}
    {error && <div className="notice error" role="alert">{error}</div>}
    <button className="button primary wide" onClick={startLogin} disabled={setupRequired || working}>{working ? 'Opening Google…' : 'Continue with Google'}</button>
    <p className="fine-print">Your resume stays in your Firebase account. Review extracted details before saving.</p>
  </main>;
}
