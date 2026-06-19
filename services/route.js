const { haversineKm } = require('./distance');

const GOOGLE_MAX_WAYPOINTS_DESKTOP = 9;
const GOOGLE_MAX_WAYPOINTS_MOBILE = 3;

function formatCoord(lat, lng) {
  return `${lat},${lng}`;
}

function nearestNeighborOrder(origin, stops) {
  const remaining = [...stops];
  const ordered = [];
  let current = { lat: origin.lat, lng: origin.lng };
  let totalKm = 0;

  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    totalKm += bestDist;
    ordered.push({ ...next, legKm: Math.round(bestDist * 10) / 10 });
    current = { lat: next.lat, lng: next.lng };
  }

  return {
    stops: ordered,
    totalKm: Math.round(totalKm * 10) / 10,
  };
}

function buildGoogleMapsUrl(origin, stops) {
  if (!stops.length) return null;
  const originStr = encodeURIComponent(formatCoord(origin.lat, origin.lng));
  const last = stops[stops.length - 1];
  const destination = encodeURIComponent(formatCoord(last.lat, last.lng));
  const waypoints = stops
    .slice(0, -1)
    .map((s) => encodeURIComponent(formatCoord(s.lat, s.lng)))
    .join('%7C');

  let url = `https://www.google.com/maps/dir/?api=1&origin=${originStr}&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
}

function buildAppleMapsUrl(origin, stops) {
  if (!stops.length) return null;
  const last = stops[stops.length - 1];
  const params = new URLSearchParams();
  params.set('source', formatCoord(origin.lat, origin.lng));
  params.set('destination', formatCoord(last.lat, last.lng));
  params.set('mode', 'driving');
  for (const stop of stops.slice(0, -1)) {
    params.append('waypoint', formatCoord(stop.lat, stop.lng));
  }
  return `https://maps.apple.com/directions?${params.toString()}`;
}

function buildRoute(origin, listings, provider) {
  const routable = listings.filter((l) => l.lat != null && l.lng != null);
  if (!routable.length) {
    return { error: 'No selected listings have coordinates for routing.' };
  }

  const { stops: ordered, totalKm: fullTotalKm } = nearestNeighborOrder(origin, routable);
  const truncated = ordered.length > GOOGLE_MAX_WAYPOINTS_DESKTOP;
  const stops = truncated ? ordered.slice(0, GOOGLE_MAX_WAYPOINTS_DESKTOP) : ordered;
  const totalKm = truncated
    ? Math.round(stops.reduce((sum, s) => sum + s.legKm, 0) * 10) / 10
    : fullTotalKm;
  const mapsUrl =
    provider === 'apple'
      ? buildAppleMapsUrl(origin, stops)
      : buildGoogleMapsUrl(origin, stops);

  return {
    stops: stops.map((s, i) => ({
      order: i + 1,
      id: s.id,
      title: s.title,
      lat: s.lat,
      lng: s.lng,
      legKm: s.legKm,
    })),
    totalKm,
    approximate: true,
    truncated,
    mapsUrl,
    limits: {
      googleDesktopMaxWaypoints: GOOGLE_MAX_WAYPOINTS_DESKTOP,
      googleMobileMaxWaypoints: GOOGLE_MAX_WAYPOINTS_MOBILE,
      stopCount: stops.length,
      selectedCount: routable.length,
    },
  };
}

module.exports = {
  nearestNeighborOrder,
  buildGoogleMapsUrl,
  buildAppleMapsUrl,
  buildRoute,
  GOOGLE_MAX_WAYPOINTS_DESKTOP,
  GOOGLE_MAX_WAYPOINTS_MOBILE,
};
