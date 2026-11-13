import React, { useState } from 'react';
import { Alert, Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import * as Keychain from 'react-native-keychain';
import { getPosLanguage, loadPosLanguage, setPosLanguage, usePosLanguage, posText } from '../src/i18n/language';
import { applyPosLanguage } from '../src/i18n/catalog';
import { LanguageSelector } from '../src/components/LanguageSelector';
import { ThemeProvider } from '../src/theme/ThemeProvider';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn(), setGenericPassword: jest.fn().mockResolvedValue(true),
}));

beforeEach(() => { applyPosLanguage('th'); jest.clearAllMocks(); });

test('late saved preference cannot overwrite a newer operator selection', async () => {
  let resolve!: (value: unknown) => void;
  (Keychain.getGenericPassword as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
  const loading = loadPosLanguage();
  await Promise.resolve();
  await setPosLanguage('en');
  resolve({ username: 'language', password: 'th' });
  await loading;
  expect(getPosLanguage()).toBe('en');
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith('language', 'en', expect.objectContaining({ service: 'com.bms.pos.language.v1' }));
});

test('language changes update visible controls without remounting or clearing input', async () => {
  function Register() {
    usePosLanguage();
    const [draft, setDraft] = useState('');
    return <><LanguageSelector /><Text>{posText('ยืนยันการขาย')}</Text>
      <TextInput value={draft} onChangeText={setDraft} /></>;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ThemeProvider><Register /></ThemeProvider>); });
  act(() => tree.root.findByType(TextInput).props.onChangeText('FAKE cart draft'));
  await act(async () => { await setPosLanguage('en'); });
  expect(tree.root.findAllByType(Text).some(node => node.props.children === 'Confirm sale')).toBe(true);
  expect(tree.root.findByType(TextInput).props.value).toBe('FAKE cart draft');
  await act(async () => { await setPosLanguage('th'); });
  expect(tree.root.findAllByType(Text).some(node => node.props.children === 'ยืนยันการขาย')).toBe(true);
  expect(tree.root.findByType(TextInput).props.value).toBe('FAKE cart draft');
  act(() => tree.unmount());
});

test('failed preference storage keeps the chosen language for this session and future writes recover', async () => {
  (Keychain.setGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('locked'));
  await expect(setPosLanguage('en')).rejects.toThrow('locked');
  expect(getPosLanguage()).toBe('en');
  await setPosLanguage('th');
  expect(getPosLanguage()).toBe('th');
});

test('an older failed save cannot show a stale alert after a newer selection', async () => {
  let rejectFirst!: (error: Error) => void;
  (Keychain.setGenericPassword as jest.Mock).mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
  const alert = jest.spyOn(Alert, 'alert');
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ThemeProvider><LanguageSelector /></ThemeProvider>); });
  await act(async () => { tree.root.findAll(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel === 'English' && typeof node.props.onPress === 'function')[0].props.onPress(); });
  await act(async () => { tree.root.findAll(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel === 'ภาษาไทย' && typeof node.props.onPress === 'function')[0].props.onPress(); });
  await act(async () => { rejectFirst(new Error('locked')); });
  expect(getPosLanguage()).toBe('th');
  expect(alert).not.toHaveBeenCalled();
  act(() => tree.unmount());
  alert.mockRestore();
});
