export * from '../../../../packages/pos-client-core/src/payment';
export * from '../../../../packages/pos-client-core/src/checkoutPayment';

import { paymentMethodLabel as coreLabel, validatePayments as coreValidate,
  type PosPaymentMethod, type PosPaymentInput } from '../../../../packages/pos-client-core/src/payment';
import { posText } from '../i18n/catalog';
export const paymentMethodLabel = (method: PosPaymentMethod) => coreLabel(method, posText);
export const validatePayments = (total: number, payments: PosPaymentInput[]) => coreValidate(total, payments, posText);
export const validateMockPayments = validatePayments;
