const { chromium } = require('playwright');
const { buildSearchUrl } = require('../scrapers/kijiji');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const url = buildSearchUrl({
    keywords: 'free firewood',
    radiusKm: 50,
    locationSlug: 'calgary',
    locationId: '1700199',
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const map = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script')].map((s) => s.textContent || '').join('\n');
    const out = {};
    const re =
      /"url":"https:\/\/www\.kijiji\.ca\/[^"]+\/(\d+)"[\s\S]{0,800}?"sortingDate":"([^"]+)"[\s\S]{0,800}?"location":\{[\s\S]{0,600}?"address":"([^"]*)"[\s\S]{0,300}?"coordinates":\{"__typename":"LocationCoordinates","latitude":([-\d.]+),"longitude":([-\d.]+)\}/g;
    let m;
    while ((m = re.exec(scripts)) !== null) {
      out[m[1]] = { postedAt: m[2], address: m[3], lat: +m[4], lng: +m[5] };
    }
    return out;
  });

  console.log('count', Object.keys(map).length);
  console.log(JSON.stringify(Object.entries(map).slice(0, 3), null, 2));
  await browser.close();
})();
