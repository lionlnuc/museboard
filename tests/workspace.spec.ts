import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'museboard.document.v1';
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function insertPixelImage(page: Page) {
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: PIXEL_PNG,
  });
}

async function storedShapes(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).shapes : [];
  }, STORAGE_KEY);
}

async function expectStoredShapeCount(page: Page, count: number) {
  await expect.poll(async () => (await storedShapes(page)).length).toBe(count);
}

async function drawRectangle(
  page: Page,
  position = { x: 260, y: 260, width: 150, height: 96 },
) {
  const canvas = page.locator('.canvas-stage canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await page.mouse.move(box!.x + position.x, box!.y + position.y);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + position.x + position.width,
    box!.y + position.y + position.height,
    { steps: 8 },
  );
  await page.mouse.up();

  const editor = page.locator('.canvas-text-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveClass(/is-contained/);
  return editor;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('museboard.local');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByRole('main', { name: 'Museboard 画布' })).toBeVisible();
});

test('starts with a genuinely blank canvas', async ({ page }) => {
  await expect(page.locator('.layer-row')).toHaveCount(0);
  await expect(page.getByText(/把零散的想法/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '清空画布' })).toBeDisabled();
  await expectStoredShapeCount(page, 0);
});

test('desktop keeps the properties panel visible and lets it be toggled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  const panel = page.getByRole('complementary', { name: '属性面板' });
  const toggle = page.getByRole('button', { name: '切换属性面板' });
  await expect(panel).toHaveClass(/is-open/);
  await expect(panel.getByText('画布属性')).toBeVisible();
  await toggle.click();
  await expect(panel).not.toHaveClass(/is-open/);
  await toggle.click();
  await expect(panel).toHaveClass(/is-open/);
});

test('space activates focused controls instead of entering pan mode', async ({ page }) => {
  const grid = page.getByRole('button', { name: '切换点阵' });
  const before = await grid.getAttribute('class');
  await grid.focus();
  await page.keyboard.press('Space');
  await expect(grid).not.toHaveAttribute('class', before ?? '');
  await page.keyboard.press('Space');
  await expect(grid).toHaveAttribute('class', before ?? '');
});

test('button zoom keeps the canvas center anchored', async ({ page }) => {
  const stage = page.locator('.canvas-stage');
  const readView = () => stage.evaluate((element) => {
    const [x, y] = element.style.backgroundPosition.split(' ').map(Number.parseFloat);
    const zoom = Number.parseFloat(element.style.backgroundSize) / 24;
    const center = { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    return {
      x,
      y,
      zoom,
      world: { x: (center.x - x) / zoom, y: (center.y - y) / zoom },
    };
  });

  const before = await readView();
  await page.getByRole('button', { name: '放大' }).click();
  const after = await readView();
  expect(after.zoom).toBeCloseTo(before.zoom + 0.1, 3);
  expect(after.world.x).toBeCloseTo(before.world.x, 2);
  expect(after.world.y).toBeCloseTo(before.world.y, 2);
});

test('offers app installation only after the browser provides a prompt', async ({ page }) => {
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await expect(page.getByRole('button', { name: '安装应用' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      prompt: {
        value: async () => {
          (window as Window & { __installPrompted?: boolean }).__installPrompted = true;
        },
      },
      userChoice: { value: Promise.resolve({ outcome: 'accepted' }) },
    });
    window.dispatchEvent(event);
  });

  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '安装应用' }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __installPrompted?: boolean }).__installPrompted))).toBe(true);
  await expect(page.getByRole('status')).toContainText('Museboard 已安装');
});

test('a rectangle owns its text as one object', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page);
  await editor.fill('高效审批流程');
  await editor.press('Control+Enter');
  await expect(editor).toBeHidden();

  await expect.poll(async () => {
    const shapes = await storedShapes(page);
    return shapes.map((shape: { type: string; text?: string }) => ({
      type: shape.type,
      text: shape.text,
    }));
  }).toEqual([{ type: 'rect', text: '高效审批流程' }]);
  await expect(page.locator('.layer-row')).toHaveCount(1);
  await expect(page.locator('.layer-row')).toContainText('高效审批流程');
});

