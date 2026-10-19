import { expect, test } from '@playwright/test';

test('mobile: drawer navigation, no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await noOverflow()).toBe(true);

  await page.getByRole('button', { name: 'Open rounds menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: /^Machine Coding/ }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Machine Coding');

  await page.locator('.q').first().locator('.q-trigger').click();
  await expect(page.locator('.q').first().locator('.callout-tldr')).toBeVisible();
  expect(await noOverflow()).toBe(true); // wide code blocks scroll inside their own container
});
