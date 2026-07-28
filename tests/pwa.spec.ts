import { expect, test } from '@playwright/test';

test('serves complete install metadata and application icons', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');

  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    name: 'Museboard',
    display: 'standalone',
    start_url: '/',
    scope: '/',
  });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
    expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
  ]));

  const dimensions = await page.evaluate(async () => Promise.all([
    '/icons/museboard-192.png',
    '/icons/museboard-512.png',
  ].map((src) => new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    image.src = src;
  }))));

  expect(dimensions).toEqual([
    { width: 192, height: 192 },
    { width: 512, height: 512 },
  ]);
});
