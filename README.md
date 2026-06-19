# Woodfinder

Find free firewood near you from Kijiji listings. Search by location, sort by date or distance, select prospects, and open an optimized pickup route in Google Maps or Apple Maps.

## Disclaimer

This app scrapes publicly visible Kijiji search results using a headless browser. Kijiji does not provide a public API for this use case. Scraping may be fragile (HTML changes, bot detection) and may conflict with [Kijiji's Terms of Use](https://www.kijiji.ca/terms-of-use). Use at your own risk for personal, non-commercial purposes. Always verify listings are still available before driving.

Facebook Marketplace is not included in v1.

## Features

- Search Kijiji for free firewood within a configurable radius (5–100 km)
- Geolocation or manual address/postal code
- Sort by date posted or distance
- Select listings and generate a nearest-neighbor pickup route
- Open route in Google Maps or Apple Maps (no API key required)

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```

Open http://localhost:3000

## Deploy on Render

Woodfinder needs a Node server and Playwright (Chromium). Use [Render](https://render.com) with the included Docker setup — static hosts like Netlify cannot run the scraper.

### Option 1: Blueprint (recommended)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint** and connect [dantasticdan/woodfinder](https://github.com/dantasticdan/woodfinder).
3. Render reads [`render.yaml`](render.yaml) and creates the web service.
4. Optional: in the service **Environment** tab, set `NOMINATIM_USER_AGENT` to include your contact email (required by [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)).
5. Deploy. Your app will be at `https://woodfinder.onrender.com` (or the name you choose).

### Option 2: Manual web service

1. **New → Web Service** → connect the GitHub repo.
2. **Runtime:** Docker (uses [`Dockerfile`](Dockerfile)).
3. **Branch:** `master`
4. Add the environment variables from [`.env.example`](.env.example).
5. Create Web Service.

### Notes

- **Free tier:** the service spins down after inactivity; the first search after idle can take 30–60 seconds (cold start + Kijiji scrape).
- **First search** may take 20–40 seconds while Playwright loads Kijiji; repeat searches within 15 minutes use cache and are much faster.
- Render sets `PORT` automatically; do not hardcode it.
- Remove or pause the Netlify site for this project to avoid confusion.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `SEARCH_KEYWORDS` | free firewood | Default search keywords |
| `MAX_SEARCH_PAGES` | 1 | Max Kijiji result pages per search |
| `MAX_DETAIL_FETCHES` | 0 | Extra listing page loads for missing coords (slow) |
| `CACHE_TTL_MINUTES` | 15 | Cache duration for search results |
| `ENABLE_GEOCODE_FALLBACK` | false | Geocode listing addresses when coords missing (slow) |
| `NOMINATIM_USER_AGENT` | Woodfinder/1.0 | Required by Nominatim usage policy |
| `PLAYWRIGHT_HEADLESS` | true | Set `false` to debug scraping |

## API

### `GET /api/search`

Query params: `lat`, `lng`, `radius`, `keywords`, `sort` (`date` | `distance`), or `address` instead of lat/lng.

### `POST /api/route`

```json
{
  "searchId": "...",
  "listingIds": ["kijiji-123"],
  "origin": { "lat": 51.05, "lng": -114.07 },
  "provider": "google"
}
```

### `GET /api/geocode?address=...`

Geocode a Canadian address to lat/lng.

## Maps limits

- Google Maps mobile deep links support up to **3 waypoints**
- Google Maps desktop supports up to **9 waypoints**
- Route order is approximate (straight-line nearest-neighbor), not turn-by-turn optimized

## License

MIT
