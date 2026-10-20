/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders the internal activation boundary when no session exists', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });
  const text = JSON.stringify(renderer!.toJSON());
  expect(text).toContain('BMS Delivery Driver');
  expect(text).toContain('Production lock');
});
