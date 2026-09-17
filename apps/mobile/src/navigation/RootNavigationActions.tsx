import { createContext, useContext } from 'react';

type RootNavigationActionsValue = {
  openSettings: () => void;
  resetToLogin: () => void;
};

const RootNavigationActionsContext =
  createContext<RootNavigationActionsValue | null>(null);

export const RootNavigationActionsProvider =
  RootNavigationActionsContext.Provider;

export function useRootNavigationActions(): RootNavigationActionsValue {
  const value = useContext(RootNavigationActionsContext);
  if (!value) {
    throw new Error(
      'useRootNavigationActions ต้องอยู่ใต้ <RootNavigationActionsProvider>',
    );
  }
  return value;
}