test('bound rectangle text grows for two lines and re-edits without a canvas ghost', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page, { x: 300, y: 260, width: 180, height: 42 });
  await editor.fill('第一行内容\n第二行内容');
  await expect.poll(async () => editor.evaluate((element) => element.clientHeight >= element.scrollHeight)).toBe(true);
  await editor.press('Control+Enter');
  await expect(editor).toBeHidden();
  await expectStoredShapeCount(page, 1);

  const [afterCommit] = await storedShapes(page);
  expect(afterCommit.height).toBeGreaterThan(65);
  for (let index = 0; index < 7; index += 1) {
    await page.getByRole('button', { name: '缩小', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: '重置缩放' })).toHaveText('30%');
  const canvas = page.locator('.canvas-stage canvas').first();

  for (let index = 0; index < 3; index += 1) {
    const renderedWithText = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    await page.keyboard.press('F2');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue('第一行内容\n第二行内容');
    await expect.poll(async () => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(renderedWithText);
    const renderedWithoutText = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    await editor.press('Control+Enter');
    await expect(editor).toBeHidden();
    await expect.poll(async () => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(renderedWithoutText);
  }
  const [afterReopen] = await storedShapes(page);
  expect(Math.abs(afterReopen.height - afterCommit.height)).toBeLessThan(0.5);
});

test('narrow rectangle text grows for automatic wrapping without manual line breaks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page, { x: 320, y: 260, width: 120, height: 42 });
  const content = '这是一段需要自动换行并完整显示在矩形中的较长文字';
  await editor.fill(content);
  await expect.poll(async () => editor.evaluate((element) => element.clientHeight >= element.scrollHeight)).toBe(true);
  await editor.press('Control+Enter');
  await expectStoredShapeCount(page, 1);

  const [shape] = await storedShapes(page);
  expect(shape.text).toBe(content);
  expect(shape.text).not.toContain('\n');
  expect(shape.height).toBeGreaterThan(90);
});

test('a selected shape can be resized repeatedly', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(450);
  const position = { x: 260, y: 280, width: 150, height: 96 };
  const editor = await drawRectangle(page, position);
  await editor.fill('连续缩放');
  await editor.press('Control+Enter');

  const canvas = page.locator('.canvas-stage canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await expectStoredShapeCount(page, 1);
  const resizeBy = async (deltaX: number, deltaY: number) => {
    const [shape] = await storedShapes(page);
    const view = await page.locator('.canvas-stage').evaluate((element) => {
      const [x, y] = element.style.backgroundPosition.split(' ').map(Number.parseFloat);
      const zoom = Number.parseFloat(element.style.backgroundSize) / 24;
      return { x, y, zoom };
    });
    const x = box!.x + view.x + (shape.x + shape.width) * view.zoom + 4;
    const y = box!.y + view.y + (shape.y + shape.height) * view.zoom + 4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y + deltaY, { steps: 10 });
    await page.mouse.up();
  };

  await resizeBy(90, 54);
  await expect.poll(async () => {
    const [shape] = await storedShapes(page);
    return Boolean(shape && shape.width > 220 && shape.height > 135 && shape.scaleX === 1 && shape.scaleY === 1);
  }).toBe(true);
  const [afterFirstResize] = await storedShapes(page);

  for (let index = 0; index < 7; index += 1) {
    await page.getByRole('button', { name: '缩小', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: '重置缩放' })).toHaveText('30%');
  await resizeBy(60, 42);
  await expect.poll(async () => {
    const [shape] = await storedShapes(page);
    return Boolean(
      shape
      && shape.width > afterFirstResize.width + 45
      && shape.height > afterFirstResize.height + 30
      && shape.scaleX === 1
      && shape.scaleY === 1,
    );
  }).toBe(true);
});

test('a rectangle can be stretched vertically without changing its width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page, { x: 300, y: 260, width: 180, height: 90 });
  await editor.fill('上下拉伸');
  await editor.press('Control+Enter');
  await expectStoredShapeCount(page, 1);
  const [before] = await storedShapes(page);

  const canvas = page.locator('.canvas-stage canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const view = await page.locator('.canvas-stage').evaluate((element) => {
    const [x, y] = element.style.backgroundPosition.split(' ').map(Number.parseFloat);
    const zoom = Number.parseFloat(element.style.backgroundSize) / 24;
    return { x, y, zoom };
  });
  const handleX = box!.x + view.x + (before.x + before.width / 2) * view.zoom;
  const handleY = box!.y + view.y + (before.y + before.height) * view.zoom + 4;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX, handleY + 80, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => {
    const [shape] = await storedShapes(page);
    return Boolean(shape && shape.height > before.height + 65 && Math.abs(shape.width - before.width) < 1);
  }).toBe(true);

  const [afterBottomStretch] = await storedShapes(page);
  const originalBottom = afterBottomStretch.y + afterBottomStretch.height;
  for (let index = 0; index < 7; index += 1) {
    await page.getByRole('button', { name: '缩小', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: '重置缩放' })).toHaveText('30%');
  const zoomedView = await page.locator('.canvas-stage').evaluate((element) => {
    const [x, y] = element.style.backgroundPosition.split(' ').map(Number.parseFloat);
    const zoom = Number.parseFloat(element.style.backgroundSize) / 24;
    return { x, y, zoom };
  });
  const topHandleX = box!.x + zoomedView.x + (afterBottomStretch.x + afterBottomStretch.width / 2) * zoomedView.zoom;
  const topHandleY = box!.y + zoomedView.y + afterBottomStretch.y * zoomedView.zoom - 4;
  await page.mouse.move(topHandleX, topHandleY);
  await page.mouse.down();
  await page.mouse.move(topHandleX, topHandleY - 60, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => {
    const [shape] = await storedShapes(page);
    return Boolean(
      shape
      && shape.y < afterBottomStretch.y - 45
      && shape.height > afterBottomStretch.height + 45
      && Math.abs(shape.width - afterBottomStretch.width) < 1
      && Math.abs(shape.y + shape.height - originalBottom) < 1,
    );
  }).toBe(true);
});

