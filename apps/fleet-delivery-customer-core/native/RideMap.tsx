import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  type ImageSourcePropType,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import Geolocation, {
  type GeolocationResponse,
} from "@react-native-community/geolocation";
import {
  rideLocationSchema,
  type RidePoint,
  type RideRoadRoute,
  type RideSnapshot,
} from "@bms/fleet-delivery-contracts";
import type { RideSandboxClient } from "../src/rideSandbox";
import { decodeGoogleRoutePolyline } from "../src/routePolyline";

export type RideNativeEnvironment = {
  rideSimulator?: boolean;
  rideMapsConfigured?: boolean;
  rideMotorbikeArtwork?: ImageSourcePropType;
};
type Props = {
  environment: RideNativeEnvironment;
  client: RideSandboxClient;
  snapshot: RideSnapshot;
  pickup: RidePoint;
  dropoff: RidePoint;
  selecting: "pickup" | "dropoff" | null;
  onPick: (p: RidePoint) => void;
  onError: (e: unknown) => void;
  onConsent: () => void;
  initialConsent?: boolean;
  mode?: "default" | "pin" | "review";
  onBack?: () => void;
  roadRoute?: RideRoadRoute | null;
};
function MapAction({
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
      style={[
        styles.action,
        secondary && styles.secondaryAction,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionText, secondary && styles.secondaryText]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function RideMap({
  environment,
  client,
  snapshot,
  pickup,
  dropoff,
  selecting,
  onPick,
  onError,
  onConsent,
  initialConsent = false,
  mode = "default",
  onBack,
  roadRoute = null,
}: Props) {
  const [consented, setConsented] = useState(initialConsent);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState("");
  const [own, setOwn] = useState<RidePoint | null>(null);
  const map = useRef<MapView>(null);
  const role = snapshot.account.role;
  const online = snapshot.account.online;
  const callback = useRef({ onError, onPick });
  callback.current = { onError, onPick };
  const mapsSetupHint =
    Platform.OS === "android"
      ? "ตั้ง BMS_GOOGLE_MAPS_ANDROID_API_KEY ก่อน build Android ใหม่ — Routes key ใช้แทนไม่ได้"
      : "ตั้ง BMS_GOOGLE_MAPS_IOS_API_KEY ก่อนเปิด iOS Simulator ใหม่ — Routes key ใช้แทนไม่ได้";
  useEffect(() => {
    if (
      !locating ||
      !__DEV__ ||
      environment.rideSimulator !== true ||
      (role === "DRIVER" && !online)
    )
      return;
    let stopped = false;
    let inFlight = false;
    Geolocation.setRNConfiguration({
      skipPermissionRequests: true,
      authorizationLevel: "whenInUse",
      enableBackgroundLocationUpdates: false,
    });
    const poll = async () => {
      if (stopped || inFlight || AppState.currentState !== "active") return;
      inFlight = true;
      try {
        const position = await new Promise<GeolocationResponse>(
          (resolve, reject) =>
            Geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0,
            }),
        );
        if (stopped) return;
        const fix = rideLocationSchema.parse({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
          source: "SIMULATOR",
        });
        if (
          Date.now() - position.timestamp > 60000 ||
          position.timestamp > Date.now() + 10000
        )
          throw new Error("LOCATION_STALE_OR_FUTURE");
        const point = {
          label: "ตำแหน่ง Simulator",
          lat: fix.lat,
          lng: fix.lng,
        };
        setOwn(point);
        setNotice(
          `ตำแหน่ง OS Simulator · ±${Math.round(
            fix.accuracyM,
          )} เมตร (ไม่ใช่ GPS เครื่องจริง)`,
        );
        if (role === "DRIVER") await client.location(fix);
        else {
          callback.current.onPick(point);
          setLocating(false);
        }
      } catch (e) {
        if (!stopped) {
          setLocating(false);
          setOwn(null);
          setNotice(
            "อ่านตำแหน่งไม่สำเร็จ — ตรวจ permission / พิกัดกรุงเทพฯ ใน Simulator",
          );
          callback.current.onError(e);
        }
      } finally {
        inFlight = false;
        if (stopped && role === "DRIVER")
          void client.location(null).catch(() => {});
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 10000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        stopped = true;
        setLocating(false);
        setOwn(null);
        setNotice(
          "หยุดส่งตำแหน่งเมื่อเข้า background — กดเปิดอีกครั้งเมื่อต้องการ",
        );
      }
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      listener.remove();
      // Best effort only; server freshness removes unavailable devices independently.
      if (role === "DRIVER") void client.location(null).catch(() => {});
    };
  }, [locating, environment.rideSimulator, role, online, client]);
  useEffect(() => {
    if (!online && role === "DRIVER") {
      setLocating(false);
      setOwn(null);
    }
  }, [online, role]);
  async function startLocation() {
    if (!__DEV__ || environment.rideSimulator !== true) {
      setNotice("GPS เครื่องจริงยังปิด รอ Privacy/Legal approval");
      return;
    }
    try {
      if (Platform.OS === "android") {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);
        if (
          result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] !==
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
          Geolocation.requestAuthorization(resolve, reject),
        );
      }
      setLocating(true);
    } catch {
      setNotice("ไม่ได้รับสิทธิ์ตำแหน่ง — เลือกจุดบนแผนที่แทนได้");
    }
  }
  const driver = snapshot.driverLocation;
  const current = snapshot.current;
  const start = current?.pickup ?? pickup;
  const end = current?.dropoff ?? dropoff;
  const selected = selecting === "pickup" ? pickup : dropoff;
  const pinMode = mode === "pin" && !!selecting && !current;
  const reviewMode = mode === "review" && !current;
  const roadCoordinates = useMemo(
    () =>
      roadRoute ? decodeGoogleRoutePolyline(roadRoute.encodedPolyline) : [],
    [roadRoute],
  );
  useEffect(() => {
    if (consented && !pinMode)
      map.current?.fitToCoordinates(
        reviewMode && roadCoordinates.length > 1
          ? roadCoordinates
          : [
              { latitude: start.lat, longitude: start.lng },
              { latitude: end.lat, longitude: end.lng },
            ],
        {
          edgePadding: { top: 45, right: 45, bottom: 45, left: 45 },
          animated: true,
        },
      );
  }, [
    consented,
    pinMode,
    reviewMode,
    roadCoordinates,
    start.lat,
    start.lng,
    end.lat,
    end.lng,
  ]);
  return (
    <View
      style={[
        styles.container,
        (pinMode || reviewMode) && styles.fullMapContainer,
      ]}
    >
      {!consented ? (
        <View style={styles.mapGate}>
          <Text style={styles.gateTitle}>
            {environment.rideMapsConfigured
              ? "เปิดแผนที่สำหรับทดสอบ"
              : "Google Maps ยังไม่พร้อม"}
          </Text>
          <Text style={styles.detail}>
            {environment.rideMapsConfigured
              ? "เมื่อเปิดแผนที่ Google จะได้รับ IP และบริเวณที่ดู ใช้เฉพาะสถานที่สาธารณะทดสอบ"
              : mapsSetupHint}
          </Text>
          <MapAction
            title="เปิด Google Maps สำหรับทดสอบ"
            disabled={!environment.rideMapsConfigured}
            onPress={() => {
              setConsented(true);
              onConsent();
            }}
          />
          <Text style={styles.caption}>
            ไม่แสดงแผนที่ปลอมหรือเปลี่ยน provider อัตโนมัติ
          </Text>
        </View>
      ) : (
        <>
          <View
            style={[
              styles.mapFrame,
              pinMode && styles.pinMapFrame,
              reviewMode && styles.reviewMapFrame,
            ]}
          >
            <MapView
              ref={map}
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={{
                latitude: pinMode ? selected.lat : start.lat,
                longitude: pinMode ? selected.lng : start.lng,
                latitudeDelta: pinMode ? 0.012 : 0.04,
                longitudeDelta: pinMode ? 0.012 : 0.04,
              }}
              showsUserLocation={false}
              showsMyLocationButton={false}
              onPress={(e) => {
                if (selecting && !current && !pinMode)
                  onPick({
                    label: `หมุด${
                      selecting === "pickup" ? "จุดรับ" : "ปลายทาง"
                    }`,
                    lat: e.nativeEvent.coordinate.latitude,
                    lng: e.nativeEvent.coordinate.longitude,
                  });
              }}
              onRegionChangeComplete={(region) => {
                if (pinMode)
                  onPick({
                    label: selected.label,
                    lat: region.latitude,
                    lng: region.longitude,
                  });
              }}
            >
              {!pinMode && (
                <>
                  {reviewMode && roadCoordinates.length > 1 && (
                    <Polyline
                      coordinates={roadCoordinates}
                      strokeColor="#087653"
                      strokeWidth={6}
                    />
                  )}
                  <Marker
                    identifier="pickup"
                    title={`จุดรับ: ${start.label}`}
                    coordinate={{ latitude: start.lat, longitude: start.lng }}
                    pinColor="#16a66a"
                  />
                  <Marker
                    identifier="dropoff"
                    title={`ปลายทาง: ${end.label}`}
                    coordinate={{ latitude: end.lat, longitude: end.lng }}
                    pinColor="#202729"
                  />
                  {driver && (
                    <Marker
                      identifier="driver"
                      title="คนขับ · ตำแหน่ง Simulator ล่าสุด"
                      coordinate={{
                        latitude: driver.lat,
                        longitude: driver.lng,
                      }}
                      pinColor="#2468ee"
                    />
                  )}
                  {own && !driver && (
                    <Marker
                      identifier="self"
                      title="ตำแหน่ง Simulator"
                      coordinate={{ latitude: own.lat, longitude: own.lng }}
                    />
                  )}
                </>
              )}
            </MapView>
            {pinMode && (
              <>
                {!!onBack && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="กลับไปหน้าเส้นทาง"
                    onPress={onBack}
                    style={styles.mapBack}
                  >
                    <Text style={styles.mapBackText}>‹</Text>
                  </Pressable>
                )}
                <View
                  accessibilityLabel="หมุดกลางแผนที่"
                  pointerEvents="none"
                  style={styles.centerPin}
                >
                  <View style={styles.pinHead}>
                    <View style={styles.pinCore} />
                  </View>
                  <View style={styles.pinStem} />
                  <View style={styles.pinShadow} />
                </View>
              </>
            )}
            {reviewMode && (
              <View style={styles.routeOverlay}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="แก้ไขเส้นทาง"
                  onPress={onBack}
                >
                  <Text style={styles.routeOverlayClose}>×</Text>
                </Pressable>
                <Text style={styles.routeOverlayText} numberOfLines={1}>
                  {start.label} → {end.label}
                </Text>
                <Text style={styles.routeOverlayAdd}>＋</Text>
              </View>
            )}
          </View>
          {!pinMode && !reviewMode && (
            <>
              <MapAction
                title="ดูจุดรับและปลายทางทั้งหมด"
                secondary
                onPress={() =>
                  map.current?.fitToCoordinates(
                    [
                      { latitude: start.lat, longitude: start.lng },
                      { latitude: end.lat, longitude: end.lng },
                    ],
                    {
                      edgePadding: { top: 45, right: 45, bottom: 45, left: 45 },
                      animated: true,
                    },
                  )
                }
              />
              <Text style={styles.detail}>
                {selecting
                  ? "แตะบนแผนที่เพื่อเลือกหมุด แล้วตรวจจุดรับ/ส่งก่อนเรียกรถ"
                  : "หมุดรับ–ส่งเท่านั้น ไม่มีเส้นทางนำทางหรือ ETA จากถนนจริง"}
              </Text>
            </>
          )}
        </>
      )}
      {!pinMode && !reviewMode && (
        <>
          <MapAction
            title={
              locating
                ? "หยุดส่งตำแหน่ง"
                : "ใช้ตำแหน่ง OS Simulator (foreground)"
            }
            disabled={
              !environment.rideSimulator || (role === "DRIVER" && !online)
            }
            onPress={() => {
              if (locating) {
                setLocating(false);
                setOwn(null);
                setNotice("หยุดส่งตำแหน่งแล้ว");
              } else void startLocation();
            }}
          />
          {!environment.rideSimulator && (
            <Text style={styles.caption}>
              GPS เครื่องจริงยังปิดตาม Privacy gate
            </Text>
          )}
        </>
      )}
      {!!notice && <Text style={styles.detail}>{notice}</Text>}
      {role === "DRIVER" && online && !driver && (
        <Text style={styles.detail}>
          ยังไม่มีตำแหน่งใหม่ที่ใช้จับคู่ได้
          ต้องเปิดตำแหน่งก่อนจึงเห็นงานใกล้ตัว
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  fullMapContainer: { flex: 1 },
  mapGate: {
    minHeight: 210,
    justifyContent: "center",
    gap: 12,
    padding: 22,
    borderRadius: 22,
    backgroundColor: "#eef2ef",
  },
  gateTitle: { fontSize: 22, fontWeight: "800", color: "#17362a" },
  detail: { fontSize: 14, lineHeight: 21, color: "#52665d" },
  caption: { fontSize: 12, lineHeight: 18, color: "#738078" },
  mapFrame: { height: 300, borderRadius: 22, overflow: "hidden" },
  pinMapFrame: { height: "auto", minHeight: 430, flex: 1, borderRadius: 0 },
  reviewMapFrame: {
    height: "auto",
    minHeight: 460,
    flex: 1,
    borderRadius: 0,
  },
  map: { flex: 1 },
  routeOverlay: {
    position: "absolute",
    top: 18,
    left: 18,
    right: 18,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 5,
  },
  routeOverlayClose: { color: "#172720", fontSize: 35, lineHeight: 38 },
  routeOverlayText: {
    flex: 1,
    color: "#176b4c",
    fontSize: 17,
    fontWeight: "800",
  },
  routeOverlayAdd: { color: "#172720", fontSize: 30, lineHeight: 36 },
  mapBack: {
    position: "absolute",
    top: 22,
    left: 22,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 5,
  },
  mapBackText: { color: "#152922", fontSize: 42, lineHeight: 44 },
  centerPin: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 70,
    height: 92,
    marginLeft: -35,
    marginTop: -72,
    alignItems: "center",
  },
  pinHead: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#0f3829",
    alignItems: "center",
    justifyContent: "center",
  },
  pinCore: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#fff",
  },
  pinStem: { width: 8, height: 25, backgroundColor: "#0f3829" },
  pinShadow: {
    width: 24,
    height: 8,
    marginTop: -2,
    borderRadius: 12,
    backgroundColor: "rgba(15,56,41,0.22)",
  },
  action: {
    padding: 15,
    borderRadius: 15,
    alignItems: "center",
    backgroundColor: "#05875e",
  },
  actionText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  secondaryAction: { backgroundColor: "#e6ece8" },
  secondaryText: { color: "#244b39" },
  disabled: { opacity: 0.42 },
});
