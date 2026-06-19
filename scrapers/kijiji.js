const { chromium } = require('playwright');
const { reverseGeocode, geocodeLocationText } = require('../services/geocode');
const { addDistance, filterByRadius } = require('../services/distance');
const cache = require('../services/cache');

const MAX_PAGES = parseInt(process.env.MAX_SEARCH_PAGES, 10) || 3;
const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false';
const DEFAULT_KEYWORDS = process.env.SEARCH_KEYWORDS || 'free firewood';

// Kijiji location slugs and IDs (c{categoryId}l{locationId} — category 0 = all)
const LOCATION_MAP = {
  calgary: { slug: 'calgary', locationId: '1700199' },
  edmonton: { slug: 'edmonton', locationId: '1700206' },
  toronto: { slug: 'toronto', locationId: '1700273' },
  ottawa: { slug: 'ottawa', locationId: '1700185' },
  montreal: { slug: 'ville-de-montreal', locationId: '1700281' },
  vancouver: { slug: 'vancouver', locationId: '1700264' },
  victoria: { slug: 'victoria', locationId: '1700265' },
  winnipeg: { slug: 'winnipeg', locationId: '1700194' },
  halifax: { slug: 'halifax', locationId: '1700173' },
  regina: { slug: 'regina', locationId: '1700212' },
  saskatoon: { slug: 'saskatoon', locationId: '1700213' },
};

let scrapeLock = Promise.resolve();

function withLock(fn) {
  const run = scrapeLock.then(fn);
  scrapeLock = run.catch(() => {});
  return run;
}

function normalizeCity(city) {
  if (!city) return null;
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim();
}

function resolveLocation(city) {
  const key = normalizeCity(city);
  if (!key) return { slug: 'canada', locationId: '0' };
  for (const [name, loc] of Object.entries(LOCATION_MAP)) {
    if (key.includes(name) || name.includes(key)) return loc;
  }
  return { slug: 'canada', locationId: '0' };
}

function keywordSlug(keywords) {
  return keywords
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

function buildSearchUrl({ keywords, radiusKm, locationSlug, locationId, page = 1 }) {
  const slug = keywordSlug(keywords);
  const radius = Number(radiusKm).toFixed(1);
  const pagePart = page > 1 ? `/page-${page}` : '';
  const base = `https://www.kijiji.ca/b-${locationSlug}/${slug}${pagePart}/k0l${locationId}`;
  return `${base}?radius=${radius}&sort=dateDesc`;
}

function isFreeFirewood(listing) {
  const text = `${listing.title} ${listing.description || ''}`.toLowerCase();
  const hasFirewood =
    text.includes('firewood') || text.includes('fire wood') || /\bfree\s+wood\b/.test(text);
  if (!hasFirewood) return false;

  const priceText = (listing.price || '').trim().toLowerCase();
  if (!priceText || priceText === 'please contact' || text.includes('please contact')) {
    return false;
  }

  return (
    priceText === 'free' ||
    priceText === '$0' ||
    priceText === '$0.00' ||
    /\$0\b/.test(priceText)
  );
}

function parsePostedDate(raw) {
  if (!raw) return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();

  const lower = trimmed.toLowerCase();
  const now = new Date();
  if (lower.includes('yesterday')) {
    now.setDate(now.getDate() - 1);
    return now.toISOString();
  }
  if (lower.includes('just now')) return now.toISOString();

  const rel = lower.match(
    /(\d+)\s*(s|sec|second|min|minute|h|hr|hour|d|day|wk|week|mo|month)s?(?:\s*ago)?/
  );
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2][0];
    const d = new Date(now);
    if (unit === 's') d.setSeconds(d.getSeconds() - n);
    else if (unit === 'm') d.setMinutes(d.getMinutes() - n);
    else if (unit === 'h') d.setHours(d.getHours() - n);
    else if (unit === 'd') d.setDate(d.getDate() - n);
    else if (unit === 'w') d.setDate(d.getDate() - n * 7);
    else if (unit === 'o') d.setMonth(d.getMonth() - n);
    return d.toISOString();
  }
  return null;
}