test('the T shortcut creates and reopens standalone text', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(450);
  const canvas = page.locator('.canvas-stage canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: '文本', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(box!.x + 360, box!.y + 300);
  const editor = page.locator('.canvas-text-editor');
  await expect(editor).toBeVisible();
  await expect(editor).not.toHaveClass(/is-contained/);
  await editor.fill('独立文本可用');
  await editor.press('Control+Enter');

  await expect.poll(async () => {
    const shapes = await storedShapes(page);
    return shapes.map((shape: { type: string; text?: string }) => ({ type: shape.type, text: shape.text }));
  }).toEqual([{ type: 'text', text: '独立文本可用' }]);

  await page.keyboard.press('F2');
  await expect(editor).toBeVisible();
  await editor.fill('独立文本已再次编辑');
  await editor.press('Control+Enter');
  await expect.poll(async () => (await storedShapes(page))[0]?.text).toBe('独立文本已再次编辑');
});

test('standalone text grows to fit multiple lines without clipping', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const canvas = page.locator('.canvas-stage canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.keyboard.press('t');
  await page.mouse.click(box!.x + 360, box!.y + 280);
  const editor = page.getByRole('textbox', { name: '画布文字编辑' });
  await editor.fill('第一行\n第二行\n第三行');
  await expect.poll(async () => editor.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))).toMatchObject({ clientHeight: expect.any(Number), scrollHeight: expect.any(Number) });
  await expect.poll(async () => editor.evaluate((element) => element.clientHeight >= element.scrollHeight)).toBe(true);
  await editor.press('Control+Enter');

  await expect.poll(async () => {
    const [shape] = await storedShapes(page);
    return Boolean(shape && shape.type === 'text' && shape.height > 80);
  }).toBe(true);

  await page.keyboard.press('F2');
  await expect(editor).toBeVisible();
  await expect.poll(async () => editor.evaluate((element) => element.clientHeight >= element.scrollHeight)).toBe(true);
});

test('undo removes a newly drawn rectangle after text editing closes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page);
  await editor.press('Escape');
  await expect(editor).toBeHidden();
  await expectStoredShapeCount(page, 1);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.layer-row')).toHaveCount(0);
  await expectStoredShapeCount(page, 0);
});

test('continuous arrow nudges collapse into one undo step', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page);
  await editor.press('Escape');
  await expectStoredShapeCount(page, 1);
  const [before] = await storedShapes(page);

  for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await storedShapes(page))[0]?.x).toBe(before.x + 5);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await storedShapes(page))[0]?.x).toBe(before.x);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.layer-row')).toHaveCount(0);
});

test('a no-op layer command does not consume an undo step', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page);
  await editor.press('Escape');
  await page.getByRole('button', { name: '置于顶层', exact: true }).click();

  await page.keyboard.press('Control+z');
  await expect(page.locator('.layer-row')).toHaveCount(0);
  await expectStoredShapeCount(page, 0);
});

test('one-click clear offers an immediate undo action', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await (await drawRectangle(page, { x: 220, y: 230, width: 130, height: 84 })).press('Escape');
  await (await drawRectangle(page, { x: 430, y: 320, width: 150, height: 92 })).press('Escape');
  await expectStoredShapeCount(page, 2);

  const clear = page.getByRole('button', { name: '清空画布' });
  await expect(clear).toBeVisible();
  await expect(clear).toBeEnabled();
  await clear.click();
  await expect(page.locator('.layer-row')).toHaveCount(0);

  const toast = page.getByRole('status');
  await expect(toast).toContainText('已清空 2 个对象');
  await toast.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('.layer-row')).toHaveCount(2);
  await expectStoredShapeCount(page, 2);
});

