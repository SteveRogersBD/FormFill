import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './Dashboard';
import { AuthScreen } from './AuthScreen';
import { SidePanel } from './SidePanel';
import { firebaseReady, getFirebaseServices } from './firebase';
import './styles.css';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const sidePanel = location.pathname.endsWith('sidepanel.html');

  useEffect(() => {
    if (!firebaseReady) {
      setAuthReady(true);
      return;
    }
    let unsubscribe: (() => void) | undefined;
    getFirebaseServices().then(({ auth }) => {
      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
        setAuthReady(true);
      });
    }).catch(() => setAuthReady(true));
    return () => unsubscribe?.();
  }, []);

  const login = async () => {
    const { auth } = await getFirebaseServices();
    await signInWithPopup(auth, new GoogleAuthProvider());
  };
  const logout = async () => {
    const { auth } = await getFirebaseServices();
    await signOut(auth);
  };

  if (!authReady) return <main className="loading-screen">Loading ApplyAI…</main>;
  if (!firebaseReady) return <AuthScreen onLogin={login} sidePanel={sidePanel} setupRequired />;
  if (!user) return <AuthScreen onLogin={login} sidePanel={sidePanel} />;
  return sidePanel ? <SidePanel user={user} onLogout={logout} /> : <Dashboard user={user} onLogout={logout} />;
}

createRoot(document.getElementById('root')!).render(<App />);
