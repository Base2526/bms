import assert from "node:assert/strict";
import test from "node:test";
import { decodeGoogleRoutePolyline } from "./routePolyline.js";

test("Google route polyline decoder is bounded and rejects malformed or out-of-pilot data", () => {
  // Encoded with the documented algorithm for two Bangkok points.
  const points = decodeGoogleRoutePolyline("ky{rA{trdRzw@k~C");
  assert.equal(points.length, 2);
  assert.deepEqual(points[0], { latitude: 13.7463, longitude: 100.5347 });
  assert.deepEqual(points[1], { latitude: 13.7372, longitude: 100.5602 });
  assert.throws(
    () => decodeGoogleRoutePolyline("bad"),
    /INVALID_ROUTE_POLYLINE/,
  );
  assert.throws(
    () => decodeGoogleRoutePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"),
    /INVALID_ROUTE_POLYLINE/,
  );
});