test('exports embedded shape text in an editable SVG document', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page);
  await editor.fill('导出测试');
  await editor.press('Control+Enter');
  await expect(editor).toBeHidden();

  await page.getByRole('button', { name: '文件', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const svg = Buffer.concat(chunks).toString('utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('<rect');
  expect(svg).toContain('<text');
  expect(svg).toContain('导出测试');
});

test('the export menu downloads real PNG, JPG, and WebP files', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page);
  await editor.fill('多格式导出');
  await editor.press('Control+Enter');

  const exportButton = page.getByRole('button', { name: '导出', exact: true });
  const downloadFormat = async (menuName: string) => {
    await exportButton.click();
    const menu = page.getByRole('menu', { name: '导出格式' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(5);
    const downloadPromise = page.waitForEvent('download');
    await menu.getByRole('menuitem', { name: menuName, exact: true }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return { filename: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
  };

  const png = await downloadFormat('PNG 图片');
  expect(png.filename).toMatch(/\.png$/);
  expect(png.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

  const jpeg = await downloadFormat('JPG 图片');
  expect(jpeg.filename).toMatch(/\.jpg$/);
  expect(jpeg.bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff');

  const webp = await downloadFormat('WebP 图片');
  expect(webp.filename).toMatch(/\.webp$/);
  expect(webp.bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(webp.bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
});

test('the export menu stays inside desktop and mobile viewports', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const menu = page.getByRole('menu', { name: '导出格式' });
    await expect(menu).toBeVisible();

    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
});

test('the export menu supports efficient keyboard navigation', async ({ page }) => {
  const trigger = page.getByRole('button', { name: '导出', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');

  const menu = page.getByRole('menu', { name: '导出格式' });
  const items = menu.getByRole('menuitem');
  await expect(menu).toBeVisible();
  await expect(items.first()).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('advanced export settings stay keyboard-contained and produce an exact transparent SVG', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page, { x: 300, y: 260, width: 160, height: 90 });
  await editor.fill('精确导出');
  await editor.press('Control+Enter');

  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('button', { name: '高级导出设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出画板' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /PNG/ })).toBeFocused();
  await expect(dialog.getByRole('radio', { name: /当前选区/ })).toHaveAttribute('aria-checked', 'true');

  const closeButton = dialog.getByRole('button', { name: '关闭导出设置' });
  await closeButton.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '导出 PNG', exact: true })).toBeFocused();

  await dialog.getByRole('radio', { name: /SVG/ }).click();
  await dialog.getByRole('checkbox', { name: '透明背景' }).check();
  await dialog.getByRole('slider', { name: '导出边距', exact: true }).fill('0');
  const summary = dialog.locator('.export-summary strong');
  await expect(summary).toContainText(/\d+ × \d+px/);
  const match = (await summary.textContent())?.match(/(\d+) × (\d+)px/);
  expect(match).not.toBeNull();

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-选区\.svg$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const svg = Buffer.concat(chunks).toString('utf8');
  expect(svg).toContain(`width="${match![1]}" height="${match![2]}" viewBox="0 0 ${match![1]} ${match![2]}"`);
  expect(svg).not.toContain('<rect width="100%" height="100%"');
});

test('the command registry exposes every drawing tool', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: '快速命令' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('绘制菱形', { exact: true })).toBeVisible();
  await expect(dialog.getByText('绘制直线', { exact: true })).toBeVisible();
  await expect(dialog.getByText('自由画笔', { exact: true })).toBeVisible();
});

test('editing the title after undo clears the obsolete redo branch', async ({ page }) => {
  await (await drawRectangle(page)).press('Escape');
  await page.keyboard.press('Control+z');
  const redo = page.getByRole('button', { name: '重做' });
  await expect(redo).toBeEnabled();

  const title = page.getByRole('textbox', { name: '画板名称' });
  await title.fill('新的分支标题');
  await expect(redo).toBeDisabled();
  await page.keyboard.press('Control+y');
  await expectStoredShapeCount(page, 0);
});

test('plain text from the system clipboard becomes editable canvas text', async ({ page }) => {
  await page.evaluate(() => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '从外部应用粘贴的文本');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData }));
  });

  await expect.poll(async () => {
    const [shape] = await storedShapes(page);
    return { type: shape?.type, text: shape?.text };
  }).toEqual({ type: 'text', text: '从外部应用粘贴的文本' });
  await expect(page.getByRole('status')).toContainText('文本已粘贴到画布');
});

test('IndexedDB restores the board when the localStorage compatibility copy cannot be written', async ({ page }) => {
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  await (await drawRectangle(page)).press('Escape');

  await expect.poll(async () => page.evaluate(async () => {
    return await new Promise<number>((resolve) => {
      const request = indexedDB.open('museboard.local');
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('documents', 'readonly');
        const get = transaction.objectStore('documents').get('active');
        get.onsuccess = () => {
          resolve(get.result?.document?.shapes?.length ?? 0);
          database.close();
        };
        get.onerror = () => { resolve(0); database.close(); };
      };
      request.onerror = () => resolve(0);
    });
  })).toBe(1);

  await page.reload();
  await expect(page.locator('.layer-row')).toHaveCount(1);
});

