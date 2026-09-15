export interface MockMember {
  id: string;
  memberNo: string;
  name: string;
  phone: string;
  tier: string;
  tierDiscountPct: number;
  points: number;
}

export interface MockCoupon {
  code: string;
  label: string;
  discountType: 'fixed' | 'percent';
  discountValue: number;
  minimumSubtotal: number;
  maximumDiscount?: number;
  memberOnly?: boolean;
}

export const mockMembers: MockMember[] = [
  {
    id: 'member-001',
    memberNo: 'M000123',
    name: 'สมใจ ใจดี',
    phone: '081-234-5678',
    tier: 'Gold',
    tierDiscountPct: 5,
    points: 1280,
  },
  {
    id: 'member-002',
    memberNo: 'M000456',
    name: 'สมหญิง ขยัน',
    phone: '089-555-0199',
    tier: 'Silver',
    tierDiscountPct: 2,
    points: 340,
  },
];

export const mockCoupons: MockCoupon[] = [
  {
    code: 'SAVE20',
    label: 'ลดทันที 20 บาท เมื่อครบ 100 บาท',
    discountType: 'fixed',
    discountValue: 20,
    minimumSubtotal: 100,
  },
  {
    code: 'MEMBER10',
    label: 'สมาชิกลดเพิ่ม 10% สูงสุด 50 บาท เมื่อครบ 300 บาท',
    discountType: 'percent',
    discountValue: 10,
    minimumSubtotal: 300,
    maximumDiscount: 50,
    memberOnly: true,
  },
];

export const MOCK_DISCOUNT_APPROVER_PIN = '9999';
