import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { RootNavigator } from '../src/navigation/RootNavigator';

let mockTarget: { token: string; serverUrl: string } | null = null;
let mockVerify = { kind: 'IDLE' };
const mockSignOut = jest.fn();
const mockMount = jest.fn();
let mockRootState: {
  index: number;
  routes: { name: string; key: string; params?: { t?: string } }[];
} = {
  index: 1,
  routes: [
    { name: 'Login', key: 'login-1' },
    { name: 'Settings', key: 'settings-1', params: { t: 'pending' } },
  ],
};
const mockResetRoot = jest.fn();
const mockNavigationRef = {
  isReady: () => true,
  getRootState: () => mockRootState,
  resetRoot: mockResetRoot,
};
jest.mock('../src/state/DeviceContext', () => ({
  useDevice: () => ({ target: mockTarget, verify: mockVerify }),
}));
jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({ signOut: mockSignOut }),
}));
jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({ scheme: 'light', colors: {} }),
}));
jest.mock('@react-navigation/native', () => ({
  DefaultTheme: { colors: {} },
  DarkTheme: { colors: {} },
  useNavigationContainerRef: () => mockNavigationRef,
  NavigationContainer: ({ children }: { children: React.ReactNode }) => {
    require('react').useEffect(() => {
      mockMount();
    }, []);
    return children;
  },
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: () => null,
  }),
}));
jest.mock('../src/screens/LoginScreen', () => () => null);
jest.mock('../src/screens/settings/DeviceSettingsScreen', () => () => null);
jest.mock('../src/screens/settings/PrinterSettingsScreen', () => () => null);
jest.mock('../src/navigation/AppNavigator', () => ({
  AppNavigator: () => null,
}));

test('rejected saved device keeps Settings visible with Login underneath and clears cashier', async () => {
  mockTarget = null;
  mockVerify = { kind: 'IDLE' };
  mockSignOut.mockClear();
  mockMount.mockClear();
  mockResetRoot.mockClear();
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(<RootNavigator />);
  });
  for (const kind of [
    'CHECKING',
    'REJECTED',
    'CHECKING',
    'SERVER_ERROR',
    'OFFLINE',
  ]) {
    mockVerify = { kind };
    await act(async () => tree.update(<RootNavigator />));
    expect(mockMount).toHaveBeenCalledTimes(1);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockResetRoot).not.toHaveBeenCalled();
  }
  mockTarget = { serverUrl: 'https://shop.example.test', token: 'FAKE' };
  mockVerify = { kind: 'OK' };
  await act(async () => tree.update(<RootNavigator />));
  expect(mockMount).toHaveBeenCalledTimes(1);
  mockVerify = { kind: 'REJECTED' };
  await act(async () => tree.update(<RootNavigator />));
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(mockResetRoot).toHaveBeenCalledWith({
    index: 1,
    routes: [
      { name: 'Login' },
      { name: 'Settings', key: 'settings-1', params: { t: 'pending' } },
    ],
  });
  await act(async () => tree.update(<RootNavigator />));
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(mockResetRoot).toHaveBeenCalledTimes(1);

  // The button changes REJECTED -> CHECKING -> REJECTED on every retry.
  // Neither transition may remount the navigation container or open Login.
  mockVerify = { kind: 'CHECKING' };
  await act(async () => tree.update(<RootNavigator />));
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockResetRoot).toHaveBeenCalledTimes(1);
  mockVerify = { kind: 'REJECTED' };
  await act(async () => tree.update(<RootNavigator />));
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockResetRoot).toHaveBeenCalledTimes(2);
  expect(mockResetRoot).toHaveBeenLastCalledWith({
    index: 1,
    routes: [
      { name: 'Login' },
      { name: 'Settings', key: 'settings-1', params: { t: 'pending' } },
    ],
  });

  mockRootState = { index: 1, routes: [
    { name: 'Login', key: 'login-2' }, { name: 'Main', key: 'main-2' },
  ] };
  mockVerify = { kind: 'CHECKING' };
  await act(async () => tree.update(<RootNavigator />));
  mockVerify = { kind: 'REJECTED' };
  await act(async () => tree.update(<RootNavigator />));
  expect(mockSignOut).toHaveBeenCalledTimes(3);
  expect(mockResetRoot).toHaveBeenLastCalledWith({
    index: 0,
    routes: [{ name: 'Login' }],
  });
  await act(async () => tree.unmount());
});