test('IndexedDB stores embedded images as Blob assets and restores their portable data URL', async ({ page }) => {
  await insertPixelImage(page);
  await expect(page.locator('.layer-row')).toHaveCount(1);

  await expect.poll(async () => page.evaluate(async () => {
    return await new Promise<{ version: number; assetId: string; hasEmbeddedUrl: boolean; blobType: string; blobSize: number }>((resolve) => {
      const request = indexedDB.open('museboard.local');
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(['documents', 'assets'], 'readonly');
        const documentRequest = transaction.objectStore('documents').get('active');
        const assetRequest = transaction.objectStore('assets').getAll();
        transaction.oncomplete = () => {
          const shape = documentRequest.result?.document?.shapes?.[0];
          const asset = assetRequest.result?.[0];
          resolve({
            version: database.version,
            assetId: shape?.assetId ?? '',
            hasEmbeddedUrl: typeof shape?.url === 'string' && shape.url.startsWith('data:image/'),
            blobType: asset?.blob?.type ?? '',
            blobSize: asset?.blob?.size ?? 0,
          });
          database.close();
        };
      };
      request.onerror = () => resolve({ version: 0, assetId: '', hasEmbeddedUrl: true, blobType: '', blobSize: 0 });
    });
  })).toEqual({
    version: 2,
    assetId: expect.stringMatching(/^asset-/),
    hasEmbeddedUrl: false,
    blobType: 'image/png',
    blobSize: PIXEL_PNG.length,
  });

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.layer-row')).toHaveCount(1);
  await expect.poll(async () => {
    const [shape] = await storedShapes(page);
    return { assetId: shape?.assetId ?? '', url: shape?.url ?? '' };
  }).toEqual({
    assetId: expect.stringMatching(/^asset-/),
    url: expect.stringMatching(/^data:image\/png;base64,/),
  });

  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(page.locator('.layer-row')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(async () => {
    return await new Promise<number>((resolve) => {
      const request = indexedDB.open('museboard.local');
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('assets', 'readonly');
        const count = transaction.objectStore('assets').count();
        count.onsuccess = () => { resolve(count.result); database.close(); };
        count.onerror = () => { resolve(-1); database.close(); };
      };
      request.onerror = () => resolve(-1);
    });
  })).toBe(0);
});

test('a missing image asset does not prevent the rest of the IndexedDB document loading', async ({ page }) => {
  await (await drawRectangle(page)).press('Escape');
  await insertPixelImage(page);
  await expect(page.locator('.layer-row')).toHaveCount(2);
  await expect.poll(async () => page.evaluate(async () => {
    return await new Promise<number>((resolve) => {
      const request = indexedDB.open('museboard.local');
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('assets', 'readonly');
        const count = transaction.objectStore('assets').count();
        count.onsuccess = () => { resolve(count.result); database.close(); };
        count.onerror = () => { resolve(0); database.close(); };
      };
      request.onerror = () => resolve(0);
    });
  })).toBe(1);

  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('museboard.local');
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('assets', 'readwrite');
        transaction.objectStore('assets').clear();
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); resolve(); };
      };
      request.onerror = () => resolve();
    });
    localStorage.clear();
  });
  await page.reload();

  await expect(page.locator('.layer-row')).toHaveCount(2);
  await expect.poll(async () => {
    const shapes = await storedShapes(page);
    return shapes.map((shape: { type: string; url?: string }) => ({ type: shape.type, hasUrl: Boolean(shape.url) }));
  }).toEqual([
    { type: 'rect', hasUrl: false },
    { type: 'image', hasUrl: false },
  ]);
});

test('an unknown local document version is not overwritten by the blank fallback', async ({ page }) => {
  const raw = JSON.stringify({
    version: 99,
    title: '未来版本画板',
    shapes: [{ id: 'future-shape', type: 'future-widget' }],
    settings: { background: '#ffffff', grid: true, snap: false, guides: true },
    updatedAt: Date.now(),
  });
  await page.evaluate(async ({ key, value }) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('museboard.local');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
    localStorage.setItem(key, value);
  }, { key: STORAGE_KEY, value: raw });
  await page.reload();

  await expect(page.locator('.save-state')).toContainText('保存失败');
  await page.waitForTimeout(800);
  await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
});

