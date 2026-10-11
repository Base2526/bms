/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

// Native camera UI cannot exist in the Node smoke-test environment. Runtime
// wiring is covered by the iOS/Android native builds and the scanner contract.
jest.mock('react-native-data-scanner', () => ({
  DataScanner: {
    scanBarcode: jest.fn().mockRejectedValue(new Error('Scanner unavailable')),
  },
}));

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('react-native-tcp-socket', () => ({ Socket: jest.fn() }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));

// QR rendering is an SVG detail; the smoke test only verifies provider/navigation wiring.
jest.mock('react-native-qrcode-svg', () => 'QRCode');

test('renders correctly', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});
