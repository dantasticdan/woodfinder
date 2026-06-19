const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function addDistance(listings, originLat, originLng) {
  return listings.map((listing) => {
    if (listing.lat == null || listing.lng == null) {
      return { ...listing, distanceKm: null };
    }
    return {
      ...listing,
      distanceKm: Math.round(haversineKm(originLat, originLng, listing.lat, listing.lng) * 10) / 10,
    };
  });
}

function filterByRadius(listings, radiusKm) {
  return listings.filter(
    (listing) => listing.distanceKm != null && listing.distanceKm <= radiusKm
  );
}

const DATE_LISTED_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function filterByDateListed(listings, listed) {
  const maxAgeMs = DATE_LISTED_MS[listed];
  if (!maxAgeMs) return listings;
  const cutoff = Date.now() - maxAgeMs;
  return listings.filter((listing) => {
    if (!listing.postedAt) return false;
    return new Date(listing.postedAt).getTime() >= cutoff;
  });
}

function sortListings(listings, sort, direction) {
  const copy = [...listings];

  if (sort === 'distance') {
    copy.sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      const cmp = a.distanceKm - b.distanceKm;
      return direction === 'desc' ? -cmp : cmp;
    });
  } else if (sort === 'location') {
    copy.sort((a, b) => {
      const la = (a.locationText || '').toLowerCase();
      const lb = (b.locationText || '').toLowerCase();
      const cmp = la.localeCompare(lb);
      return direction === 'desc' ? -cmp : cmp;
    });
  } else {
    copy.sort((a, b) => {
      const da = a.postedAt ? new Date(a.postedAt).getTime() : 0;
      const db = b.postedAt ? new Date(b.postedAt).getTime() : 0;
      return direction === 'asc' ? da - db : db - da;
    });
  }
  return copy;
}

module.exports = { haversineKm, addDistance, filterByRadius, filterByDateListed, sortListings };
