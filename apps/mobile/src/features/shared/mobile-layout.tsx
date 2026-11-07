import { createContext, useContext, type PropsWithChildren } from 'react';

const CompactLayoutContext = createContext(false);

export function MobileLayoutProvider({
  compact,
  children,
}: PropsWithChildren<{ compact: boolean }>) {
  return <CompactLayoutContext.Provider value={compact}>{children}</CompactLayoutContext.Provider>;
}

export function useCompactLayout() {
  return useContext(CompactLayoutContext);
}
