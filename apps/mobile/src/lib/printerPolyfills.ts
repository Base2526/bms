import { TextDecoder } from 'text-encoding';
import structuredClone from '@ungap/structured-clone';

// Hermes has no TextDecoder; PNG color-profile keywords require the Latin-1 decoder.
if (!('TextDecoder' in globalThis)) {
  Object.defineProperty(globalThis, 'TextDecoder', {
    value: TextDecoder,
    configurable: true,
    writable: true,
  });
}

if (!('structuredClone' in globalThis)) {
  Object.defineProperty(globalThis, 'structuredClone', {
    value: structuredClone,
    configurable: true,
    writable: true,
  });
}