async function extractEmbeddedListings(page) {
  return page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script')].map((s) => s.textContent || '').join('\n');
    const map = {};
    const re =
      /"url":"https:\/\/www\.kijiji\.ca\/[^"]+\/(\d+)"[\s\S]{0,800}?"sortingDate":"([^"]+)"[\s\S]{0,800}?"location":\{[\s\S]{0,600}?"address":"([^"]*)"[\s\S]{0,300}?"coordinates":\{"__typename":"LocationCoordinates","latitude":([-\d.]+),"longitude":([-\d.]+)\}/g;
    let m;
    while ((m = re.exec(scripts)) !== null) {
      map[m[1]] = {
        postedAt: m[2],
        address: m[3] || null,
        lat: parseFloat(m[4]),
        lng: parseFloat(m[5]),
      };
    }

    const reNoCoords =
      /"url":"https:\/\/www\.kijiji\.ca\/[^"]+\/(\d+)"[\s\S]{0,800}?"sortingDate":"([^"]+)"[\s\S]{0,800}?"location":\{[\s\S]{0,400}?"address":"([^"]*)"/g;
    while ((m = reNoCoords.exec(scripts)) !== null) {
      if (!map[m[1]]) {
        map[m[1]] = { postedAt: m[2], address: m[3] || null, lat: null, lng: null };
      }
    }

    return map;
  });
}

function extractListingId(url) {
  const m = url && url.match(/\/(\d+)(?:\?|$)/);
  return m ? m[1] : null;
}

async function dismissBanners(page) {
  const selectors = [
    'button:has-text("Reject All")',
    'button:has-text("Accept")',
    'button:has-text("I Agree")',
  ];
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(500);
      break;
    }
  }
}

async function parseSearchPage(page) {
  const embedded = await extractEmbeddedListings(page);
  const cards = await page.evaluate(() => {
    const results = [];
    const nodes = document.querySelectorAll('[data-testid="listing-card"]');

    nodes.forEach((card) => {
      const link = card.querySelector('[data-testid="listing-link"]');
      if (!link?.href) return;

      const listingId = card.getAttribute('data-listingid');
      const url = link.href.split('?')[0];
      const title = (link.textContent || '').trim();
      const priceEl =
        card.querySelector('[data-testid="listing-price"], [data-testid="autos-listing-price"]');
      const price = priceEl ? priceEl.textContent.trim() : '';
      const locEl = card.querySelector('[data-testid="listing-location"]');
      const locationText = locEl ? locEl.textContent.trim() : '';
      const img = card.querySelector('[data-testid="listing-card-image"], img');
      const imageUrl = img ? img.src : null;
      const dateEl = card.querySelector('[data-testid="listing-date"], [data-testid="listing-date-mobile"], time');
      const postedText = dateEl
        ? dateEl.getAttribute('datetime') || dateEl.textContent.trim()
        : null;
      const descEl = card.querySelector('[data-testid="listing-description"]');
      const description = descEl ? descEl.textContent.trim() : '';

      results.push({
        listingId,
        url,
        title,
        price,
        locationText,
        imageUrl,
        postedText,
        description,
      });
    });

    return results;
  });

  return cards.map((card) => {
    const meta = card.listingId ? embedded[card.listingId] : null;
    return {
      ...card,
      postedAt: meta?.postedAt || parsePostedDate(card.postedText),
      locationText: meta?.address || card.locationText,
      lat: meta?.lat ?? null,
      lng: meta?.lng ?? null,
    };
  });
}

