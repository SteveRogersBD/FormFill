import { useEffect, useId, useRef, type ReactNode, type FormEvent } from 'react';

interface ProfileEditorProps {
  title: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}
