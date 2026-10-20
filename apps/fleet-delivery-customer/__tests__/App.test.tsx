import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders the synthetic Customer activation boundary when no secure session exists', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });
  const text = JSON.stringify(renderer!.toJSON());
  expect(text).toContain('BMS Delivery');
  expect(text).toContain('Production lock');
  expect(text).toContain('Access token');
});
