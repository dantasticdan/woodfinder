const { chromium } = require('playwright');

const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false';

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: HEADLESS,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

async function newScrapeContext() {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-CA',
  });

  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') {
      return route.abort();
    }
    const url = route.request().url();
    if (/doubleclick|googlesyndication|google-analytics|facebook\.net|adservice/i.test(url)) {
      return route.abort();
    }
    return route.continue();
  });

  return context;
}

module.exports = { getBrowser, newScrapeContext };
