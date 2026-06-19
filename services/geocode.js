const cache = require('./cache');

const USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'Woodfinder/1.0 (woodfinder-app)';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

// Nearest major city for Kijiji location slug when Nominatim is unavailable
const CITY_CENTERS = [
  { name: 'calgary', lat: 51.0447, lng: -114.0719 },
  { name: 'edmonton', lat: 53.5461, lng: -113.4938 },
  { name: 'toronto', lat: 43.6532, lng: -79.3832 },
  { name: 'ottawa', lat: 45.4215, lng: -75.6972 },
  { name: 'montreal', lat: 45.5017, lng: -73.5673 },
  { name: 'vancouver', lat: 49.2827, lng: -123.1207 },
  { name: 'victoria', lat: 48.4284, lng: -123.3656 },
  { name: 'winnipeg', lat: 49.8951, lng: -97.1384 },
  { name: 'halifax', lat: 44.6488, lng: -63.5752 },
  { name: 'regina', lat: 50.4452, lng: -104.6189 },
  { name: 'saskatoon', lat: 52.1332, lng: -106.6700 },
];

function nearestCity(lat, lng) {
  let best = CITY_CENTERS[0];
  let bestDist = Infinity;
  for (const c of CITY_CENTERS) {
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best.name;
}

let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100;

async function throttle() {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function nominatimFetch(path) {
  const key = cache.makeKey(['nominatim', path]);
  const cached = cache.get(key);
  if (cached) return cached;

  await throttle();
  const res = await fetch(`${NOMINATIM_BASE}${path}`, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Accept-Language': 'en-CA,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
  const data = await res.json();
  cache.set(key, data);
  return data;
}

async function reverseGeocode(lat, lng) {
  try {
    const data = await nominatimFetch(
      `/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`
    );
    const addr = data.address || {};
    return {
      displayName: data.display_name,
      city: addr.city || addr.town || addr.village || addr.municipality,
      province: addr.state || addr.province,
      postalCode: addr.postcode,
      country: addr.country_code,
    };
  } catch {
    const city = nearestCity(lat, lng);
    return { displayName: null, city, province: null, postalCode: null, country: 'ca' };
  }
}

async function geocodeAddress(query) {
  const encoded = encodeURIComponent(query);
  const results = await nominatimFetch(
    `/search?format=json&q=${encoded}&countrycodes=ca&limit=1`
  );
  if (!results.length) return null;
  const hit = results[0];
  return {
    lat: parseFloat(hit.lat),
    lng: parseFloat(hit.lon),
    displayName: hit.display_name,
  };
}

async function geocodeLocationText(locationText, nearLat, nearLng) {
  if (!locationText) return null;
  try {
    const near = nearLat != null ? `&lat=${nearLat}&lon=${nearLng}` : '';
    const encoded = encodeURIComponent(`${locationText}, Canada`);
    const results = await nominatimFetch(
      `/search?format=json&q=${encoded}&countrycodes=ca&limit=1${near}`
    );
    if (!results.length) return null;
    return {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
    };
  } catch {
    return null;
  }
}

module.exports = { reverseGeocode, geocodeAddress, geocodeLocationText, nearestCity };
