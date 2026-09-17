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

// QR rendering is an SVG detail; the smoke test only verifies provider/navigation wiring.
jest.mock('react-native-qrcode-svg', () => 'QRCode');

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
