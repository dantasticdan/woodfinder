const express = require('express');
const { scrapeKijiji } = require('../scrapers/kijiji');
const { geocodeAddress } = require('../services/geocode');
const { sortListings, filterByDateListed } = require('../services/distance');
const { buildRoute } = require('../services/route');

const router = express.Router();

const searchResults = new Map();

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function resolveSearchCoords(req) {
  let { lat, lng, address } = req.query;

  if (address && (!lat || !lng)) {
    const geo = await geocodeAddress(address);
    if (!geo) {
      return { error: 'Could not geocode that address.', status: 400 };
    }
    lat = geo.lat;
    lng = geo.lng;
  }

  lat = parseFloat(lat);
  lng = parseFloat(lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return { error: 'lat and lng are required (or provide address).', status: 400 };
  }

  return { lat, lng };
}

function parseSearchOptions(req) {
  const radiusKm = Math.min(Math.max(parseFloat(req.query.radius) || 25, 5), 100);
  const sortBy = ['distance', 'location', 'date'].includes(req.query.sort) ? req.query.sort : 'distance';
  const defaultDir = sortBy === 'date' ? 'desc' : 'asc';
  const sortDir =
    req.query.dir === 'asc' || req.query.dir === 'desc' ? req.query.dir : defaultDir;
  const dateListed = ['24h', '7d', '30d'].includes(req.query.listed) ? req.query.listed : '7d';
  const searchKeywords = req.query.keywords || process.env.SEARCH_KEYWORDS || 'free firewood';

  return { radiusKm, sortBy, sortDir, dateListed, searchKeywords };
}

async function executeSearch(req, onProgress) {
  const coords = await resolveSearchCoords(req);
  if (coords.error) return coords;

  const { radiusKm, sortBy, sortDir, dateListed, searchKeywords } = parseSearchOptions(req);
  const { lat, lng } = coords;

  if (onProgress && req.query.address && !req.query.lat) {
    onProgress({ phase: 'geocoding', percent: 1, message: 'Geocoding address…' });
  }

  const { listings, meta } = await scrapeKijiji({
    lat,
    lng,
    radiusKm,
    keywords: searchKeywords,
    onProgress,
  });

  const filtered = filterByDateListed(listings, dateListed);
  const sorted = sortListings(filtered, sortBy, sortDir);
  const searchId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  searchResults.set(searchId, {
    listings: sorted,
    origin: { lat, lng },
    expiresAt: Date.now() + 30 * 60 * 1000,
  });

  return {
    searchId,
    listings: sorted,
    meta: { ...meta, count: sorted.length, radiusKm, sort: sortBy, sortDir, dateListed, lat, lng },
  };
}

async function streamSearch(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(': connected\n\n');
  res.flushHeaders?.();

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  const onProgress = (progress) => {
    if (!closed) sendSse(res, 'progress', progress);
  };

  try {
    const result = await executeSearch(req, onProgress);
    if (result.error) {
      sendSse(res, 'search-error', { error: result.error });
      return res.end();
    }
    if (!closed) {
      sendSse(res, 'result', result);
      res.end();
    }
  } catch (err) {
    console.error('Search error:', err);
    if (!closed) {
      sendSse(res, 'search-error', {
        error: 'Failed to search Kijiji. Try again later.',
        detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
      res.end();
    }
  }
}

router.get('/search', async (req, res) => {
  if (req.query.stream === '1') {
    return streamSearch(req, res);
  }

  try {
    const result = await executeSearch(req);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({
      error: 'Failed to search Kijiji. Try again later.',
      detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

router.post('/route', (req, res) => {
  try {
    const { origin, listingIds, listings: inlineListings, provider = 'google', searchId } = req.body;

    let selected = inlineListings;
    if (searchId && searchResults.has(searchId)) {
      const session = searchResults.get(searchId);
      if (Date.now() > session.expiresAt) {
        searchResults.delete(searchId);
        return res.status(410).json({ error: 'Search session expired. Run search again.' });
      }
      const idSet = new Set(listingIds || []);
      selected = session.listings.filter((l) => idSet.has(l.id));
      if (!origin && session.origin) {
        req.body.origin = session.origin;
      }
    }

    const routeOrigin = origin || req.body.origin;
    if (!routeOrigin?.lat || !routeOrigin?.lng) {
      return res.status(400).json({ error: 'origin with lat/lng is required.' });
    }
    if (!selected?.length) {
      return res.status(400).json({ error: 'No listings selected for route.' });
    }

    const result = buildRoute(routeOrigin, selected, provider);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    console.error('Route error:', err);
    res.status(500).json({ error: 'Failed to build route.' });
  }
});

router.get('/geocode', async (req, res) => {
  try {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'address query param required.' });
    const geo = await geocodeAddress(address);
    if (!geo) return res.status(404).json({ error: 'Address not found.' });
    res.json(geo);
  } catch (err) {
    res.status(500).json({ error: 'Geocoding failed.' });
  }
});

module.exports = router;
