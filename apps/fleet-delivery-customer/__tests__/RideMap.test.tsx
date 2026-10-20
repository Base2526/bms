import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { RideMap } from '../../fleet-delivery-customer-core/native/RideMap';

const point = { label: 'Siam', lat: 13.7463, lng: 100.5347 };
const makeProps = (): React.ComponentProps<typeof RideMap> => ({
  environment: { rideSimulator: true, rideMapsConfigured: false },
  client: { location: jest.fn(async () => ({ ok: true })) } as any,
  snapshot: {
    account: { role: 'DRIVER', online: true },
    current: null,
    driverLocation: null,
  } as any,
  pickup: point,
  dropoff: point,
  selecting: null,
  onPick: jest.fn(),
  onError: jest.fn(),
  onConsent: jest.fn(),
});
const button = (r: Renderer.ReactTestRenderer, title: string) =>
  r.root.findAll(
    node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityLabel?.includes(title),
  )[0]!;
beforeEach(() => {
  jest.clearAllMocks();
});
test('no Google key: no map load, explicit missing config; physical device cannot start GPS', async () => {
  const props = makeProps();
  props.environment.rideSimulator = false;
  let r: Renderer.ReactTestRenderer;
  await act(async () => {
    r = Renderer.create(<RideMap {...props} />);
  });
  expect(button(r!, 'เปิด Google').props.disabled).toBe(true);
  expect(button(r!, 'ใช้ตำแหน่ง').props.disabled).toBe(true);
  await act(async () => {
    button(r!, 'ใช้ตำแหน่ง').props.onPress();
  });
  expect(Geolocation.requestAuthorization).not.toHaveBeenCalled();
  expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(props.client.location).not.toHaveBeenCalled();
  await act(async () => r!.unmount());
});
test('simulator position is opt-in, ephemeral and stops on background; no automatic resume', async () => {
  const props = makeProps();
  const old = AppState.currentState;
  AppState.currentState = 'active';
  let stateChanged: (state: string) => void = () => {};
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      stateChanged = callback as any;
      return { remove: jest.fn() };
    });
  (Geolocation.getCurrentPosition as jest.Mock).mockImplementation(success =>
    success({
      timestamp: Date.now(),
      coords: { latitude: point.lat, longitude: point.lng, accuracy: 10 },
    }),
  );
  let r: Renderer.ReactTestRenderer;
  try {
    await act(async () => {
      r = Renderer.create(<RideMap {...props} />);
    });
    expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
    await act(async () => {
      button(r!, 'ใช้ตำแหน่ง').props.onPress();
    });
    expect(props.client.location).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'SIMULATOR', lat: point.lat }),
    );
    await act(async () => stateChanged('background'));
    expect(props.client.location).toHaveBeenLastCalledWith(null);
    const reads = (Geolocation.getCurrentPosition as jest.Mock).mock.calls
      .length;
    await act(async () => stateChanged('active'));
    expect(
      (Geolocation.getCurrentPosition as jest.Mock).mock.calls.length,
    ).toBe(reads);
  } finally {
    await act(async () => r!.unmount());
    listener.mockRestore();
    AppState.currentState = old;
  }
});
test('offline driver cannot start position; provider consent required before map renders', async () => {
  const props = makeProps();
  props.snapshot.account.online = false;
  props.environment.rideMapsConfigured = true;
  let r: Renderer.ReactTestRenderer;
  await act(async () => {
    r = Renderer.create(<RideMap {...props} />);
  });
  expect(button(r!, 'ใช้ตำแหน่ง').props.disabled).toBe(true);
  expect(r!.root.findAllByType('MapView' as any)).toHaveLength(0);
  await act(async () => button(r!, 'เปิด Google').props.onPress());
  expect(props.onConsent).toHaveBeenCalledTimes(1);
  expect(r!.root.findAllByType('MapView' as any)).toHaveLength(1);
  await act(async () => r!.unmount());
});
test('pin mode keeps a fixed center pin and updates the selected point when the map moves', async () => {
  const props = makeProps();
  props.environment.rideMapsConfigured = true;
  props.snapshot.account.role = 'RIDER';
  props.snapshot.account.online = false;
  props.selecting = 'dropoff';
  const onBack = jest.fn();
  let r: Renderer.ReactTestRenderer;
  await act(async () => {
    r = Renderer.create(
      <RideMap {...props} initialConsent mode="pin" onBack={onBack} />,
    );
  });
  expect(
    r!.root.findAll(node => node.props.accessibilityLabel === 'หมุดกลางแผนที่'),
  ).not.toHaveLength(0);
  expect(button(r!, 'ใช้ตำแหน่ง')).toBeUndefined();
  const map = r!.root.findByType('MapView' as any);
  await act(async () => {
    map.props.onRegionChangeComplete({
      latitude: 13.7,
      longitude: 100.5,
    });
  });
  expect(props.onPick).toHaveBeenCalledWith({
    label: point.label,
    lat: 13.7,
    lng: 100.5,
  });
  await act(async () => button(r!, 'กลับไปหน้าเส้นทาง').props.onPress());
  expect(onBack).toHaveBeenCalledTimes(1);
  await act(async () => r!.unmount());
});
test('review mode draws the Google road polyline and exposes route editing', async () => {
  const props = makeProps();
  props.environment.rideMapsConfigured = true;
  props.snapshot.account.role = 'RIDER';
  props.snapshot.account.online = false;
  props.dropoff = { label: 'Asok', lat: 13.7372, lng: 100.5602 };
  const roadRoute = {
    provider: 'GOOGLE' as const,
    travelMode: 'TWO_WHEELER' as const,
    distanceM: 3000,
    durationSeconds: 540,
    encodedPolyline: 'ky{rA{trdRzw@k~C',
    warnings: [],
  };
  const onBack = jest.fn();
  let r: Renderer.ReactTestRenderer;
  await act(async () => {
    r = Renderer.create(
      <RideMap
        {...props}
        initialConsent
        mode="review"
        onBack={onBack}
        roadRoute={roadRoute}
      />,
    );
  });
  const line = r!.root.findByType('Polyline' as any);
  expect(line.props.coordinates).toEqual([
    { latitude: point.lat, longitude: point.lng },
    { latitude: 13.7372, longitude: 100.5602 },
  ]);
  expect(line.props.strokeColor).toBe('#087653');
  expect(button(r!, 'ใช้ตำแหน่ง')).toBeUndefined();
  await act(async () => button(r!, 'แก้ไขเส้นทาง').props.onPress());
  expect(onBack).toHaveBeenCalledTimes(1);
  await act(async () => r!.unmount());
});
