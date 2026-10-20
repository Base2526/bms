import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Image,
  PanResponder,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Geolocation, {
  type GeolocationResponse,
} from "@react-native-community/geolocation";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Keychain from "react-native-keychain";
import { z } from "zod";
import {
  RIDE_TEST_PLACES,
  rideSessionSchema,
  ridePointSchema,
  type RidePoint,
  type RideQuote,
  type RideSession,
  type RideSnapshot,
  type RideView,
} from "@bms/fleet-delivery-contracts";
import {
  pendingRideCommandSchema,
  RideRequestError,
  RideSandboxClient,
  rideRequest,
  type PendingRideCommand,
} from "../src/rideSandbox";
import { RideMap, type RideNativeEnvironment } from "./RideMap";

type Props = {
  role: "RIDER" | "DRIVER";
  onExit: () => void;
  environment?: RideNativeEnvironment;
};
const savedSchema = z.object({
  session: rideSessionSchema,
  pending: pendingRideCommandSchema.nullable(),
});
type Saved = z.infer<typeof savedSchema>;
const stateLabels: Record<string, string> = {
  SEARCHING: "กำลังหาคนขับ",
  ACCEPTED: "คนขับกำลังไปรับ",
  AT_PICKUP: "คนขับถึงจุดรับแล้ว",
  IN_PROGRESS: "กำลังเดินทาง",
  AWAITING_PAYMENT: "ถึงปลายทาง · รอชำระเงิน",
  COMPLETED: "เดินทางสำเร็จ",
  CANCELLED: "ยกเลิกแล้ว",
};
const money = (satang: number) => `฿${(satang / 100).toFixed(2)}`;
const straightLineKm = (a: RidePoint, b: RidePoint) => {
  const radians = (value: number) => (value * Math.PI) / 180;
  const lat = radians(b.lat - a.lat);
  const lng = radians(b.lng - a.lng);
  const x =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(lng / 2) ** 2;
  return (6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))).toFixed(1);
};
const distanceLabel = (a: RidePoint, b: RidePoint) => {
  const km = Number(straightLineKm(a, b));
  return km < 1 ? "<1 กม." : `${km.toFixed(1)} กม.`;
};
const messages: Record<string, string> = {
  INVALID_LOGIN: "ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง",
  ACCOUNT_EXISTS_LOGIN: "บัญชีนี้มีแล้ว กรุณาเข้าสู่ระบบ",
  INVALID_CREDENTIAL_FORMAT:
    "ชื่อบัญชีภาษาอังกฤษ 3–20 ตัว และรหัสผ่าน 8–72 ไบต์",
  SESSION_EXPIRED: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่",
  DRIVER_OFFLINE: "เปิดรับงานก่อนครับ",
  OFFER_UNAVAILABLE: "งานนี้มีคนรับหรือถูกยกเลิกแล้ว",
  STALE_TRIP_REFRESH: "สถานะเปลี่ยนแล้ว กำลังโหลดข้อมูลล่าสุด",
  QUOTE_EXPIRED_OR_NOT_FOUND: "ราคาหมดอายุ กรุณาคำนวณใหม่",
  RETRY_PENDING_COMMAND_FIRST: "กรุณาลองส่งคำสั่งค้างอีกครั้งก่อน",
  SANDBOX_DISTANCE_100M_TO_50KM: "เลือกจุดรับ–ส่งห่างกัน 100 เมตร ถึง 50 กม.",
  VALIDATION_FAILED: "ตรวจสอบข้อมูลที่กรอกอีกครั้ง",
  RATE_LIMIT_UNAVAILABLE: "ระบบจำกัดคำขอยังไม่พร้อม กรุณาลองใหม่",
  GOOGLE_PLACES_NOT_CONFIGURED:
    "ยังไม่ได้ตั้งค่า Google Places key ฝั่ง sandbox server",
  GOOGLE_PLACES_UNAVAILABLE:
    "Google Places ไม่พร้อมใช้งาน กรุณาลองใหม่ ไม่ใช้ข้อมูลตัวอย่างแทนผลค้นหา",
  GOOGLE_ROUTES_NOT_CONFIGURED:
    "ยังไม่ได้ตั้งค่า Google Routes API key ฝั่ง sandbox server",
  GOOGLE_ROUTES_UNAVAILABLE:
    "Google Routes ไม่พบเส้นทางนี้ กรุณาเลือกจุดรับ–ส่งใหม่ ระบบจะไม่วาดเส้นตรงแทนเส้นทางถนน",
  SANDBOX_ROAD_DISTANCE_100M_TO_50KM:
    "เส้นทางถนนต้องมีระยะ 100 เมตร ถึง 50 กม.",
  FRESH_NEARBY_LOCATION_REQUIRED:
    "ต้องมีตำแหน่งใหม่และอยู่ภายใน 5 กม. จากจุดรับ",
  LOCATION_STALE_OR_FUTURE:
    "ตำแหน่งเก่าหรือเวลาเครื่องผิด กรุณาอ่านตำแหน่งใหม่",
  LOCATION_OUT_OF_ORDER: "ตำแหน่งนี้เคยส่งแล้ว รอ OS อัปเดตตำแหน่งใหม่",
  LOCATION_ACCURACY_REQUIRED:
    "ตำแหน่งคลาดเคลื่อนเกิน 100 เมตร กรุณาลองอ่านตำแหน่งใหม่",
  LOCATION_OUTSIDE_TEST_AREA: "ตำแหน่งอยู่นอกพื้นที่ทดสอบกรุงเทพฯ และปริมณฑล",
  LOCATION_SIMULATOR_ONLY: "ตำแหน่งเครื่องจริงยังปิด รอ Privacy/Legal approval",
  LOCATION_PERMISSION_REQUIRED:
    "ไม่ได้รับสิทธิ์ตำแหน่ง กรุณาเลือกจุดรับจากรายการหรือแผนที่",
  LOCATION_TIMEOUT:
    "อ่านตำแหน่งไม่สำเร็จภายในเวลาที่กำหนด กรุณาลองอีกครั้งหรือเลือกจุดรับเอง",
};
function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, secondary && s.dark]}>{title}</Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChangeText,
  secret = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secret?: boolean;
  disabled?: boolean;
}) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}
function TripCard({ trip }: { trip: RideView }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{stateLabels[trip.state]}</Text>
      <Text style={s.text}>● {trip.pickup.label}</Text>
      <Text style={s.text}>↓ {trip.dropoff.label}</Text>
      <Text style={s.fare}>{money(trip.fareSatang)}</Text>
      <Text style={s.muted}>ผู้โดยสาร: {trip.riderName}</Text>
      {trip.driverName && (
        <Text style={s.text}>
          คนขับ: {trip.driverName} · {trip.vehiclePlate}
        </Text>
      )}
      <Text style={s.muted}>
        Trip {trip.id.slice(0, 8)} · v{trip.version}
      </Text>
      {trip.paymentStatus === "DECLINED" && (
        <Text style={s.error}>จ่ายจำลองไม่สำเร็จ — ลองใหม่ได้</Text>
      )}
      {trip.receiptRef && (
        <Text selectable style={s.muted}>
          ใบรับเงินทดสอบ {trip.receiptRef}
        </Text>
      )}
    </View>
  );
}

