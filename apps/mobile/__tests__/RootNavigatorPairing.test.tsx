import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { RootNavigator } from '../src/navigation/RootNavigator';

let mockTarget: { token: string; serverUrl: string } | null = null;
let mockVerify = { kind: 'IDLE' };
const mockSignOut = jest.fn();
const mockMount = jest.fn();
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

test('first-pair failure preserves Settings; only rejection of a saved device resets navigation and cashier', async () => {
  mockTarget = null;
  mockVerify = { kind: 'IDLE' };
  mockSignOut.mockClear();
  mockMount.mockClear();
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
  }
  mockTarget = { serverUrl: 'https://shop.example.test', token: 'FAKE' };
  mockVerify = { kind: 'OK' };
  await act(async () => tree.update(<RootNavigator />));
  expect(mockMount).toHaveBeenCalledTimes(1);
  mockVerify = { kind: 'REJECTED' };
  await act(async () => tree.update(<RootNavigator />));
  expect(mockMount).toHaveBeenCalledTimes(2);
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(<RootNavigator />));
  expect(mockMount).toHaveBeenCalledTimes(2);
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
