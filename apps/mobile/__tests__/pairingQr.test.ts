import {
  buildPairingQr,
  parsePairingQr,
} from '../../../packages/pos-client-core/src/pairingQr';

const token = `pos_${'a'.repeat(43)}`;
const target = { serverUrl: 'https://shop.example.test', token };
const qr = buildPairingQr(target)!;

test('Admin QR round trips into native pairing without a URL polyfill', () => {
  expect(parsePairingQr(qr)).toEqual(target);
  expect(
    parsePairingQr(
      buildPairingQr({
        ...target,
        serverUrl: 'https://SHOP.example.test:443/',
      })!,
    ),
  ).toEqual(target);
  expect(
    parsePairingQr(
      buildPairingQr({ ...target, serverUrl: 'https://192.168.1.2:8443' })!,
    ),
  ).toEqual({ ...target, serverUrl: 'https://192.168.1.2:8443' });
});

test.each(['\n', '\r', '\t', ' '])(
  'rejects escaped trailing whitespace in credentials/origins (%j)',
  suffix => {
    expect(buildPairingQr({ ...target, token: token + suffix })).toBeNull();
    expect(
      buildPairingQr({ ...target, serverUrl: target.serverUrl + suffix }),
    ).toBeNull();
    expect(
      parsePairingQr(
        `bmspos://pair?t=${encodeURIComponent(
          token + suffix,
        )}&h=${encodeURIComponent(target.serverUrl)}`,
      ),
    ).toBeNull();
    expect(
      parsePairingQr(
        `bmspos://pair?t=${token}&h=${encodeURIComponent(
          target.serverUrl + suffix,
        )}`,
      ),
    ).toBeNull();
  },
);

test('rejects a DNS name longer than 253 characters', () => {
  const serverUrl = `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(
    63,
  )}.${'d'.repeat(63)}.test`;
  expect(buildPairingQr({ ...target, serverUrl })).toBeNull();
});

test.each([
  'http://shop.example.test',
  'https://localhost',
  'https://a.localhost',
  'https://127.0.0.1',
  'https://0.0.0.0',
  'https://256.1.1.1',
  'https://0127.0.0.1',
  'https://[::1]',
  'https://user@shop.example.test',
  'https://shop.example.test/path',
  'https://shop.example.test?x=1',
  'https://shop.example.test:0',
  'https://shop.example.test:65536',
  'shop.example.test',
  'javascript:alert(1)', // eslint-disable-line no-script-url -- untrusted QR input must be rejected
])('rejects unsafe/incomplete origin %s on both sides', serverUrl => {
  expect(buildPairingQr({ serverUrl, token })).toBeNull();
  expect(
    parsePairingQr(
      `bmspos://pair?t=${token}&h=${encodeURIComponent(serverUrl)}`,
    ),
  ).toBeNull();
});

test.each([
  token,
  `https://shop.example.test/pos?t=${token}`,
  '1234567890',
  `bmspos://other?t=${token}&h=https%3A%2F%2Fshop.example.test`,
  `bmspos://pair?t=${token}`,
  qr + '&t=' + token,
  qr + '&h=https%3A%2F%2Fother.test',
  qr + '&unknown=true',
  qr + '#fragment',
  qr + '&%74=' + token,
  qr.replace('h=', 'h=%ZZ'),
  qr.replace(token, 'bad'),
  qr + 'a'.repeat(2048),
  qr.replace('pair?', 'pair/?'),
])('rejects non-pairing or ambiguous QR %#', value => {
  expect(parsePairingQr(value)).toBeNull();
});
