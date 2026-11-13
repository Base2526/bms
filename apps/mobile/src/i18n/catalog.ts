import {
  createPosTranslator,
  type PosLanguage,
} from '../../../web/i18n/posClient';
let language: PosLanguage = 'th';
export const applyPosLanguage = (value: PosLanguage) => {
  language = value;
  emit();
};
const listeners = new Set<() => void>();
export const translators = {
  th: createPosTranslator('th'),
  en: createPosTranslator('en'),
};
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const emit = () => {
  for (const listener of listeners) listener();
};
export const getPosLanguage = () => language;
export const posLocale = () => (language === 'en' ? 'en-GB' : 'th-TH');
export const posText = (
  source: string,
  values?: Record<string, unknown>,
  selected: PosLanguage = language,
) => translators[selected](source, values);
