const express = require('express');
const { scrapeKijiji } = require('../scrapers/kijiji');
const { geocodeAddress } = require('../services/geocode');
const { sortListings, filterByDateListed } = require('../services/distance');
const { buildRoute } = require('../services/route');

const router = express.Router();

const searchResults = new Map();

router.get('/search', async (req, res) => {
  try {
    let { lat, lng, radius, keywords, sort, address, listed } = req.query;
    const radiusKm = Math.min(Math.max(parseFloat(radius) || 25, 5), 100);
    const sortBy = ['distance', 'location', 'date'].includes(sort) ? sort : 'distance';
    const defaultDir = sortBy === 'date' ? 'desc' : 'asc';
    const sortDir = req.query.dir === 'asc' || req.query.dir === 'desc' ? req.query.dir : defaultDir;
    const dateListed = ['24h', '7d', '30d'].includes(listed) ? listed : '7d';
    const searchKeywords = keywords || process.env.SEARCH_KEYWORDS || 'free firewood';

    if (address && (!lat || !lng)) {
      const geo = await geocodeAddress(address);
      if (!geo) {
        return res.status(400).json({ error: 'Could not geocode that address.' });
      }
      lat = geo.lat;
      lng = geo.lng;
    }

    lat = parseFloat(lat);
    lng = parseFloat(lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng are required (or provide address).' });
    }

    const { listings, meta } = await scrapeKijiji({
      lat,
      lng,
      radiusKm,
      keywords: searchKeywords,
    });

    const filtered = filterByDateListed(listings, dateListed);
    const sorted = sortListings(filtered, sortBy, sortDir);
    const searchId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    searchResults.set(searchId, {
      listings: sorted,
      origin: { lat, lng },
      expiresAt: Date.now() + 30 * 60 * 1000,
    });

    res.json({
      searchId,
      listings: sorted,
      meta: { ...meta, count: sorted.length, radiusKm, sort: sortBy, sortDir, dateListed, lat, lng },
    });
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