test('Ctrl+O, Ctrl+S, and Ctrl+Shift+S use the browser file workflow', async ({ page }) => {
  await page.evaluate(() => {
    const state = window as typeof window & {
      __savedFile?: string;
      __savePickerCalls?: number;
      showSaveFilePicker?: () => Promise<unknown>;
      showOpenFilePicker?: () => Promise<unknown[]>;
    };
    state.__savedFile = '';
    state.__savePickerCalls = 0;
    const handle = {
      getFile: async () => new File([], 'saved.museboard.json', { type: 'application/json' }),
      createWritable: async () => ({
        write: async (blob: Blob) => { state.__savedFile = await blob.text(); },
        close: async () => undefined,
      }),
    };
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => { state.__savePickerCalls = (state.__savePickerCalls ?? 0) + 1; return handle; },
    });
    const openedDocument = {
      version: 1,
      title: '快捷键打开的画板',
      shapes: [{
        id: 'opened-shape', type: 'rect', name: '打开的矩形', text: '文件已打开', x: 120, y: 160,
        width: 180, height: 90, rotation: 0, scaleX: 1, scaleY: 1, fill: '#ffffff', stroke: '#2563eb',
        strokeWidth: 2, opacity: 1, cornerRadius: 12, visible: true, locked: false,
      }],
      settings: { background: '#f8fafc', grid: true, snap: false, guides: true },
      updatedAt: Date.now(),
    };
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{
        ...handle,
        getFile: async () => new File([JSON.stringify(openedDocument)], 'opened.museboard.json', { type: 'application/json' }),
      }],
    });
  });

  await (await drawRectangle(page)).press('Escape');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => page.evaluate(() => {
    const value = (window as typeof window & { __savedFile?: string }).__savedFile;
    return value ? JSON.parse(value).shapes.length : 0;
  })).toBe(1);
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __savePickerCalls?: number }).__savePickerCalls)).toBe(1);

  await page.keyboard.press('Control+s');
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __savePickerCalls?: number }).__savePickerCalls)).toBe(1);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __savePickerCalls?: number }).__savePickerCalls)).toBe(2);

  await page.keyboard.press('Control+o');
  await expect(page.getByRole('textbox', { name: '画板名称' })).toHaveValue('快捷键打开的画板');
  await expect(page.locator('.layer-row')).toHaveCount(1);
  await expect(page.locator('.layer-row')).toContainText('打开的矩形');
});

test('shortcut 3 focuses the selection and exports only that selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await drawRectangle(page, { x: 300, y: 260, width: 160, height: 90 });
  await editor.fill('选区导出');
  await editor.press('Control+Enter');

  await page.keyboard.press('3');
  await expect.poll(async () => Number.parseInt(
    (await page.getByRole('button', { name: '重置缩放' }).textContent()) ?? '0',
    10,
  )).toBeGreaterThan(100);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出选区 PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-选区\.png$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});

test('removes legacy starter objects while preserving user work', async ({ page }) => {
  await page.evaluate((key) => {
    const shape = (id: string, type: 'text' | 'rect', name: string, text: string, x: number) => ({
      id,
      type,
      name,
      text,
      x,
      y: 180,
      width: 220,
      height: 96,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      fill: type === 'text' ? '#111827' : '#ffffff',
      stroke: type === 'text' ? 'transparent' : '#2563eb',
      strokeWidth: type === 'text' ? 0 : 2,
      opacity: 1,
      cornerRadius: 12,
      visible: true,
      locked: false,
    });
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      title: '旧版画板',
      shapes: [
        shape('starter-heading', 'text', '旧演示标题', '把零散的想法变成清晰的下一步', 120),
        shape('user-rect', 'rect', '用户对象', '这项工作必须保留', 460),
      ],
      settings: { background: '#f8fafc', grid: true, snap: false, guides: true },
      updatedAt: Date.now(),
    }));
  }, STORAGE_KEY);
  await page.reload();

  await expect.poll(async () => {
    const shapes = await storedShapes(page);
    return shapes.map((shape: { id: string; text?: string }) => [shape.id, shape.text]);
  }).toEqual([['user-rect', '这项工作必须保留']]);
  await expect(page.locator('.layer-row')).toHaveCount(1);
  await expect(page.locator('.layer-row')).toContainText('用户对象');
});

