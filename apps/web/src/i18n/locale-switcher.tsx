import React from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';

export interface LocaleSwitcherProps {
  className?: string;
  dark?: boolean;
}

export function LocaleSwitcher({ className, dark }: LocaleSwitcherProps) {
  if (!className) {
    return <LanguageSwitcher dark={dark} />;
  }
  return (
    <div className={className}>
      <LanguageSwitcher dark={dark} />
    </div>
  );
}
