/* global jest */

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => ({ service: 'mock' })),
  resetGenericPassword: jest.fn(async () => true),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(View, null, children),
    SafeAreaView: ({ children, ...props }) => React.createElement(View, props, children),
  };
});