test('mobile keeps the canvas, tool dock, and object panel usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  const toolbar = page.getByRole('toolbar', { name: '绘图工具' });
  await expect(toolbar).toBeVisible();
  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(toolbarBox!.y).toBeGreaterThan(700);
  expect(toolbarBox!.x).toBeGreaterThanOrEqual(0);
  expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(390);

  const objectPanelButton = page.getByRole('button', { name: '打开对象面板' });
  await expect(objectPanelButton).toBeVisible();
  await expect(page.getByRole('button', { name: '打开属性' })).toBeVisible();
  await objectPanelButton.click();
  const objectPanel = page.getByRole('complementary', { name: '对象管理' });
  await expect(objectPanel).toHaveClass(/is-open/);
  await expect(objectPanel.getByText('暂无对象')).toBeVisible();
  await objectPanel.getByRole('button', { name: '关闭对象面板' }).click({ position: { x: 24, y: 120 } });
  await expect(objectPanel).not.toHaveClass(/is-open/);

  const moreTools = page.getByRole('button', { name: '更多工具' });
  await moreTools.click();
  await expect(page.getByRole('menu', { name: '更多绘图工具' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '橡皮擦' })).toBeVisible();
  await moreTools.click();

  const editor = await drawRectangle(page, { x: 70, y: 210, width: 110, height: 80 });
  await editor.fill('移动端节点');
  await editor.press('Control+Enter');
  const selectionBar = page.getByRole('toolbar', { name: '选区快捷操作' });
  await expect(selectionBar).toBeVisible();
  const selectionBox = await selectionBar.boundingBox();
  expect(selectionBox).not.toBeNull();
  expect(selectionBox!.x).toBeGreaterThanOrEqual(0);
  expect(selectionBox!.x + selectionBox!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('smart guides align rotated visual bounds and ignore unrelated objects', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { calculateSmartSnap, getShapeBounds } = await import('/src/utils/geometry.ts');
    const makeRect = (id: string, x: number, y: number, width: number, height: number, rotation = 0) => ({
      id,
      type: 'rect' as const,
      name: id,
      x,
      y,
      width,
      height,
      rotation,
      scaleX: 1,
      scaleY: 1,
      fill: '#ffffff',
      stroke: '#2563eb',
      strokeWidth: 2,
      opacity: 1,
      cornerRadius: 8,
      visible: true,
      locked: false,
    });
    const moving = makeRect('moving', 350, 240, 120, 60, 30);
    const target = makeRect('target', 100, 100, 100, 80);
    const unrelated = makeRect('unrelated', 800, 1000, 120, 100);
    return {
      originalBounds: getShapeBounds(moving),
      snap: calculateSmartSnap([moving], [target, unrelated], { x: -116, y: 0 }, 5),
    };
  });

  expect(result.originalBounds.left).toBeCloseTo(320, 4);
  expect(result.snap.delta.x).toBeCloseTo(-120, 4);
  const verticalGuide = result.snap.guides.find((guide) => guide.orientation === 'vertical');
  expect(verticalGuide?.position).toBeCloseTo(200, 4);
  expect(verticalGuide?.start).toBeLessThan(100);
  expect(verticalGuide?.end).toBeLessThan(400);
});

test('marquee selection, grouping, and group drag work together', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(450);
  const canvas = page.locator('.canvas-stage canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await (await drawRectangle(page, { x: 170, y: 250, width: 110, height: 74 })).press('Escape');
  await (await drawRectangle(page, { x: 390, y: 250, width: 110, height: 74 })).press('Escape');

  await page.mouse.move(box!.x + 140, box!.y + 220);
  await page.mouse.down();
  await page.mouse.move(box!.x + 530, box!.y + 360, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText('已选择 2 个')).toBeVisible();
  const selectionBar = page.getByRole('toolbar', { name: '选区快捷操作' });
  await selectionBar.getByRole('button', { name: '组合' }).click();
  await page.waitForTimeout(450);

  const before = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key)!);
    return document.shapes.map((shape: { x: number; y: number }) => ({ x: shape.x, y: shape.y }));
  }, STORAGE_KEY);
  await page.mouse.move(box!.x + 220, box!.y + 285);
  await page.mouse.down();
  await page.mouse.move(box!.x + 300, box!.y + 335, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const after = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key)!);
    return document.shapes.map((shape: { x: number; y: number }) => ({ x: shape.x, y: shape.y }));
  }, STORAGE_KEY);
  const deltaX = after[0].x - before[0].x;
  const deltaY = after[0].y - before[0].y;
  expect(Math.hypot(deltaX, deltaY)).toBeGreaterThan(50);
  expect(deltaX).toBeCloseTo(after[1].x - before[1].x, 3);
  expect(deltaY).toBeCloseTo(after[1].y - before[1].y, 3);
  await expect(selectionBar).toBeVisible();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.layer-row')).toHaveCount(4);
});

test('frame and continuous eraser tools are functional', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const canvas = page.locator('.canvas-stage canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.getByRole('button', { name: '画框', exact: true }).click();
  await page.mouse.move(box!.x + 180, box!.y + 210);
  await page.mouse.down();
  await page.mouse.move(box!.x + 520, box!.y + 470, { steps: 6 });
  await page.mouse.up();
  await (await drawRectangle(page, { x: 260, y: 290, width: 130, height: 90 })).press('Escape');
  await expect(page.locator('.layer-row')).toHaveCount(2);

  const eraser = page.getByRole('button', { name: '橡皮擦', exact: true });
  await eraser.click();
  await page.mouse.click(box!.x + 320, box!.y + 335);
  await expect(page.locator('.layer-row')).toHaveCount(1);
  await expect(eraser).toHaveAttribute('aria-pressed', 'true');
});

