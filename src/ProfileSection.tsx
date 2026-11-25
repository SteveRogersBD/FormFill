import type { ReactNode } from 'react';

interface ProfileSectionProps {
  id: string;
  title: string;
  onEdit: () => void;
  children: ReactNode;
  disabled?: boolean;
  heading?: ReactNode;
}

export function ProfileSection({ id, title, heading, onEdit, children, disabled }: ProfileSectionProps) {
  return <section className="profile-section" id={id} aria-labelledby={`${id}-heading`}>
    <div className="profile-section-heading"><h2 id={`${id}-heading`}>{heading ?? title}</h2><button type="button" className="edit-section-button" onClick={onEdit} disabled={disabled} aria-label={`Edit ${title}`}>✎</button></div>
    {children}
  </section>;
}
