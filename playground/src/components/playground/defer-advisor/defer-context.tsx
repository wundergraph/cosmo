import { createContext, ReactNode, useContext, useState } from 'react';
import { DeferStore } from './defer-store';

const DeferContext = createContext<DeferStore | null>(null);

// The store is created once per playground, so the analysis outlives the advisor tab and the pills stay in the editor.
export const DeferProvider = ({ children }: { children: ReactNode }) => {
  const [store] = useState(() => new DeferStore());
  return <DeferContext.Provider value={store}>{children}</DeferContext.Provider>;
};

export const useDefer = (): DeferStore => {
  const store = useContext(DeferContext);
  if (!store) {
    throw new Error('useDefer must be used inside a DeferProvider');
  }
  return store;
};
