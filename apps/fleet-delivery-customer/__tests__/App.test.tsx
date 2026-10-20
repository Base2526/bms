import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders passenger signup in Debug when no secure session exists', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });
  const text = JSON.stringify(renderer!.toJSON());
  expect(text).toContain('BMS Go');
  expect(text).not.toContain('BMS Ride');
  expect(text).toContain('Passenger');
  expect(text).toContain('SANDBOX');
  expect(text).toContain('Username');
});
