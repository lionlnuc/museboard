import { chromium } from '@playwright/test';

const url = process.env.PWA_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch();

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const browserErrors = [];
  const requestFailures = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('requestfailed', (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(url, { waitUntil: 'networkidle' });

  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), undefined, { timeout: 15_000 });
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return {
      scope: ready.scope,
      scriptURL: ready.active?.scriptURL,
    };
  });
  const cachedUrls = await page.evaluate(async () => {
    const snapshot = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      snapshot[name] = (await cache.keys()).map((request) => request.url);
    }
    return snapshot;
  });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 10_000 });
  } catch (error) {
    process.stderr.write(`Cached URLs: ${JSON.stringify(cachedUrls, null, 2)}\n`);
    process.stderr.write(`Browser errors: ${JSON.stringify(browserErrors)}\n`);
    process.stderr.write(`Request failures: ${JSON.stringify(requestFailures)}\n`);
    process.stderr.write(`Offline document: ${(await page.content()).slice(0, 1000)}\n`);
    throw error;
  }

  process.stdout.write(`PWA offline verification passed: ${registration.scriptURL} (${registration.scope})\n`);
} finally {
  await browser.close();
}
