import {
  displayHost,
  maskToken,
  normalizeServerUrl,
  parsePairingInput,
} from '../src/lib/pairing';

const TOKEN = `pos_${'a'.repeat(32)}`;

describe('pairing input', () => {
  test('reads the server and token from the existing web POS link', () => {
    expect(
      parsePairingInput(`https://shop.example.com/pos?t=${TOKEN}`),
    ).toEqual({
      ok: true,
      token: TOKEN,
      serverUrl: 'https://shop.example.com',
    });
  });

  test('reads an encoded server from the app deep link', () => {
    expect(
      parsePairingInput(
        `bmspos://pair?t=${TOKEN}&h=https%3A%2F%2Fshop.example.com`,
      ),
    ).toEqual({
      ok: true,
      token: TOKEN,
      serverUrl: 'https://shop.example.com',
    });
  });

  test('accepts a bare token but requires the server separately', () => {
    expect(parsePairingInput(TOKEN)).toEqual({
      ok: true,
      token: TOKEN,
      serverUrl: null,
    });
  });

  test('rejects malformed and truncated device tokens', () => {
    expect(parsePairingInput('pos_short')).toMatchObject({ ok: false });
    expect(parsePairingInput('https://shop.example.com/pos')).toMatchObject({
      ok: false,
    });
  });
});

describe('pairing display helpers', () => {
  test('normalizes host-only input to HTTPS and strips paths', () => {
    expect(normalizeServerUrl('shop.example.com/pos')).toBe(
      'https://shop.example.com',
    );
  });

  test('rejects cleartext remote servers and URL credentials', () => {
    expect(normalizeServerUrl('http://shop.example.com/pos')).toBeNull();
    expect(
      normalizeServerUrl('https://shop.example.com@evil.example/pos'),
    ).toBeNull();
    expect(normalizeServerUrl('http://localhost:3000/pos')).toBe(
      'http://localhost:3000',
    );
  });

  test('never returns the full token for display', () => {
    expect(maskToken(TOKEN)).toBe(`••••${TOKEN.slice(-6)}`);
    expect(maskToken(TOKEN)).not.toContain(TOKEN);
  });

  test('removes the scheme from a display host', () => {
    expect(displayHost('https://shop.example.com')).toBe('shop.example.com');
  });
});