test('auto flow creates persistent bound connectors that follow nodes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate((key) => {
    const makeRect = (id: string, name: string, x: number, y: number) => ({
      id,
      type: 'rect',
      name,
      x,
      y,
      width: 150,
      height: 88,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      fill: '#ffffff',
      stroke: '#2563eb',
      strokeWidth: 2,
      opacity: 1,
      cornerRadius: 12,
      visible: true,
      locked: false,
    });
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      title: '智能流程测试',
      shapes: [
        makeRect('node-a', '节点 A', 160, 210),
        makeRect('node-b', '节点 B', 410, 350),
        makeRect('node-c', '节点 C', 690, 180),
      ],
      settings: { background: '#f8fafc', grid: true, snap: false, guides: true },
      updatedAt: Date.now(),
    }));
  }, STORAGE_KEY);
  await page.reload();
  await page.waitForTimeout(450);

  await page.getByRole('button', { name: '切换对象面板' }).click();
  await page.getByRole('button', { name: '选择 节点 A' }).click();
  await page.getByRole('button', { name: '选择 节点 B' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '选择 节点 C' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '整理为智能流程' }).click();
  await page.waitForTimeout(450);

  const flow = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key)!);
    const nodes = document.shapes.filter((shape: { type: string }) => shape.type === 'rect');
    const connectors = document.shapes.filter((shape: { type: string }) => shape.type === 'arrow');
    return {
      centers: nodes.map((shape: { y: number; height: number }) => shape.y + shape.height / 2),
      bindings: connectors.map((shape: { startBindingId?: string; endBindingId?: string }) => [shape.startBindingId, shape.endBindingId]),
    };
  }, STORAGE_KEY);
  expect(flow.centers.every((center: number) => Math.abs(center - flow.centers[0]) < 0.01)).toBeTruthy();
  expect(flow.bindings).toEqual([['node-a', 'node-b'], ['node-b', 'node-c']]);

  await page.getByRole('button', { name: '选择 节点 B' }).click();
  const xField = page.locator('.geometry-grid input').first();
  const oldConnector = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key)!);
    return document.shapes.find((shape: { startBindingId?: string }) => shape.startBindingId === 'node-a').points;
  }, STORAGE_KEY);
  await xField.fill('560');
  await page.waitForTimeout(450);
  const newConnector = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key)!);
    return document.shapes.find((shape: { startBindingId?: string }) => shape.startBindingId === 'node-a').points;
  }, STORAGE_KEY);
  expect(newConnector).not.toEqual(oldConnector);
});

test('arrow drawing binds to the nearest shape boundaries', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate((key) => {
    const makeRect = (id: string, name: string, x: number) => ({
      id,
      type: 'rect',
      name,
      x,
      y: 200,
      width: 150,
      height: 88,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      fill: '#ffffff',
      stroke: '#2563eb',
      strokeWidth: 2,
      opacity: 1,
      cornerRadius: 12,
      visible: true,
      locked: false,
    });
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      title: '连接测试',
      shapes: [makeRect('left-node', '左节点', 100), makeRect('right-node', '右节点', 500)],
      settings: { background: '#f8fafc', grid: true, snap: false, guides: true },
      updatedAt: Date.now(),
    }));
  }, STORAGE_KEY);
  await page.reload();
  await page.waitForTimeout(450);
  const canvas = page.locator('.canvas-stage canvas').first();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  const canvasWidth = canvasBox!.width;
  const canvasHeight = canvasBox!.height;
  const zoom = Math.min(Math.max((canvasWidth - 160) / 550, 0.2), 1.35);
  const viewX = (canvasWidth - 550 * zoom) / 2 - 100 * zoom;
  const viewY = (canvasHeight - 100 * zoom) / 2 - 200 * zoom;
  const screen = (x: number, y: number) => ({
    x: canvasBox!.x + viewX + x * zoom,
    y: canvasBox!.y + viewY + y * zoom,
  });
  const start = screen(248, 244);
  const end = screen(502, 244);
  await page.getByRole('button', { name: '箭头', exact: true }).click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const binding = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key)!);
    const connector = document.shapes.find((shape: { type: string }) => shape.type === 'arrow');
    return [connector?.startBindingId, connector?.endBindingId];
  }, STORAGE_KEY);
  expect(binding).toEqual(['left-node', 'right-node']);
  await page.getByRole('button', { name: '断开智能连接' }).click();
  await page.waitForTimeout(450);
  const detached = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key)!);
    const connector = document.shapes.find((shape: { type: string }) => shape.type === 'arrow');
    return Boolean(connector?.startBindingId || connector?.endBindingId);
  }, STORAGE_KEY);
  expect(detached).toBeFalsy();
});