async function fetchDetailMeta(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(800);

    return page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script')].map((s) => s.textContent || '').join('\n');
      const sorting = scripts.match(/"sortingDate":"([^"]+)"/);
      const activation = scripts.match(/"activationDate":"([^"]+)"/);
      const latMatch = scripts.match(/"latitude":([-\d.]+),"longitude":([-\d.]+)/);
      const address = scripts.match(/"address":"([^"]*)"/);

      if (latMatch) {
        return {
          postedAt: sorting?.[1] || activation?.[1] || null,
          lat: parseFloat(latMatch[1]),
          lng: parseFloat(latMatch[2]),
          address: address?.[1] || null,
        };
      }

      const mapLink = document.querySelector('a[href*="maps.google"], a[href*="google.com/maps"]');
      if (mapLink) {
        const href = mapLink.getAttribute('href');
        const m = href.match(/@([-\d.]+),([-\d.]+)/) || href.match(/q=([-\d.]+),([-\d.]+)/);
        if (m) {
          return {
            postedAt: sorting?.[1] || activation?.[1] || null,
            lat: parseFloat(m[1]),
            lng: parseFloat(m[2]),
            address: address?.[1] || null,
          };
        }
      }

      if (sorting || activation) {
        return { postedAt: sorting?.[1] || activation?.[1], lat: null, lng: null, address: address?.[1] || null };
      }
      return null;
    });
  } catch {
    return null;
  }
}

function extractAddressHint(title, locationText) {
  const fromTitle = title?.match(/@\s*(.+)$/i);
  if (fromTitle) return fromTitle[1].trim();
  return locationText;
}

async function scrapeKijiji({ lat, lng, radiusKm, keywords = DEFAULT_KEYWORDS }) {
  const geo = await reverseGeocode(lat, lng);
  const location = resolveLocation(geo.city);
  const cacheKey = cache.makeKey(['kijiji', lat, lng, radiusKm, keywords, location.slug]);
  const { value, cached } = await cache.getOrSet(cacheKey, () =>
    withLock(() => runScrape({ lat, lng, radiusKm, keywords, location, geo }))
  );
  return { listings: value, meta: { cached, radiusKm, location: geo.city || location.slug } };
}

async function runScrape({ lat, lng, radiusKm, keywords, location, geo }) {
  let browser;
  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-CA',
    });
    const page = await context.newPage();

    const rawListings = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
      const url = buildSearchUrl({
        keywords,
        radiusKm,
        locationSlug: location.slug,
        locationId: location.locationId,
        page: p,
      });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await dismissBanners(page);
      await page.waitForSelector('[data-testid="listing-link"]', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const pageListings = await parseSearchPage(page);
      if (!pageListings.length) break;
      rawListings.push(...pageListings);
      if (pageListings.length < 20) break;
    }

    const filtered = rawListings.filter((l) => isFreeFirewood(l));
    const listings = [];

    const MAX_DETAIL_FETCHES = 12;
    let detailFetches = 0;

    for (const raw of filtered) {
      const numericId = extractListingId(raw.url);
      const id = numericId ? `kijiji-${numericId}` : `kijiji-${Buffer.from(raw.url).toString('base64').slice(0, 12)}`;

      let coords = raw.lat != null ? { lat: raw.lat, lng: raw.lng } : null;
      let postedAt = raw.postedAt;
      let locationText = raw.locationText || geo.city;

      if ((!coords || !postedAt) && numericId && detailFetches < MAX_DETAIL_FETCHES) {
        const detail = await fetchDetailMeta(page, raw.url);
        detailFetches += 1;
        await page.waitForTimeout(1000);
        if (detail) {
          if (!postedAt && detail.postedAt) postedAt = detail.postedAt;
          if (!coords?.lat && detail.lat != null) coords = { lat: detail.lat, lng: detail.lng };
          if (detail.address) locationText = detail.address;
        }
      }
      if (!coords) {
        const hint = extractAddressHint(raw.title, raw.locationText);
        if (hint) {
          coords = await geocodeLocationText(
            `${hint}, ${geo.city || 'Calgary'}, ${geo.province || 'Alberta'}, Canada`,
            lat,
            lng
          );
        }
      }

      listings.push({
        id,
        source: 'kijiji',
        title: raw.title,
        url: raw.url,
        postedAt: postedAt || null,
        locationText,
        price: raw.price,
        imageUrl: raw.imageUrl,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      });
    }

    const withDistance = addDistance(listings, lat, lng);
    return filterByRadius(withDistance, radiusKm);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrapeKijiji, buildSearchUrl, isFreeFirewood };
