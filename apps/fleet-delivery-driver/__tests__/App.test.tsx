/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders passenger Driver signup in Debug when no session exists', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });
  const text = JSON.stringify(renderer!.toJSON());
  expect(text).toContain('BMS Driver');
  expect(text).not.toContain('BMS Ride');
  expect(text).toContain('Driver');
  expect(text).toContain('SANDBOX');
  expect(text).toContain('Test plate');
});
