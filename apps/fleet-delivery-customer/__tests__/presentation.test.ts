import { customerStageLabel, parsePackageWeight } from '../src/screens/DeliverySearchScreen';

test('package weight input is finite and bounded for the synthetic motorcycle flow', () => {
  expect(parsePackageWeight('12.5')).toBe(12.5);
  expect(() => parsePackageWeight('')).toThrow('PACKAGE_WEIGHT');
  expect(() => parsePackageWeight('0')).toThrow('PACKAGE_WEIGHT');
  expect(() => parsePackageWeight('51')).toThrow('PACKAGE_WEIGHT');
});

test('customer tracking stage is presented without driver identity or location', () => {
  expect(customerStageLabel('PAYMENT_REQUIRED')).toBe('รอยืนยันการชำระเงิน');
  expect(customerStageLabel('SEARCHING')).toBe('กำลังค้นหารถ');
  expect(customerStageLabel('DRIVER_ASSIGNED')).toBe('จับคู่รถสำเร็จ');
  expect(customerStageLabel('RETURN_RESOLVED')).toBe('ดำเนินการคืนสินค้าเสร็จสมบูรณ์');
});
