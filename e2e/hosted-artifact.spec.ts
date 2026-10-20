import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Regression test for the hosted (claude.ai Artifact) build: dist-single/artifact.html is
 * served wrapped in the host's own document shell, inside a sandboxed iframe with a strict
 * Content-Security-Policy. A build bug once truncated the inline bundle in this variant only,
 * which left a blank page while every other test passed. Run `npm run build:single` first.
 */
const ARTIFACT = join(process.cwd(), 'dist-single', 'artifact.html');

// The shell the host wraps around published content (doctype, charset, viewport, small reset).
const shell = (content: string) =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:\">" +
  '<style>:root{color-scheme:light}body{margin:0;font:14px sans-serif;background:#fff;color:#000}[hidden]{display:none!important}</style>' +
  `</head><body>\n${content}</body></html>`;

async function serve(page: Page, sandbox: string) {
  const html = shell(readFileSync(ARTIFACT, 'utf8'));
  await page.route('https://artifact.test/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: route.request().url().endsWith('/frame') ? html : `<iframe src="/frame" sandbox="${sandbox}" style="width:100vw;height:100vh;border:0"></iframe>` }),
  );
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
}

test.describe('hosted artifact build', () => {
  test.skip(!existsSync(ARTIFACT), 'run `npm run build:single` first');

  for (const sandbox of ['allow-scripts allow-same-origin', 'allow-scripts']) {
    test(`renders inside a sandboxed frame (${sandbox})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await serve(page, sandbox);
      await page.goto('https://artifact.test/');
      const app = page.frameLocator('iframe');
      await expect(app.getByRole('heading', { level: 1 })).toHaveText(/Your interview loop/);
      await expect(app.locator('.loop-ring')).toContainText('/112');

      // Core interaction works even when storage is blocked (no allow-same-origin).
      await app.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Accessibility' }).click();
      await app.locator('.q').first().locator('.q-trigger').click();
      await app.locator('.q').first().getByRole('button', { name: 'Reveal answer' }).click();
      await expect(app.locator('.q').first().locator('.callout-tldr')).toBeVisible();
      await app.locator('.q').first().getByRole('checkbox').check();
      await expect(app.locator('.section-progress')).toContainText('1 of 6 done');
      expect(errors).toEqual([]);
    });
  }
});
