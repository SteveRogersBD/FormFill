import type { ReactNode } from 'react';

interface ProfileSectionProps {
  id: string;
  title: string;
  onEdit: () => void;
  children: ReactNode;
  disabled?: boolean;
}
