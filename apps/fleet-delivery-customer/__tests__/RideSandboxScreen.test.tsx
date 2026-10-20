import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Alert, ScrollView, TextInput } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import * as Keychain from 'react-native-keychain';
import { RideSandboxScreen } from '../../fleet-delivery-customer-core/native/RideSandboxScreen';

const baseTrip = {
  id: '00000000-0000-4000-8000-000000000010',
  state: 'SEARCHING',
  version: 1,
  pickup: { label: 'Siam', lat: 13.7463, lng: 100.5347 },
  dropoff: { label: 'Asok', lat: 13.7372, lng: 100.5602 },
  fareSatang: 4400,
  distanceM: 3000,
  riderName: 'Test Rider',
  driverName: null,
  vehiclePlate: null,
  paymentStatus: 'UNPAID',
  receiptRef: null,
  createdAt: '2026-10-18T00:00:00Z',
};
const account = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'RIDER',
  displayName: 'Test Rider',
  online: false,
  vehiclePlate: '',
};
const session = {
  accountId: account.id,
  apiBaseUrl: 'http://127.0.0.1:4200',
  accessToken: 'a'.repeat(64),
  role: 'RIDER',
  expiresAt: '2099-01-01T00:00:00Z',
};
const press = async (
  renderer: ReactTestRenderer.ReactTestRenderer,
  title: string,
) => {
  const target = renderer.root.findAll(
    p =>
      typeof p.props.onPress === 'function' &&
      p.props.accessibilityLabel?.includes(title),
  )[0];
  expect(target).toBeDefined();
  expect(target!.props.disabled).not.toBe(true);
  await act(async () => {
    target!.props.onPress();
  });
};
beforeEach(() => {
  jest.clearAllMocks();
  (Geolocation.getCurrentPosition as jest.Mock).mockImplementation(success =>
    success({
      timestamp: Date.now(),
      coords: {
        latitude: 13.7463,
        longitude: 100.5347,
        accuracy: 10,
      },
    }),
  );
});
test('passenger recovers current trip, confirms sandbox payment, sees persisted receipt; no new booking while active', async () => {
  const original = globalThis.fetch;
  let trip = {
    ...baseTrip,
    state: 'AWAITING_PAYMENT',
    version: 5,
    driverName: 'Driver',
    vehiclePlate: 'TEST-001',
  };
  let complete = false;
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
    password: JSON.stringify({ session, pending: null }),
  });
  const calls: string[] = [];
  globalThis.fetch = jest.fn(async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('/snapshot'))
      return {
        ok: true,
        json: async () => ({
          sandbox: true,
          account,
          current: complete ? null : trip,
          offers: [],
          history: complete ? [trip] : [],
          earningsSatang: 0,
        }),
      } as Response;
    const body = JSON.parse(String(init?.body));
    expect(body.action).toBe('pay');
    expect(body.confirmed).toBe(true);
    expect(body.paymentOutcome).toBe('SUCCEEDED');
    complete = true;
    trip = {
      ...trip,
      state: 'COMPLETED',
      version: 6,
      paymentStatus: 'SUCCEEDED',
      receiptRef: 'sandbox:receipt-test' as any,
    };
    return { ok: true, json: async () => trip } as Response;
  }) as typeof fetch;
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    buttons?.find(b => b.text === 'ยืนยัน')?.onPress?.();
  });
  let renderer: ReactTestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <RideSandboxScreen role="RIDER" onExit={() => {}} />,
      );
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('รอชำระเงิน');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(
      'ดูราคามอเตอร์ไซค์',
    );
    await press(renderer!, 'จ่าย sandbox');
    expect(JSON.stringify(renderer!.toJSON())).toContain('เที่ยวล่าสุดสำเร็จ');
    await press(renderer!, 'ประวัติ');
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      'sandbox:receipt-test',
    );
    expect(calls.filter(v => v.includes('/trips/'))).toHaveLength(1);
    expect(Keychain.setGenericPassword).toHaveBeenCalled();
  } finally {
    await act(async () => renderer!.unmount());
    globalThis.fetch = original;
    jest.restoreAllMocks();
  }
});
test('signup form submits rider role and test consent; no bearer activation needed', async () => {
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = jest.fn(async (url, init) => {
    if (String(url).endsWith('/register')) {
      bodies.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => session } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        sandbox: true,
        account,
        current: null,
        offers: [],
        history: [],
        earningsSatang: 0,
      }),
    } as Response;
  }) as typeof fetch;
  let renderer: ReactTestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <RideSandboxScreen role="RIDER" onExit={() => {}} />,
      );
    });
    const fields = renderer!.root.findAllByType(TextInput);
    await act(async () => {
      fields
        .find(f => f.props.accessibilityLabel.startsWith('Username'))!
        .props.onChangeText('rider.test');
      fields
        .find(f => f.props.accessibilityLabel.startsWith('Password'))!
        .props.onChangeText('sandbox-pass');
      fields
        .find(f => f.props.accessibilityLabel.startsWith('ชื่อแสดง'))!
        .props.onChangeText('Test Rider');
    });
    await press(renderer!, 'ยืนยันสมัครบัญชีทดสอบ');
    expect(bodies[0]).toMatchObject({
      role: 'RIDER',
      sandboxConsent: true,
      username: 'rider.test',
    });
    const home = JSON.stringify(renderer!.toJSON());
    expect(home).toContain('ไปเที่ยวกัน');
    expect(home).toContain('Rides');
    expect(home).toContain('Schedule');
    expect(home).toContain('Motorbike');
    expect(home).toContain('Go Send');
    expect(home).toContain('รถยนต์รับส่ง · เร็ว ๆ นี้');
    expect(home).toContain('จองล่วงหน้า · เร็ว ๆ นี้');
  } finally {
    await act(async () => renderer!.unmount());
    globalThis.fetch = original;
  }
});
test('home exposes active Motorbike and Go Send without pretending future services work', async () => {
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
    password: JSON.stringify({ session, pending: null }),
  });
  const original = globalThis.fetch;
  globalThis.fetch = jest.fn(
    async () =>
      ({
        ok: true,
        json: async () => ({
          sandbox: true,
          account,
          current: null,
          offers: [],
          history: [],
          earningsSatang: 0,
        }),
      } as Response),
  ) as typeof fetch;
  const onExit = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <RideSandboxScreen role="RIDER" onExit={onExit} />,
      );
    });
    const disabledCards = renderer!.root.findAll(
      p =>
        p.props.accessibilityLabel === 'Rides เร็ว ๆ นี้' ||
        p.props.accessibilityLabel === 'Schedule เร็ว ๆ นี้',
    );
    expect(
      new Set(disabledCards.map(card => card.props.accessibilityLabel)),
    ).toEqual(new Set(['Rides เร็ว ๆ นี้', 'Schedule เร็ว ๆ นี้']));
    expect(
      ['Rides เร็ว ๆ นี้', 'Schedule เร็ว ๆ นี้'].every(label =>
        disabledCards.some(
          card =>
            card.props.accessibilityLabel === label &&
            card.props.disabled === true,
        ),
      ),
    ).toBe(true);
    await press(renderer!, 'เลือก Motorbike');
    expect(JSON.stringify(renderer!.toJSON())).toContain('เส้นทาง');
    await press(renderer!, 'ปิดหน้าเส้นทาง');
    await press(renderer!, 'เปิด Go Send');
    expect(onExit).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => renderer!.unmount());
    globalThis.fetch = original;
  }
});
test('passenger follows home, route, pin confirmation and ride option screens', async () => {
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
    password: JSON.stringify({ session, pending: null }),
  });
  const original = globalThis.fetch;
  globalThis.fetch = jest.fn(async url => {
    const path = String(url);
    if (path.endsWith('/quotes'))
      return {
        ok: true,
        json: async () => ({
          id: '00000000-0000-4000-8000-000000000020',
          pickup: { label: 'Siam', lat: 13.7463, lng: 100.5347 },
          dropoff: { label: 'Asok', lat: 13.7372, lng: 100.5602 },
          distanceM: 3000,
          fareSatang: 4400,
          expiresAt: '2099-01-01T00:00:00Z',
          pricing: 'SANDBOX_GOOGLE_ROAD_V1',
          route: {
            provider: 'GOOGLE',
            travelMode: 'TWO_WHEELER',
            distanceM: 3000,
            durationSeconds: 540,
            encodedPolyline: 'ky{rA{trdRzw@k~C',
            warnings: [],
          },
        }),
      } as Response;
    if (path.endsWith('/nearby'))
      return {
        ok: true,
        json: async () => ({
          count: 2,
          radiusM: 5000,
          nearestDistanceM: 850,
          assessedDriverCount: 2,
          pickupEtaSeconds: 240,
          pickupRoadDistanceM: 1200,
          pickupEtaStatus: 'AVAILABLE',
          etaProvider: 'GOOGLE',
        }),
      } as Response;
    return {
      ok: true,
      json: async () => ({
        sandbox: true,
        account,
        current: null,
        offers: [],
        history: [],
        earningsSatang: 0,
      }),
    } as Response;
  }) as typeof fetch;
  let renderer: ReactTestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <RideSandboxScreen
          role="RIDER"
          onExit={() => {}}
          environment={{
            rideMapsConfigured: true,
            rideSimulator: true,
            rideMotorbikeArtwork: { uri: 'test://motorbike-service' },
          }}
        />,
      );
    });
    await press(renderer!, 'ไปที่ไหน');
    const routeOutput = JSON.stringify(renderer!.toJSON());
    expect(routeOutput).toContain('เส้นทาง');
    expect(routeOutput).not.toContain('SANDBOX · บัญชีทดสอบ');
    expect(routeOutput).not.toContain('polling ทุก 3 วินาที');
    expect(routeOutput).toContain('ตำแหน่งปัจจุบัน');
    expect(routeOutput).toContain('ไปที่ไหน?');
    expect(routeOutput).toContain('ค้นหาจุดส่ง');
    expect(Geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(routeOutput).toContain('ปิดหน้าเส้นทาง');
    await press(renderer!, 'ล้างจุดรับ');
    const clearedPickup = JSON.stringify(renderer!.toJSON());
    expect(clearedPickup).toContain('จุดรับ');
    expect(clearedPickup).toContain('ใช้ตำแหน่งปัจจุบัน');
    await press(renderer!, 'สยามพารากอน');
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      'ลากแผนที่หรือแก้ไขที่อยู่',
    );
    await press(renderer!, 'เปิด Google Maps');
    await press(renderer!, 'ยืนยัน');
    expect(JSON.stringify(renderer!.toJSON())).toContain('ค้นหาจุดส่ง');
    await press(renderer!, 'อโศก · Asok');
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      'ลากแผนที่หรือแก้ไขที่อยู่',
    );
    await press(renderer!, 'ยืนยัน');
    const output = JSON.stringify(renderer!.toJSON());
    expect(output).toContain('เลือกรถและราคา');
    expect(output).toContain('เส้นทาง Google Routes');
    expect(output).toContain('Sandbox payment');
    expect(output).toContain('แนะนำ');
    expect(output).toContain('เร็วกว่า');
    expect(output).toContain('ถูกกว่า');
    expect(output).toContain('พร้อมรับงาน 2 คน');
    expect(output).toContain('รับภายในประมาณ');
    expect(output).toContain('นาที · Google Routes');
    expect(output).toContain('ภาพประเภทบริการ');
    expect(output).toContain('เลือก Motorbike');
    expect(output).toContain('ปรับความสูงแผงเลือกรถ');
    expect(output).toContain('รายละเอียดรถและราคา');
    expect(output).toContain('การชำระเงินและยืนยันบริการ');
    const dragHandle = renderer!.root.findAll(
      node => node.props.accessibilityLabel === 'ปรับความสูงแผงเลือกรถ',
    )[0];
    expect(dragHandle).toBeDefined();
    expect(dragHandle!.props.onPress).toBeUndefined();
    expect(dragHandle!.props.onStartShouldSetResponder()).toBe(true);
    const reviewScrollViews = renderer!.root.findAllByType(ScrollView);
    expect(
      reviewScrollViews.some(view => view.props.scrollEnabled === false),
    ).toBe(true);
    expect(
      reviewScrollViews.some(
        view => view.props.accessibilityLabel === 'รายละเอียดรถและราคา',
      ),
    ).toBe(true);
    await press(renderer!, 'เรียงแบบเร็วกว่า');
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      'ETA คนขับถึงจุดรับบนถนนจริง',
    );
    await press(renderer!, 'เรียงแบบถูกกว่า');
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      'ยอดที่ต้องจ่ายจริง ฿44.00',
    );
  } finally {
    await act(async () => renderer!.unmount());
    globalThis.fetch = original;
  }
});
test('retrying a pending quote returns directly to the route and price review', async () => {
  const quote = {
    id: '00000000-0000-4000-8000-000000000020',
    pickup: { label: 'Siam', lat: 13.7463, lng: 100.5347 },
    dropoff: { label: 'Asok', lat: 13.7372, lng: 100.5602 },
    distanceM: 3000,
    fareSatang: 4400,
    expiresAt: '2099-01-01T00:00:00Z',
    pricing: 'SANDBOX_GOOGLE_ROAD_V1',
    route: {
      provider: 'GOOGLE',
      travelMode: 'TWO_WHEELER',
      distanceM: 3000,
      durationSeconds: 540,
      encodedPolyline: 'ky{rA{trdRzw@k~C',
      warnings: [],
    },
  };
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
    password: JSON.stringify({
      session,
      pending: {
        key: 'ride:pending-quote',
        operation: 'quotes',
        body: {
          pickup: quote.pickup,
          dropoff: quote.dropoff,
          providerConsent: true,
        },
      },
    }),
  });
  const original = globalThis.fetch;
  globalThis.fetch = jest.fn(async url => {
    if (String(url).endsWith('/quotes'))
      return { ok: true, json: async () => quote } as Response;
    return {
      ok: true,
      json: async () => ({
        sandbox: true,
        account,
        current: null,
        offers: [],
        history: [],
        earningsSatang: 0,
      }),
    } as Response;
  }) as typeof fetch;
  let renderer: ReactTestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <RideSandboxScreen
          role="RIDER"
          onExit={() => {}}
          environment={{ rideMapsConfigured: true, rideSimulator: true }}
        />,
      );
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('มีคำสั่งค้าง: ');
    expect(JSON.stringify(renderer!.toJSON())).toContain('quotes');
    await press(renderer!, 'ลองส่งคำสั่งเดิมอีกครั้ง');
    const output = JSON.stringify(renderer!.toJSON());
    expect(output).toContain('เลือกรถและราคา');
    expect(output).toContain('เส้นทาง Google Routes');
    expect(output).not.toContain('มีคำสั่งค้าง: quotes');
  } finally {
    await act(async () => renderer!.unmount());
    globalThis.fetch = original;
  }
});
test('Release renders locked without reading Keychain or exposing signup', async () => {
  const original = __DEV__;
  (globalThis as any).__DEV__ = false;
  let renderer: ReactTestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <RideSandboxScreen role="RIDER" onExit={() => {}} />,
      );
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('locked in Release');
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  } finally {
    await act(async () => renderer!.unmount());
    (globalThis as any).__DEV__ = original;
  }
});
