import type { ReactNode } from 'react';

interface ProfileSectionProps {
  id: string;
  title: string;
  onEdit: () => void;
  children: ReactNode;
  disabled?: boolean;
}

export function ProfileSection({ id, title, onEdit, children, disabled }: ProfileSectionProps) {
  return <section className="profile-section" id={id} aria-labelledby={`${id}-heading`}>
    <div className="profile-section-heading"><h2 id={`${id}-heading`}>{title}</h2><button type="button" className="edit-section-button" onClick={onEdit} disabled={disabled} aria-label={`Edit ${title}`}>✎</button></div>
    {children}
  </section>;
}