export function RideSandboxScreen(props: Props) {
  // Release never mounts the sandbox, reads its Keychain, registers or transmits credentials.
  if (!__DEV__)
    return (
      <SafeAreaView>
        <Text>Passenger sandbox locked in Release</Text>
      </SafeAreaView>
    );
  return <RideSandboxContent {...props} />;
}
function RideSandboxContent({ role, onExit, environment = {} }: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const appName = role === "RIDER" ? "BMS Go" : "BMS Driver";
  const roleName = role === "RIDER" ? "Passenger" : "Driver";
  const service = `com.bms.ride-sandbox.${role.toLowerCase()}.debug.v1`;
  const saved = useRef<Saved | null>(null);
  const client = useRef<RideSandboxClient | null>(null);
  const mutation = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<RideSession | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [snapshot, setSnapshot] = useState<RideSnapshot | null>(null);
  const [pending, setPending] = useState<PendingRideCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [register, setRegister] = useState(true);
  const [origin, setOrigin] = useState("http://127.0.0.1:4200");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [tab, setTab] = useState<"home" | "activity" | "account">("home");
  const [riderStep, setRiderStep] = useState<
    "home" | "route" | "pin" | "review"
  >("home");
  const [pickup, setPickup] = useState<RidePoint>(RIDE_TEST_PLACES[0]!);
  const [pickupChosen, setPickupChosen] = useState(false);
  const [dropoff, setDropoff] = useState<RidePoint>(RIDE_TEST_PLACES[2]!);
  const [dropoffChosen, setDropoffChosen] = useState(false);
  const [search, setSearch] = useState("");
  const [selecting, setSelecting] = useState<"pickup" | "dropoff" | null>(null);
  const [places, setPlaces] = useState<RidePoint[]>([]);
  const [mapConsent, setMapConsent] = useState(false);
  const [searched, setSearched] = useState(false);
  const [nearby, setNearby] = useState<{
    count: number;
    radiusM: 5000;
    nearestDistanceM: number | null;
    assessedDriverCount: number;
    pickupEtaSeconds: number | null;
    pickupRoadDistanceM: number | null;
    pickupEtaStatus: "AVAILABLE" | "NO_DRIVER" | "PROVIDER_UNAVAILABLE";
    etaProvider: "GOOGLE" | null;
  } | null>(null);
  const [optionSort, setOptionSort] = useState<
    "RECOMMENDED" | "FASTER" | "CHEAPER"
  >("RECOMMENDED");
  const [quote, setQuote] = useState<RideQuote | null>(null);
  const [lastRefresh, setLastRefresh] = useState("");
  const reviewSheetHeight = useRef(new Animated.Value(500)).current;
  const reviewSheetHeightValue = useRef(500);
  const reviewSheetDragStart = useRef(500);
  const reviewSheetInitialized = useRef(false);
  const reviewSheetSnapPoints = useRef({ min: 350, half: 500, max: 650 });
  const animateReviewSheet = (height: number) => {
    reviewSheetHeightValue.current = height;
    Animated.spring(reviewSheetHeight, {
      toValue: height,
      useNativeDriver: false,
      speed: 24,
      bounciness: 2,
    }).start();
  };
  const reviewSheetPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        reviewSheetHeight.stopAnimation((height) => {
          reviewSheetDragStart.current = height;
          reviewSheetHeightValue.current = height;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const points = reviewSheetSnapPoints.current;
        const next = Math.max(
          points.min,
          Math.min(points.max, reviewSheetDragStart.current - gesture.dy)
        );
        reviewSheetHeightValue.current = next;
        reviewSheetHeight.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const points = reviewSheetSnapPoints.current;
        const projected = reviewSheetHeightValue.current - gesture.vy * 70;
        const target = [points.min, points.half, points.max].reduce(
          (nearest, point) =>
            Math.abs(point - projected) < Math.abs(nearest - projected)
              ? point
              : nearest,
          points.half
        );
        animateReviewSheet(target);
      },
      onPanResponderTerminate: () => {
        const points = reviewSheetSnapPoints.current;
        animateReviewSheet(
          Math.max(
            points.min,
            Math.min(points.max, reviewSheetHeightValue.current)
          )
        );
      },
    })
  ).current;
  useEffect(() => {
    const min = Math.min(360, Math.max(320, windowHeight * 0.44));
    const max = Math.max(min, windowHeight - 118);
    const half = Math.min(max, Math.max(min, windowHeight * 0.62));
    reviewSheetSnapPoints.current = { min, half, max };
    if (!reviewSheetInitialized.current) {
      reviewSheetInitialized.current = true;
      reviewSheetHeightValue.current = half;
      reviewSheetHeight.setValue(half);
      return;
    }
    const clamped = Math.max(
      min,
      Math.min(max, reviewSheetHeightValue.current)
    );
    reviewSheetHeightValue.current = clamped;
    reviewSheetHeight.setValue(clamped);
  }, [reviewSheetHeight, windowHeight]);
  const sessionExpired =
    !!session && Date.parse(session.expiresAt) <= Date.now();
  const riderBooking =
    role === "RIDER" &&
    !!session &&
    !sessionExpired &&
    !authFailed &&
    tab === "home" &&
    !snapshot?.current;
  const showAppHeader = !riderBooking || riderStep === "home";
  const showSandboxDetails =
    !session || sessionExpired || authFailed || role === "DRIVER";
  const report = (e: unknown) => {
    const code = e instanceof Error ? e.message : String(e);
    setError(messages[code] ?? `เชื่อมต่อไม่สำเร็จ / ${code}`);
    if (e instanceof RideRequestError && e.status === 401) {
      setSnapshot(null);
      setAuthFailed(true);
      setRegister(false);
    }
  };
  async function persist(value: Saved) {
    const ok = await Keychain.setGenericPassword(
      "ride-sandbox",
      JSON.stringify(value),
      {
        service,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }
    );
    if (!ok) throw new Error("SECURE_STORAGE_UNAVAILABLE");
    saved.current = value;
    setPending(value.pending);
  }
  function connect(value: Saved) {
    saved.current = value;
    setSession(value.session);
    setOrigin(value.session.apiBaseUrl);
    setPending(value.pending);
    setAuthFailed(false);
    client.current = new RideSandboxClient(value.session, {
      load: async () => saved.current?.pending ?? null,
      save: async (command) => {
        await persist({ session: value.session, pending: command });
      },
    });
  }
  async function refresh() {
    const active = client.current;
    if (!active) return;
    const result = await active.snapshot();
    if (client.current !== active) return;
    setSnapshot(result);
    setLastRefresh(new Date().toLocaleTimeString());
  }
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const credentials = await Keychain.getGenericPassword({ service });
        if (credentials && mounted) {
          const value = savedSchema.parse(JSON.parse(credentials.password));
          if (value.session.role !== role)
            throw new Error("SESSION_ROLE_MISMATCH");
          connect(value);
          await refresh();
        }
      } catch (e) {
        if (mounted) report(e);
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => {
      mounted = false;
      client.current = null;
    };
    // Component remounts when entering/leaving sandbox; role is fixed per native app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!session || sessionExpired) return;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || mutation.current || AppState.currentState !== "active")
        return;
      inFlight = true;
      try {
        await refresh();
      } catch (e) {
        report(e);
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void poll(), 3000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void poll();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionExpired]);
  async function run(fn: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      report(e);
      try {
        await refresh();
      } catch {
        /* keep original failure */
      }
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function authenticate() {
    await run(async () => {
      const result = await rideRequest(
        origin,
        register ? "register" : "login",
        undefined,
        {
          username,
          password,
          role,
          ...(register
            ? { displayName: name, vehiclePlate: plate, sandboxConsent: true }
            : {}),
        }
      );
      const nextSession = rideSessionSchema.parse({
        ...result,
        apiBaseUrl: origin,
      });
      if (nextSession.role !== role) throw new Error("SESSION_ROLE_MISMATCH");
      if (
        saved.current?.pending &&
        (saved.current.session.accountId !== nextSession.accountId ||
          saved.current.session.apiBaseUrl !== nextSession.apiBaseUrl)
      )
        throw new Error("RELOGIN_SAME_ACCOUNT_TO_RECOVER_COMMAND");
      const next = {
        session: nextSession,
        pending: saved.current?.pending ?? null,
      };
      await persist(next);
      connect(next);
      setPassword("");
      await refresh();
    });
  }
  async function command(operation: string, body: Record<string, unknown>) {
    await run(async () => {
      const result = await client.current!.command(operation, body);
      if (operation === "quotes") setQuote(result as RideQuote);
      else if (operation === "trips") setQuote(null);
      await refresh();
    });
  }
  function confirm(title: string, action: () => void) {
    Alert.alert(title, "Sandbox เท่านั้น · ไม่มีการรับส่งคนหรือตัดเงินจริง", [
      { text: "กลับ", style: "cancel" },
      { text: "ยืนยัน", onPress: action },
    ]);
  }
  const locked = busy || !!pending || !snapshot || sessionExpired;
  const current = snapshot?.current;
  const recentPlaces = (snapshot?.history ?? [])
    .flatMap((trip) => [trip.dropoff, trip.pickup])
    .filter(
      (point, index, points) =>
        points.findIndex((candidate) => candidate.label === point.label) ===
        index
    )
    .slice(0, 3);
  const routeSuggestions = (
    places.length > 0
      ? places
      : [...recentPlaces, ...RIDE_TEST_PLACES].filter((point) =>
          point.label.toLowerCase().includes(search.trim().toLowerCase())
        )
  )
    .filter(
      (point, index, points) =>
        points.findIndex((candidate) => candidate.label === point.label) ===
        index
    )
    .slice(0, 5);
  function updateSelectedPoint(raw: RidePoint) {
    const parsed = ridePointSchema.safeParse(raw);
    if (!parsed.success) {
      setError("พื้นที่ทดสอบรองรับกรุงเทพฯ และปริมณฑลเท่านั้น");
      return false;
    }
    if (selecting === "dropoff") {
      setDropoff(parsed.data);
      setDropoffChosen(true);
    } else {
      setPickup(parsed.data);
      setPickupChosen(true);
    }
    setQuote(null);
    setNearby(null);
    return true;
  }
  function openRoute(target: "pickup" | "dropoff") {
    const nextTarget =
      target === "dropoff" && !pickupChosen ? "pickup" : target;
    if (target === "dropoff" && !pickupChosen)
      setError("กรุณาเลือกจุดรับก่อนค้นหาปลายทาง");
    else setError("");
    setSelecting(nextTarget);
    setSearch("");
    setPlaces([]);
    setSearched(false);
    setRiderStep("route");
  }
  function clearRoutePoint(target: "pickup" | "dropoff") {
    setSearch("");
    setPlaces([]);
    setSearched(false);
    setQuote(null);
    setNearby(null);
    if (target === "pickup") setPickupChosen(false);
    else setDropoffChosen(false);
    setSelecting(target);
    setRiderStep("route");
  }
  function startRouteFromCurrentLocation() {
    openRoute("pickup");
    if (environment.rideSimulator === true) void chooseCurrentPickup();
  }
  function openPin(raw?: RidePoint) {
    if (raw && !updateSelectedPoint(raw)) return;
    setPlaces([]);
    setSearched(false);
    setRiderStep("pin");
  }
  async function prepareRideOptions() {
    if (!pickupChosen || !dropoffChosen) {
      setError("กรุณาเลือกจุดรับและจุดส่งให้ครบก่อนดูราคา");
      return;
    }
    if (!mapConsent) {
      setError("กรุณาเปิด Google Maps และยอมรับการส่งพิกัดเพื่อคำนวณเส้นทาง");
      return;
    }
    await run(async () => {
      const active = client.current!;
      const result = await active.command("quotes", {
        pickup,
        dropoff,
        providerConsent: true,
      });
      setQuote(result as RideQuote);
      setNearby(await active.nearby(pickup));
      setSelecting(null);
      setRiderStep("review");
      await refresh();
    });
  }
  async function refreshRideAvailability() {
    await run(async () => {
      setNearby(await client.current!.nearby(pickup));
    });
  }
  async function searchGooglePlaces() {
    await run(async () => {
      setPlaces([]);
      setSearched(false);
      const result = await client.current!.places(search);
      setPlaces(result.places.map(({ placeId: _id, ...point }) => point));
      setSearched(true);
    });
  }
  async function chooseCurrentPickup() {
    await run(async () => {
      if (environment.rideSimulator !== true)
        throw new Error("LOCATION_SIMULATOR_ONLY");
      if (Platform.OS === "android") {
        const permission = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);
        if (
          permission[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] !==
          PermissionsAndroid.RESULTS.GRANTED
        )
          throw new Error("LOCATION_PERMISSION_REQUIRED");
      } else {
        Geolocation.setRNConfiguration({
          skipPermissionRequests: true,
          authorizationLevel: "whenInUse",
          enableBackgroundLocationUpdates: false,
        });
        await new Promise<void>((resolve, reject) =>
          Geolocation.requestAuthorization(resolve, reject)
        );
      }
      const position = await new Promise<GeolocationResponse>(
        (resolve, reject) => {
          let settled = false;
          const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback();
          };
          const timer = setTimeout(
            () => finish(() => reject(new Error("LOCATION_TIMEOUT"))),
            12000
          );
          Geolocation.getCurrentPosition(
            (value) => finish(() => resolve(value)),
            (reason) => finish(() => reject(reason)),
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0,
            }
          );
        }
      );
      if (
        Date.now() - position.timestamp > 60000 ||
        position.timestamp > Date.now() + 10000
      )
        throw new Error("LOCATION_STALE_OR_FUTURE");
      if (position.coords.accuracy > 100)
        throw new Error("LOCATION_ACCURACY_REQUIRED");
      const point = ridePointSchema.safeParse({
        label: "ตำแหน่งปัจจุบัน",
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      });
      if (!point.success) throw new Error("LOCATION_OUTSIDE_TEST_AREA");
      setPickup(point.data);
      setPickupChosen(true);
      setSelecting("dropoff");
      setSearch("");
      setPlaces([]);
      setSearched(false);
      setQuote(null);
      setNearby(null);
    });
  }
  function tripAction(
    action: string,
    trip = current,
    extra: Record<string, unknown> = {}
  ) {
    if (!trip) return;
    confirm(
      action === "pay"
        ? `ยืนยันจ่าย ${money(trip.fareSatang)} (ทดสอบ)`
        : "ยืนยันเปลี่ยนสถานะการเดินทาง",
      () =>
        void command(`trips/${trip.id}`, {
          action,
          version: trip.version,
          confirmed: true,
          ...extra,
        })
    );
  }
  if (!loaded)
    return (
      <SafeAreaView style={s.screen}>
        <ActivityIndicator />
        <Text>กำลังกู้คืน session…</Text>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView
        scrollEnabled={riderStep !== "review"}
        contentContainerStyle={[
          s.content,
          riderBooking &&
            (riderStep === "pin" || riderStep === "review") &&
            s.mapContent,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {showAppHeader && (
          <View style={s.header}>
            <Text style={s.brand} accessibilityLabel={appName}>
              BMS{" "}
              <Text style={s.green}>{role === "RIDER" ? "Go" : "Driver"}</Text>
            </Text>
            {riderBooking ? (
              <View style={s.testPill}>
                <Text style={s.testPillText}>TEST</Text>
              </View>
            ) : (
              <Text style={s.role}>{roleName}</Text>
            )}
          </View>
        )}
        {showSandboxDetails && (
          <View style={s.banner}>
            <Text style={s.bannerText}>
              SANDBOX · บัญชีทดสอบ / ไม่มีเงินจริง
            </Text>
            <Text style={s.small}>
              Google Maps + ตำแหน่ง OS Simulator · ราคาจำลอง GPS เครื่องจริงและ
              KYC ยังไม่ผ่าน approval
            </Text>
          </View>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        )}
        {!session || sessionExpired || authFailed ? (
          <>
            <Text style={s.title}>
              {register ? "เริ่มเดินทางด้วยกัน" : "ยินดีต้อนรับกลับ"}
            </Text>
            <Text style={s.muted}>
              สมัครบัญชีทดสอบ{role === "RIDER" ? "ผู้โดยสาร" : "คนขับ"}{" "}
              โดยไม่ต้องคัดลอก token
            </Text>
            <Field
              label="Sandbox API"
              value={origin}
              onChangeText={setOrigin}
              disabled={busy}
            />
            <Field
              label="Username (English, 3–20)"
              value={username}
              onChangeText={setUsername}
              disabled={busy}
            />
            <Field
              label="Password (8+ characters)"
              value={password}
              onChangeText={setPassword}
              secret
              disabled={busy}
            />
            {register && (
              <Field
                label="ชื่อแสดงทดสอบ / Test name"
                value={name}
                onChangeText={setName}
                disabled={busy}
              />
            )}
            {register && role === "DRIVER" && (
              <Field
                label="ทะเบียนรถทดสอบ / Test plate"
                value={plate}
                onChangeText={setPlate}
                disabled={busy}
              />
            )}
            {register && (
              <Text style={s.small}>
                กดสมัครเพื่อยืนยันใช้เฉพาะข้อมูลสมมติ
                ไม่ใช้รหัสผ่านหรือข้อมูลส่วนตัวจริง
              </Text>
            )}
            <Button
              title={register ? "ยืนยันสมัครบัญชีทดสอบ" : "เข้าสู่ระบบ"}
              disabled={busy}
              onPress={() => void authenticate()}
            />
            <Button
              title={register ? "มีบัญชีแล้ว · เข้าสู่ระบบ" : "สร้างบัญชีใหม่"}
              secondary
              disabled={busy}
              onPress={() => setRegister(!register)}
            />
          </>
        ) : (
          <>
            {(role === "DRIVER" || tab === "account") && (
              <Text style={s.small}>
                อัปเดต {lastRefresh || "กำลังโหลด…"} · polling ทุก 3 วินาที
                ไม่ใช่ push
              </Text>
            )}
            {!!pending && (
              <View style={s.card}>
                <Text style={s.error}>
                  มีคำสั่งค้าง: {pending.operation} — อย่ากดสร้างรายการใหม่
                </Text>
                <Button
                  title="ลองส่งคำสั่งเดิมอีกครั้ง"
                  disabled={busy || sessionExpired}
                  onPress={() =>
                    void run(async () => {
                      const op = pending.operation;
                      const result = await client.current!.retry();
                      if (op === "quotes") {
                        setQuote(result as RideQuote);
                        setRiderStep("review");
                      }
                      await refresh();
                    })
                  }
                />
              </View>
            )}
            {!snapshot && (
              <Button
                title="โหลดงานจาก server อีกครั้ง"
                secondary
                disabled={busy || sessionExpired}
                onPress={() => void run(refresh)}
              />
            )}
            {tab === "home" && (
              <>
                {role === "DRIVER" && (
                  <Text style={s.title}>พร้อมออกเดินทาง?</Text>
                )}
                {snapshot &&
                  client.current &&
                  (role === "DRIVER" ||
                    !!current ||
                    riderStep === "pin" ||
                    riderStep === "review") && (
                    <RideMap
                      environment={environment}
                      client={client.current}
                      snapshot={snapshot}
                      pickup={pickup}
                      dropoff={dropoff}
                      selecting={locked ? null : selecting}
                      initialConsent={mapConsent}
                      mode={
                        riderStep === "pin"
                          ? "pin"
                          : riderStep === "review"
                          ? "review"
                          : "default"
                      }
                      onBack={() => setRiderStep("route")}
                      roadRoute={quote?.route ?? null}
                      onPick={(point) => {
                        if (!locked && !current) updateSelectedPoint(point);
                      }}
                      onError={report}
                      onConsent={() => setMapConsent(true)}
                    />
                  )}
                {role === "RIDER" && !current && (
                  <>
                    {riderStep === "home" && (
                      <>
                        <Text style={s.heroTitle}>ไปเที่ยวกัน</Text>
                        <View style={s.serviceGrid}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Rides เร็ว ๆ นี้"
                            accessibilityState={{ disabled: true }}
                            disabled
                            style={[s.serviceCard, s.disabledService]}
                          >
                            <Text style={s.serviceIcon}>🚗</Text>
                            <Text style={s.cardTitle}>Rides</Text>
                            <Text style={s.muted}>
                              รถยนต์รับส่ง · เร็ว ๆ นี้
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Schedule เร็ว ๆ นี้"
                            accessibilityState={{ disabled: true }}
                            disabled
                            style={[s.serviceCard, s.disabledService]}
                          >
                            <Text style={s.serviceIcon}>🗓️</Text>
                            <Text style={s.cardTitle}>Schedule</Text>
                            <Text style={s.muted}>
                              จองล่วงหน้า · เร็ว ๆ นี้
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="เลือก Motorbike"
                            accessibilityState={{ disabled: locked }}
                            disabled={locked}
                            style={[
                              s.serviceCard,
                              s.activeServiceCard,
                              locked && s.disabledService,
                            ]}
                            onPress={startRouteFromCurrentLocation}
                          >
                            <Text style={s.serviceIcon}>🏍</Text>
                            <Text style={s.cardTitle}>Motorbike</Text>
                            <Text style={s.muted}>มอเตอร์ไซค์รับส่งคน</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="เปิด Go Send"
                            accessibilityState={{ disabled: busy || !!pending }}
                            disabled={busy || !!pending}
                            style={[
                              s.serviceCard,
                              (busy || !!pending) && s.disabledService,
                            ]}
                            onPress={onExit}
                          >
                            <Text style={s.serviceIcon}>📦</Text>
                            <Text style={s.cardTitle}>Go Send</Text>
                            <Text style={s.muted}>ส่งหรือรับสินค้า</Text>
                          </Pressable>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="ไปที่ไหน"
                          disabled={locked}
                          style={s.destinationBar}
                          onPress={startRouteFromCurrentLocation}
                        >
                          <Text style={s.searchIcon}>⌕</Text>
                          <Text style={s.destinationText}>ไปที่ไหน?</Text>
                        </Pressable>
                        <Text style={s.sectionTitle}>สถานที่ล่าสุด</Text>
                        {(recentPlaces.length > 0
                          ? recentPlaces
                          : RIDE_TEST_PLACES.slice(0, 3)
                        ).map((point) => (
                          <Pressable
                            key={`${point.label}:${point.lat}:${point.lng}`}
                            accessibilityRole="button"
                            accessibilityLabel={`เลือกสถานที่ ${point.label}`}
                            disabled={locked}
                            style={s.recentRow}
                            onPress={() => {
                              setDropoff(point);
                              setDropoffChosen(true);
                              setQuote(null);
                              setNearby(null);
                              startRouteFromCurrentLocation();
                            }}
                          >
                            <Text style={s.recentIcon}>◷</Text>
                            <View style={s.flex}>
                              <Text style={s.text}>{point.label}</Text>
                              <Text style={s.muted}>แตะเพื่อยืนยันจุดส่ง</Text>
                            </View>
                          </Pressable>
                        ))}
                      </>
                    )}
                    {riderStep === "route" && (
                      <>
                        <View style={s.routeHeader}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="ปิดหน้าเส้นทาง"
                            style={s.iconButton}
                            onPress={() => setRiderStep("home")}
                          >
                            <Text style={s.closeIcon}>×</Text>
                          </Pressable>
                          <Text style={s.routeTitle}>เส้นทาง</Text>
                          <View style={s.headerSpacer} />
                        </View>
                        <View style={s.routeEditor}>
                          <View style={[s.routeCard, s.flex]}>
                            <View style={s.routeRow}>
                              <Text style={s.pickupDot}>●</Text>
                              {selecting === "pickup" ? (
                                <TextInput
                                  autoFocus
                                  accessibilityLabel="ค้นหาจุดรับ"
                                  editable={!locked}
                                  value={search}
                                  placeholder={
                                    pickupChosen ? pickup.label : "จุดรับ"
                                  }
                                  placeholderTextColor="#68736d"
                                  returnKeyType="search"
                                  onChangeText={(value) => {
                                    setSearch(value);
                                    setPickupChosen(false);
                                    setQuote(null);
                                    setNearby(null);
                                    setPlaces([]);
                                    setSearched(false);
                                  }}
                                  onSubmitEditing={() => {
                                    if (
                                      mapConsent &&
                                      search.trim().length >= 2 &&
                                      !locked
                                    )
                                      void searchGooglePlaces();
                                  }}
                                  style={s.routeInput}
                                />
                              ) : (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="แก้ไขจุดรับ"
                                  style={s.flex}
                                  onPress={() => openRoute("pickup")}
                                >
                                  <Text style={s.routeValue}>
                                    {pickupChosen ? pickup.label : "จุดรับ"}
                                  </Text>
                                </Pressable>
                              )}
                              {(pickupChosen ||
                                (selecting === "pickup" &&
                                  search.length > 0)) && (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="ล้างจุดรับ"
                                  hitSlop={8}
                                  onPress={() => clearRoutePoint("pickup")}
                                  style={s.clearRouteButton}
                                >
                                  <Text style={s.clearRouteIcon}>×</Text>
                                </Pressable>
                              )}
                              {selecting === "pickup" && (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="ยืนยันจุดรับบนแผนที่"
                                  onPress={() => openPin()}
                                  style={s.miniMapButton}
                                >
                                  <Text style={s.miniMapIcon}>⌖</Text>
                                </Pressable>
                              )}
                            </View>
                            <View style={s.routeConnector} />
                            <View style={s.routeDivider} />
                            <View style={s.routeRow}>
                              <Text style={s.dropoffDot}>●</Text>
                              {selecting === "dropoff" ? (
                                <TextInput
                                  autoFocus
                                  accessibilityLabel="ค้นหาจุดส่ง"
                                  editable={!locked}
                                  value={search}
                                  placeholder={
                                    dropoffChosen ? dropoff.label : "ไปที่ไหน?"
                                  }
                                  placeholderTextColor="#68736d"
                                  returnKeyType="search"
                                  onChangeText={(value) => {
                                    setSearch(value);
                                    setDropoffChosen(false);
                                    setQuote(null);
                                    setNearby(null);
                                    setPlaces([]);
                                    setSearched(false);
                                  }}
                                  onSubmitEditing={() => {
                                    if (
                                      mapConsent &&
                                      search.trim().length >= 2 &&
                                      !locked
                                    )
                                      void searchGooglePlaces();
                                  }}
                                  style={s.routeInput}
                                />
                              ) : (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="แก้ไขจุดส่ง"
                                  style={s.flex}
                                  onPress={() => openRoute("dropoff")}
                                >
                                  <Text style={s.routeValue}>
                                    {dropoffChosen
                                      ? dropoff.label
                                      : "ไปที่ไหน?"}
                                  </Text>
                                </Pressable>
                              )}
                              {(dropoffChosen ||
                                (selecting === "dropoff" &&
                                  search.length > 0)) && (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="ล้างจุดส่ง"
                                  hitSlop={8}
                                  onPress={() => clearRoutePoint("dropoff")}
                                  style={s.clearRouteButton}
                                >
                                  <Text style={s.clearRouteIcon}>×</Text>
                                </Pressable>
                              )}
                              {selecting === "dropoff" && (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel="ยืนยันจุดส่งบนแผนที่"
                                  onPress={() => openPin()}
                                  style={s.miniMapButton}
                                >
                                  <Text style={s.miniMapIcon}>⌖</Text>
                                </Pressable>
                              )}
                            </View>
                          </View>
                          <View style={s.routeSideActions}>
                            <Text style={s.addStopIcon}>＋</Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="สลับจุดรับและจุดส่ง"
                              disabled={locked || !dropoffChosen}
                              onPress={() => {
                                const before = pickup;
                                setPickup(dropoff);
                                setDropoff(before);
                                setQuote(null);
                                setNearby(null);
                              }}
                            >
                              <Text
                                style={[
                                  s.swapIcon,
                                  !dropoffChosen && s.disabledText,
                                ]}
                              >
                                ⇅
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                        {selecting === "pickup" && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="ใช้ตำแหน่งปัจจุบัน"
                            accessibilityState={{
                              disabled:
                                locked || environment.rideSimulator !== true,
                            }}
                            disabled={
                              locked || environment.rideSimulator !== true
                            }
                            onPress={() => void chooseCurrentPickup()}
                            style={[
                              s.currentLocationRow,
                              environment.rideSimulator !== true && s.disabled,
                            ]}
                          >
                            <Text style={s.currentLocationIcon}>⌖</Text>
                            <View style={s.flex}>
                              <Text style={s.currentLocationText}>
                                ใช้ตำแหน่งปัจจุบัน
                              </Text>
                              <Text style={s.small}>OS Simulator เท่านั้น</Text>
                            </View>
                          </Pressable>
                        )}
                        {!mapConsent && (
                          <Button
                            title="เปิด Google Maps และค้นหาสถานที่"
                            disabled={
                              locked || environment.rideMapsConfigured !== true
                            }
                            onPress={() => setMapConsent(true)}
                          />
                        )}
                        {mapConsent && search.trim().length >= 2 && (
                          <Button
                            title="ค้นหาใน Google"
                            disabled={locked}
                            onPress={() => void searchGooglePlaces()}
                          />
                        )}
                        <View style={s.suggestionList}>
                          {routeSuggestions.map((point, index) => (
                            <Pressable
                              key={`${point.label}:${point.lat}:${point.lng}`}
                              accessibilityRole="button"
                              accessibilityLabel={`เลือก ${point.label}`}
                              disabled={locked}
                              style={s.suggestionRow}
                              onPress={() => openPin(point)}
                            >
                              <Text style={s.suggestionIcon}>
                                {index === 2 ? "✈" : "◷"}
                              </Text>
                              <View style={s.flex}>
                                <Text
                                  style={s.suggestionTitle}
                                  numberOfLines={1}
                                >
                                  {point.label}
                                </Text>
                                <Text style={s.muted} numberOfLines={1}>
                                  สถานที่ทดสอบ · กรุงเทพมหานคร
                                </Text>
                              </View>
                              <Text style={s.distanceText}>
                                {pickupChosen
                                  ? distanceLabel(pickup, point)
                                  : "—"}
                              </Text>
                            </Pressable>
                          ))}
                          {searched && routeSuggestions.length === 0 && (
                            <Text style={s.muted}>
                              ไม่พบสถานที่ในพื้นที่ทดสอบ
                            </Text>
                          )}
                        </View>
                        <Text style={s.small}>
                          ระยะเส้นตรงเพื่อช่วยเลือกเท่านั้น ไม่ใช่ระยะถนนหรือ
                          ETA · Google ได้รับข้อความเมื่อกดค้นหาหรือ Search
                          บนคีย์บอร์ด
                        </Text>
                      </>
                    )}
                    {riderStep === "pin" && (
                      <View style={s.confirmPanel}>
                        <Text style={s.stepTitle}>
                          ยืนยัน{selecting === "pickup" ? "จุดรับ" : "จุดส่ง"}
                        </Text>
                        <Text style={s.muted}>
                          ลากแผนที่หรือแก้ไขที่อยู่เพื่อกำหนด
                          {selecting === "pickup" ? "จุดรับ" : "จุดส่ง"}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="แก้ไขที่อยู่"
                          style={s.addressBox}
                          onPress={() => openRoute(selecting ?? "dropoff")}
                        >
                          <Text style={s.searchIcon}>⌕</Text>
                          <Text style={[s.text, s.flex]}>
                            {selecting === "pickup"
                              ? pickup.label
                              : dropoff.label}
                          </Text>
                        </Pressable>
                        <Button
                          title="ยืนยัน"
                          disabled={
                            locked ||
                            !mapConsent ||
                            (selecting === "pickup" && !pickupChosen) ||
                            (selecting === "dropoff" && !dropoffChosen)
                          }
                          onPress={() => {
                            if (selecting === "pickup") {
                              setSelecting("dropoff");
                              setSearch("");
                              setPlaces([]);
                              setSearched(false);
                              setRiderStep("route");
                            } else void prepareRideOptions();
                          }}
                        />
                      </View>
                    )}
                    {riderStep === "route" && (
                      <>
                        <Text style={s.small}>
                          พื้นที่ทดสอบกรุงเทพฯ / ปริมณฑล · เส้นทางและราคาใช้
                          Google Routes สำหรับรถสองล้อ
                        </Text>
                        <Button
                          title="ดูราคาและรถใกล้เคียง"
                          disabled={
                            locked ||
                            !mapConsent ||
                            !pickupChosen ||
                            !dropoffChosen
                          }
                          onPress={() => void prepareRideOptions()}
                        />
                      </>
                    )}
                    {riderStep === "review" && quote && (
                      <Animated.View
                        style={[
                          s.rideSheet,
                          s.reviewSheet,
                          { height: reviewSheetHeight },
                        ]}
                      >
                        <View
                          accessibilityRole="adjustable"
                          accessibilityLabel="ปรับความสูงแผงเลือกรถ"
                          accessibilityHint="ลากขึ้นหรือลงเพื่อขยายหรือย่อ"
                          accessibilityActions={[
                            { name: "increment", label: "ขยายแผง" },
                            { name: "decrement", label: "ย่อแผง" },
                          ]}
                          onAccessibilityAction={(event) => {
                            const points = reviewSheetSnapPoints.current;
                            animateReviewSheet(
                              event.nativeEvent.actionName === "increment"
                                ? points.max
                                : points.min
                            );
                          }}
                          style={s.sheetDragArea}
                          {...reviewSheetPan.panHandlers}
                        >
                          <View style={s.sheetHandle} />
                        </View>
                        <ScrollView
                          accessibilityLabel="รายละเอียดรถและราคา"
                          nestedScrollEnabled
                          showsVerticalScrollIndicator={false}
                          style={s.reviewSheetScroll}
                          contentContainerStyle={s.reviewSheetScrollContent}
                        >
                          <Text style={s.sectionTitle}>เลือกรถและราคา</Text>
                          <View style={s.optionTabs}>
                            {(
                              [
                                ["RECOMMENDED", "แนะนำ"],
                                ["FASTER", "เร็วกว่า"],
                                ["CHEAPER", "ถูกกว่า"],
                              ] as const
                            ).map(([value, label]) => (
                              <Pressable
                                key={value}
                                accessibilityRole="button"
                                accessibilityLabel={`เรียงแบบ${label}`}
                                accessibilityState={{
                                  selected: optionSort === value,
                                }}
                                onPress={() => setOptionSort(value)}
                                style={[
                                  s.optionTab,
                                  optionSort === value && s.activeOptionTab,
                                ]}
                              >
                                <Text
                                  style={[
                                    s.optionTabText,
                                    optionSort === value &&
                                      s.activeOptionTabText,
                                  ]}
                                >
                                  {label}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                          <Text style={s.small}>
                            ขณะนี้เปิดจริง 1 บริการ จึงแสดง Motorbike ทุกแท็บ
                          </Text>
                          <View style={s.vehicleOption}>
                            <View style={s.serviceArtworkWrap}>
                              {environment.rideMotorbikeArtwork ? (
                                <Image
                                  accessibilityLabel="ภาพประเภทบริการ Motorbike"
                                  source={environment.rideMotorbikeArtwork}
                                  resizeMode="contain"
                                  style={s.serviceArtwork}
                                />
                              ) : (
                                <Text style={s.serviceArtworkFallback}>M</Text>
                              )}
                              <Text style={s.artworkCaption}>
                                ภาพประเภทบริการ
                              </Text>
                            </View>
                            <View style={s.flex}>
                              <Text style={s.cardTitle}>Motorbike</Text>
                              <Text style={s.muted}>
                                1 ผู้โดยสาร ·{" "}
                                {nearby?.count
                                  ? `พร้อมรับงาน ${nearby.count} คน`
                                  : "ยังไม่มีคนขับพร้อมรับงาน"}
                              </Text>
                              <Text style={s.muted}>
                                เส้นทางถนน {(quote.distanceM / 1000).toFixed(1)}{" "}
                                กม. · ประมาณ{" "}
                                {Math.max(
                                  1,
                                  Math.ceil(quote.route.durationSeconds / 60)
                                )}{" "}
                                นาที
                              </Text>
                              {nearby?.pickupEtaStatus === "AVAILABLE" && (
                                <Text style={s.liveMetric}>
                                  รับภายในประมาณ{" "}
                                  {Math.max(
                                    1,
                                    Math.ceil(nearby.pickupEtaSeconds! / 60)
                                  )}{" "}
                                  นาที · Google Routes
                                </Text>
                              )}
                            </View>
                            <Text style={s.fare}>
                              {money(quote.fareSatang)}
                            </Text>
                          </View>
                          <View style={s.rankingReason}>
                            <Text style={s.rankingReasonTitle}>
                              {optionSort === "RECOMMENDED"
                                ? "เหตุผลที่แนะนำ"
                                : optionSort === "FASTER"
                                ? "เกณฑ์เร็วกว่า"
                                : "เกณฑ์ถูกกว่า"}
                            </Text>
                            <Text style={s.muted}>
                              {optionSort === "RECOMMENDED"
                                ? nearby?.count
                                  ? `เป็นบริการที่เปิดจริง มีคนขับพร้อม ${nearby.count} คน พร้อมราคาและเส้นทางที่ยืนยันจาก server`
                                  : "ไม่มีบริการที่มีคนขับพร้อมในรัศมี 5 กม. จึงยังไม่แนะนำให้เรียกรถ"
                                : optionSort === "FASTER"
                                ? nearby?.pickupEtaStatus === "AVAILABLE"
                                  ? `เรียงจาก ETA คนขับถึงจุดรับบนถนนจริง ต่ำสุดประมาณ ${Math.max(
                                      1,
                                      Math.ceil(nearby.pickupEtaSeconds! / 60)
                                    )} นาที จากคนขับ ${
                                      nearby.assessedDriverCount
                                    } คน`
                                  : "ยังจัดอันดับความเร็วไม่ได้ เพราะไม่มี ETA คนขับถึงจุดรับที่ยืนยันได้"
                                : `เรียงจากยอดที่ต้องจ่ายจริง ${money(
                                    quote.fareSatang
                                  )} ไม่ใช้ราคาขั้นต่ำของช่วงราคา`}
                            </Text>
                          </View>
                          {nearby?.count === 0 && (
                            <View style={s.noDriverBox}>
                              <Text style={s.noDriverTitle}>
                                ยังไม่มีคนขับใกล้จุดรับ
                              </Text>
                              <Text style={s.muted}>
                                ตรวจจากคนขับออนไลน์ที่ GPS สด ไม่มีงานค้าง
                                และอยู่ในรัศมี 5 กม.
                              </Text>
                              <Button
                                title="ตรวจหาคนขับอีกครั้ง"
                                secondary
                                disabled={locked}
                                onPress={() => void refreshRideAvailability()}
                              />
                            </View>
                          )}
                          {nearby?.pickupEtaStatus === "PROVIDER_UNAVAILABLE" &&
                            nearby.count > 0 && (
                              <Text style={s.error}>
                                มีคนขับพร้อม แต่ยังยืนยัน ETA บนถนนไม่ได้
                              </Text>
                            )}
                          <Text style={s.small}>
                            เส้นทาง Google Routes สำหรับรถสองล้อ ·
                            เวลาเป็นค่าประมาณ อาจเปลี่ยนตามสภาพถนน ·
                            ปฏิบัติตามป้ายและกฎหมายจราจรเสมอ · ราคาใช้ได้ 5 นาที
                          </Text>
                          {quote.route.warnings.map((warning) => (
                            <Text key={warning} style={s.small}>
                              คำเตือนจาก Google: {warning}
                            </Text>
                          ))}
                        </ScrollView>
                        <View
                          accessibilityLabel="การชำระเงินและยืนยันบริการ"
                          style={s.reviewSheetFooter}
                        >
                          <View style={s.paymentRow}>
                            <Text style={s.cashIcon}>▰</Text>
                            <View style={s.flex}>
                              <Text style={s.cardTitle}>Sandbox payment</Text>
                              <Text style={s.muted}>ชำระหลังถึงปลายทาง</Text>
                            </View>
                          </View>
                          <Button
                            title={
                              nearby?.count
                                ? "เลือก Motorbike"
                                : "ยังไม่มีคนขับใกล้เคียง"
                            }
                            disabled={
                              locked ||
                              !nearby?.count ||
                              Date.parse(quote.expiresAt) <= Date.now()
                            }
                            onPress={() =>
                              confirm("ยืนยันเรียกมอเตอร์ไซค์", () => {
                                void (async () => {
                                  await command("trips", {
                                    quoteId: quote.id,
                                    confirmed: true,
                                  });
                                  setRiderStep("home");
                                })();
                              })
                            }
                          />
                          <Button
                            title="‹ แก้ไขเส้นทาง"
                            secondary
                            onPress={() => setRiderStep("route")}
                          />
                        </View>
                      </Animated.View>
                    )}
                  </>
                )}
                {role === "DRIVER" && (
                  <>
                    <View style={s.card}>
                      <Text style={s.cardTitle}>
                        {snapshot?.account.online
                          ? "● เปิดรับงานอยู่"
                          : "○ ออฟไลน์"}
                      </Text>
                      <Text style={s.muted}>
                        ทะเบียน {snapshot?.account.vehiclePlate}
                      </Text>
                      <Button
                        title={
                          snapshot?.account.online
                            ? "ปิดรับงานใหม่"
                            : "เปิดพร้อมให้บริการ (ทดสอบ)"
                        }
                        disabled={locked}
                        onPress={() =>
                          void command("availability", {
                            online: !snapshot?.account.online,
                          })
                        }
                      />
                      <Text style={s.small}>
                        ปิดรับงานไม่ยกเลิกเที่ยวที่กำลังทำ
                      </Text>
                    </View>
                    {!current &&
                      snapshot?.account.online &&
                      snapshot.offers.length === 0 && (
                        <Text style={s.text}>
                          ยังไม่มีคนเรียกรถ — เปิด Customer App
                          เพื่อเรียกเที่ยวทดสอบ
                        </Text>
                      )}
                    {!current &&
                      snapshot?.offers.map((offer) => (
                        <View key={offer.id}>
                          <TripCard trip={offer} />
                          <Button
                            title="รับงานนี้ · ไปรับผู้โดยสาร"
                            disabled={locked}
                            onPress={() => tripAction("accept", offer)}
                          />
                        </View>
                      ))}
                  </>
                )}
                {current && (
                  <>
                    <TripCard trip={current} />
                    {current.state === "SEARCHING" && (
                      <Text style={s.muted}>
                        รอคนขับที่เปิดรับงานกดยืนยันใน Driver App ·
                        ยังไม่มีการตัดเงิน
                      </Text>
                    )}
                    {role === "DRIVER" && current.state === "ACCEPTED" && (
                      <Button
                        title="ถึงจุดรับผู้โดยสารแล้ว"
                        disabled={locked}
                        onPress={() => tripAction("arrive")}
                      />
                    )}
                    {role === "DRIVER" && current.state === "AT_PICKUP" && (
                      <Button
                        title="รับผู้โดยสารแล้ว · เริ่มเดินทาง"
                        disabled={locked}
                        onPress={() => tripAction("start")}
                      />
                    )}
                    {role === "DRIVER" && current.state === "IN_PROGRESS" && (
                      <Button
                        title="ถึงปลายทาง · จบการเดินทาง"
                        disabled={locked}
                        onPress={() => tripAction("finish")}
                      />
                    )}
                    {role === "DRIVER" &&
                      current.state === "AWAITING_PAYMENT" && (
                        <Text style={s.text}>
                          รอผู้โดยสารกดจ่าย sandbox ใน Customer App
                        </Text>
                      )}
                    {role === "RIDER" &&
                      current.state === "AWAITING_PAYMENT" && (
                        <>
                          <Button
                            title={`จ่าย sandbox ${money(current.fareSatang)}`}
                            disabled={locked}
                            onPress={() =>
                              tripAction("pay", current, {
                                paymentOutcome: "SUCCEEDED",
                              })
                            }
                          />
                          <Button
                            title="ทดสอบชำระไม่สำเร็จ"
                            secondary
                            disabled={locked}
                            onPress={() =>
                              tripAction("pay", current, {
                                paymentOutcome: "DECLINED",
                              })
                            }
                          />
                        </>
                      )}
                    {["SEARCHING", "ACCEPTED", "AT_PICKUP"].includes(
                      current.state
                    ) && (
                      <Button
                        title="ยกเลิกเที่ยวก่อนเริ่มเดินทาง"
                        secondary
                        disabled={locked}
                        onPress={() => tripAction("cancel")}
                      />
                    )}
                  </>
                )}
                {!current && snapshot?.history[0]?.state === "COMPLETED" && (
                  <View style={s.success}>
                    <Text style={s.cardTitle}>
                      เที่ยวล่าสุดสำเร็จ · จ่าย sandbox แล้ว ✓
                    </Text>
                    <Text style={s.text}>
                      {money(snapshot.history[0].fareSatang)} ·
                      ดูใบรับเงินที่ประวัติ
                    </Text>
                  </View>
                )}
              </>
            )}
            {tab === "activity" && (
              <>
                <Text style={s.title}>การเดินทางของคุณ</Text>
                {role === "DRIVER" && (
                  <Text style={s.fare}>
                    รายรับจำลอง {money(snapshot?.earningsSatang ?? 0)}
                  </Text>
                )}
                <Text style={s.small}>
                  {role === "DRIVER"
                    ? "รายรับเต็มค่าโดยสารทดสอบ ไม่ใช่ยอดถอน ไม่มีคอมมิชชัน/ภาษี"
                    : "ประวัติและใบรับเงินทดสอบเท่านั้น ไม่มีการตัดเงินจริง"}
                </Text>
                {snapshot?.history.length === 0 && (
                  <Text style={s.text}>ยังไม่มีเที่ยวที่เสร็จหรือยกเลิก</Text>
                )}
                {snapshot?.history.map((trip) => (
                  <TripCard key={trip.id} trip={trip} />
                ))}
              </>
            )}
            {tab === "account" && (
              <>
                <Text style={s.title}>
                  {snapshot?.account.displayName ?? "บัญชีทดสอบ"}
                </Text>
                <Text style={s.text}>
                  {role === "RIDER" ? "ผู้โดยสาร" : "คนขับมอเตอร์ไซค์"} ·
                  Sandbox only
                </Text>
                <Text style={s.muted}>{origin}</Text>
                <Text style={s.small}>
                  Session 8 ชั่วโมง · ยังไม่มีการยืนยันเบอร์โทร/KYC
                </Text>
                {role === "RIDER" && (
                  <View style={s.banner}>
                    <Text style={s.bannerText}>
                      TEST ENVIRONMENT · ไม่มีเงินจริง
                    </Text>
                    <Text style={s.small}>
                      แผนที่ต้องใช้ Google key · ตำแหน่งใช้ได้เฉพาะ Simulator ·
                      ราคาเป็นสูตรจำลอง
                    </Text>
                  </View>
                )}
                <Button
                  title="ออกจากระบบ"
                  secondary
                  disabled={busy || !!pending}
                  onPress={() =>
                    void run(async () => {
                      if (!sessionExpired) await client.current!.logout();
                      await Keychain.resetGenericPassword({ service });
                      client.current = null;
                      saved.current = null;
                      setSession(null);
                      setSnapshot(null);
                      setQuote(null);
                      setTab("home");
                      setRiderStep("home");
                      setPickup(RIDE_TEST_PLACES[0]!);
                      setDropoff(RIDE_TEST_PLACES[2]!);
                      setPickupChosen(false);
                      setDropoffChosen(false);
                    })
                  }
                />
                {!!pending && (
                  <Text style={s.small}>
                    แก้คำสั่งค้างก่อนออกจากระบบเพื่อไม่ทำคำสั่งสูญหาย
                  </Text>
                )}
              </>
            )}
            {sessionExpired && (
              <Text style={s.error}>
                Session หมดอายุ กรุณาเข้าระบบใหม่เพื่อกู้คืนงาน
              </Text>
            )}
          </>
        )}
        {busy && <ActivityIndicator color="#05875e" />}
        {(!riderBooking || riderStep === "home") && (
          <>
            {!riderBooking && (
              <Button
                title="กลับไปโหมดส่งสินค้าเดิม"
                secondary
                disabled={busy || !!pending}
                onPress={onExit}
              />
            )}
            <Text style={s.footer}>
              {appName} · {roleName} sandbox · ไม่ใช่บริการของ Grab/Bolt
            </Text>
          </>
        )}
      </ScrollView>
      {!!session &&
        !sessionExpired &&
        !authFailed &&
        (!riderBooking || riderStep === "home") && (
          <View style={s.bottomTabs}>
            {(["home", "activity", "account"] as const).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="tab"
                accessibilityLabel={
                  { home: "หน้าหลัก", activity: "ประวัติ", account: "บัญชี" }[t]
                }
                accessibilityState={{ selected: tab === t }}
                onPress={() => setTab(t)}
                style={[s.bottomTab, tab === t && s.activeBottomTab]}
              >
                <Text style={s.tabIcon}>
                  {{ home: "⌂", activity: "▤", account: "◎" }[t]}
                </Text>
                <Text style={s.tabText}>
                  {
                    {
                      home: "หน้าหลัก",
                      activity: "ประวัติ",
                      account: "บัญชี",
                    }[t]
                  }
                </Text>
              </Pressable>
            ))}
          </View>
        )}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fbfcfb" },
  content: { padding: 22, gap: 14, paddingBottom: 30 },
  mapContent: { padding: 0, gap: 0, paddingBottom: 0, flexGrow: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: { fontSize: 27, fontWeight: "900", color: "#152922" },
  green: { color: "#05875e" },
  role: { color: "#52655c", fontSize: 13, fontWeight: "700" },
  testPill: {
    backgroundColor: "#e4f3eb",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  testPillText: { color: "#087653", fontSize: 11, fontWeight: "900" },
  banner: { backgroundColor: "#fff1ce", padding: 12, borderRadius: 12, gap: 4 },
  bannerText: { fontWeight: "800", color: "#73531b", fontSize: 13 },
  small: { fontSize: 12, color: "#626d66", lineHeight: 18 },
  title: { fontSize: 29, fontWeight: "800", color: "#152922", marginTop: 8 },
  heroTitle: {
    fontSize: 36,
    fontWeight: "900",
    color: "#14251e",
    marginTop: 8,
  },
  stepTitle: { fontSize: 25, fontWeight: "800", color: "#152922", flex: 1 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#20352c",
    marginTop: 6,
  },
  text: { fontSize: 16, color: "#20352c", lineHeight: 24 },
  muted: { fontSize: 14, color: "#637168", lineHeight: 21 },
  card: { backgroundColor: "#eff3f0", borderRadius: 18, padding: 18, gap: 8 },
  cardTitle: { fontSize: 19, fontWeight: "700", color: "#18382b" },
  fare: { fontSize: 30, fontWeight: "800", color: "#123c2b" },
  serviceCard: {
    flexBasis: "46%",
    flexGrow: 1,
    minHeight: 150,
    justifyContent: "flex-end",
    backgroundColor: "#eef2ef",
    borderRadius: 20,
    padding: 18,
    gap: 3,
  },
  activeServiceCard: { borderColor: "#07986a", borderWidth: 2 },
  serviceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  disabledService: { opacity: 0.55 },
  serviceIcon: { fontSize: 38, color: "#05764d" },
  destinationBar: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "#edf1ee",
    borderRadius: 20,
    paddingHorizontal: 22,
  },
  destinationText: { fontSize: 25, fontWeight: "800", color: "#152922" },
  searchIcon: { fontSize: 30, color: "#182a23" },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
    borderBottomColor: "#e3e8e4",
    borderBottomWidth: 1,
  },
  recentIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#edf1ee",
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 27,
    color: "#52655c",
  },
  flex: { flex: 1 },
  routeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 58,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: { color: "#172720", fontSize: 42, lineHeight: 44 },
  routeTitle: { fontSize: 24, fontWeight: "800", color: "#172720" },
  headerSpacer: { width: 48, height: 48 },
  routeEditor: { flexDirection: "row", alignItems: "stretch", gap: 12 },
  routeCard: {
    borderColor: "#05875e",
    borderWidth: 2,
    borderRadius: 18,
    paddingHorizontal: 17,
    backgroundColor: "#fff",
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
  },
  routeInput: {
    flex: 1,
    paddingVertical: 0,
    color: "#172720",
    fontSize: 19,
  },
  routeValue: { color: "#172720", fontSize: 19, lineHeight: 26 },
  clearRouteButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e3e7e4",
  },
  clearRouteIcon: {
    color: "#7b857f",
    fontSize: 22,
    lineHeight: 24,
    textAlign: "center",
  },
  routeConnector: {
    position: "absolute",
    left: 25,
    top: 43,
    width: 2,
    height: 37,
    backgroundColor: "#174d38",
  },
  routeDivider: { height: 1, backgroundColor: "#e4e9e5", marginLeft: 32 },
  pickupDot: { color: "#2a9369", fontSize: 20 },
  dropoffDot: { color: "#143b2b", fontSize: 20 },
  miniMapButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#edf1ee",
  },
  miniMapIcon: { fontSize: 25, color: "#153c2d" },
  routeSideActions: {
    width: 38,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "space-between",
  },
  addStopIcon: { color: "#172720", fontSize: 32 },
  swapIcon: { color: "#172720", fontSize: 32, lineHeight: 38 },
  disabledText: { opacity: 0.3 },
  currentLocationRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 4,
    paddingVertical: 12,
    borderBottomColor: "#e5e9e6",
    borderBottomWidth: 1,
  },
  currentLocationIcon: {
    width: 54,
    color: "#168158",
    fontSize: 34,
    textAlign: "center",
  },
  currentLocationText: {
    color: "#168158",
    fontSize: 18,
    fontWeight: "800",
  },
  suggestionList: { marginTop: 4 },
  suggestionRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    borderBottomColor: "#e5e9e6",
    borderBottomWidth: 1,
  },
  suggestionIcon: {
    width: 40,
    color: "#59675f",
    fontSize: 28,
    textAlign: "center",
  },
  suggestionTitle: { color: "#172720", fontSize: 19, lineHeight: 26 },
  distanceText: { color: "#59675f", fontSize: 15 },
  confirmPanel: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingVertical: 28,
    gap: 14,
    marginTop: -18,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  addressBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "#eef2ef",
    borderRadius: 15,
    padding: 16,
  },
  rideSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 14,
    marginTop: -18,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  reviewSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    marginTop: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 0,
    overflow: "hidden",
  },
  sheetDragArea: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 58,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#e1e6e2",
    marginBottom: 2,
  },
  reviewSheetScroll: { flex: 1 },
  reviewSheetScrollContent: {
    paddingHorizontal: 24,
    paddingTop: 2,
    paddingBottom: 16,
    gap: 14,
  },
  reviewSheetFooter: {
    flexShrink: 0,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 16,
    gap: 10,
    borderTopColor: "#e2e8e4",
    borderTopWidth: 1,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 8,
  },
  vehicleOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderColor: "#05875e",
    borderWidth: 2,
    borderRadius: 16,
    padding: 16,
  },
  optionTabs: { flexDirection: "row", gap: 6 },
  optionTab: {
    flex: 1,
    minHeight: 34,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#eef1ef",
    borderColor: "#eef1ef",
    borderWidth: 2,
  },
  activeOptionTab: { backgroundColor: "#fff", borderColor: "#23845f" },
  optionTabText: { color: "#4f5e56", fontSize: 12, fontWeight: "700" },
  activeOptionTabText: { color: "#174d38" },
  serviceArtworkWrap: { width: 92, alignItems: "center", gap: 2 },
  serviceArtwork: { width: 92, height: 66, backgroundColor: "#fff" },
  serviceArtworkFallback: {
    width: 66,
    height: 66,
    borderRadius: 33,
    color: "#fff",
    backgroundColor: "#087653",
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 66,
    textAlign: "center",
  },
  artworkCaption: { color: "#78847e", fontSize: 9, textAlign: "center" },
  liveMetric: { color: "#087653", fontSize: 13, fontWeight: "700" },
  rankingReason: {
    borderRadius: 14,
    backgroundColor: "#f1f6f3",
    padding: 14,
    gap: 4,
  },
  rankingReasonTitle: { color: "#174d38", fontSize: 15, fontWeight: "800" },
  noDriverBox: {
    borderRadius: 14,
    backgroundColor: "#fff4ec",
    padding: 14,
    gap: 10,
  },
  noDriverTitle: { color: "#8a4319", fontSize: 17, fontWeight: "800" },
  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 9,
  },
  cashIcon: { color: "#05875e", fontSize: 30 },
  label: { fontSize: 13, fontWeight: "600", color: "#53665c", marginBottom: 6 },
  input: {
    borderColor: "#d4ded7",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#163528",
    backgroundColor: "#fff",
  },
  button: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#05875e",
    alignItems: "center",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  secondary: { backgroundColor: "#e9eee9" },
  dark: { color: "#234535" },
  disabled: { opacity: 0.45 },
  bottomTabs: {
    flexDirection: "row",
    backgroundColor: "#fff",
    padding: 6,
    borderRadius: 28,
    borderColor: "#e2e8e4",
    borderWidth: 1,
    marginHorizontal: 22,
    marginTop: 8,
    marginBottom: 8,
  },
  bottomTab: { flex: 1, padding: 9, borderRadius: 22, alignItems: "center" },
  activeBottomTab: { backgroundColor: "#edf1ee" },
  tabIcon: { fontSize: 20, color: "#20392b" },
  tabText: { fontWeight: "700", color: "#20392b" },
  error: { color: "#a52728", fontSize: 14, lineHeight: 21 },
  success: {
    backgroundColor: "#def3e8",
    padding: 18,
    borderRadius: 18,
    gap: 7,
  },
  footer: {
    fontSize: 11,
    textAlign: "center",
    color: "#7a877f",
    marginTop: 12,
  },
});
