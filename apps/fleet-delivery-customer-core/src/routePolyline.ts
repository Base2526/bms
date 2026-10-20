export type RouteCoordinate = { latitude: number; longitude: number };

/** Decodes Google's encoded polyline format with strict bounds for untrusted provider data. */
export function decodeGoogleRoutePolyline(encoded: string): RouteCoordinate[] {
  if (encoded.length < 2 || encoded.length > 100000)
    throw new Error("INVALID_ROUTE_POLYLINE");
  const points: RouteCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const value = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length || shift > 30)
        throw new Error("INVALID_ROUTE_POLYLINE");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error("INVALID_ROUTE_POLYLINE");
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    latitude += value();
    longitude += value();
    const point = {
      latitude: latitude / 100000,
      longitude: longitude / 100000,
    };
    if (
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      point.latitude < 13 ||
      point.latitude > 15 ||
      point.longitude < 99 ||
      point.longitude > 102 ||
      points.length >= 10000
    )
      throw new Error("INVALID_ROUTE_POLYLINE");
    points.push(point);
  }
  if (points.length < 2) throw new Error("INVALID_ROUTE_POLYLINE");
  return points;
}
