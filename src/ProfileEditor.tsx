import { useEffect, useId, useRef, type ReactNode, type FormEvent } from 'react';

interface ProfileEditorProps {
  title: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

export function ProfileEditor({ title, busy, error, onClose, onSave, children }: ProfileEditorProps) {
  const headingId = useId();
  const drawer = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawer.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  return <div className="profile-editor-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form ref={drawer} role="dialog" aria-modal="true" aria-labelledby={headingId} className="profile-editor" tabIndex={-1} onSubmit={onSave} onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]') ?? [])];
      const first = controls[0]; const last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === drawer.current)) { event.preventDefault(); first.focus(); }
    }}>
      <header className="profile-editor-header"><button type="button" className="drawer-close" aria-label="Close editor" disabled={busy} onClick={onClose}>›</button><h2 id={headingId}>{title}</h2><button type="submit" className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Update'}</button></header>
      <p className="editor-sync-note">Updates to your profile will be used for future application answers.</p>
      <div className="profile-editor-body">{error && <div className="notice error" role="alert">{error}</div>}<fieldset className="editor-fields" disabled={busy}>{children}</fieldset></div>
    </form>
  </div>;
}
