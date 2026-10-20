import { expect, test, type Page } from '@playwright/test';

const PROGRESS_KEY = 'whetstone:progress:v1';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // Font requests may be blocked in offline CI sandboxes; everything else is a real error.
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });
  return errors;
}

async function openRound(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

test('ticking questions persists across reloads and drives "continue"', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await openRound(page, 'React Rendering & Internals');

  const items = page.locator('.q');
  await items.nth(0).locator('.q-trigger').click();
  await expect(items.nth(0).locator('.callout-tldr')).toHaveCount(0); // held back until asked for
  await items.nth(0).getByRole('button', { name: 'Reveal answer' }).click();
  await expect(items.nth(0).locator('.callout-tldr')).toBeVisible();
  await items.nth(0).getByRole('checkbox').check();
  await expect(page.locator('.section-progress')).toContainText('1 of 9 done');

  await items.nth(1).locator('.q-trigger').click();
  await items.nth(1).getByRole('button', { name: 'Mark done & next' }).click();
  await expect(items.nth(2).locator('.q-trigger')).toHaveAttribute('aria-expanded', 'true');

  await items.nth(2).getByRole('button', { name: 'Add your own notes' }).click();
  await items.nth(2).locator('textarea').fill('My own words about this.');
  await items.nth(2).locator('textarea').blur();

  await page.reload();
  await expect(page.locator('.q[data-done="true"]')).toHaveCount(2);

  await page.goto('/');
  const resume = page.locator('.action-card.is-primary');
  await expect(resume.locator('.action-label')).toHaveText('Pick up where you left off');
  await expect(resume.locator('.action-title')).toContainText('Effects are synchronization');
  await expect(page.locator('.loop-ring')).toContainText('2/112');

  await resume.click();
  const third = page.locator('.q').nth(2);
  await expect(third.locator('.q-trigger')).toHaveAttribute('aria-expanded', 'true');
  await expect(third.locator('textarea')).toHaveValue('My own words about this.');
  expect(errors).toEqual([]);
});

test('search with the keyboard and deep links open the right question', async ({ page }) => {
  await page.goto('/');
  // The app renders after its one boot request (backend probe), so wait for it before typing.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('csrf samesite');
  await expect(page.locator('.search-result').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Frontend Security');
  await expect(page.locator('#q-csrf-samesite .q-trigger')).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(/#csrf-samesite$/);

  await page.goto('/#oauth-pkce-flow');
  await expect(page.locator('#q-oauth-pkce-flow .q-trigger')).toHaveAttribute('aria-expanded', 'true');
});

test('the answer waits behind a Reveal answer button, and the full question stays visible', async ({ page }) => {
  await page.goto('/');
  await openRound(page, 'Accessibility');
  const first = page.locator('.q').first();
  await first.locator('.q-trigger').click();
  await expect(first.locator('.callout-prompt')).toBeVisible();
  await expect(first.locator('.callout-tldr')).toHaveCount(0);
  await expect(first.locator('.practice')).toHaveCount(0); // no stopwatch outside practice mode
  await first.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(first.locator('.callout-tldr')).toBeVisible();
  await expect(first.locator('.callout-prompt')).toBeVisible();
  await expect(first.getByRole('button', { name: 'Reveal answer' })).toHaveCount(0);
  await expect(first.getByRole('group', { name: 'Answer' })).toBeFocused(); // focus lands on the answer
  // Closing and reopening keeps it revealed.
  await first.locator('.q-trigger').click();
  await first.locator('.q-trigger').click();
  await expect(first.locator('.callout-tldr')).toBeVisible();
});

test('framework switch shows React, Angular or Vue code and remembers the choice', async ({ page }) => {
  await page.goto('/#typeahead-combobox');
  const question = page.locator('#q-typeahead-combobox');
  if ((await question.locator('.q-trigger').getAttribute('aria-expanded')) !== 'true') await question.locator('.q-trigger').click();
  await question.getByRole('button', { name: 'Reveal answer' }).click();

  const switcher = question.getByRole('radiogroup', { name: 'Show code in' });
  await expect(switcher.getByRole('radio', { name: 'React' })).toHaveAttribute('aria-checked', 'true');
  await expect(question.locator('.fw[data-fw="react"]')).toBeVisible();
  await expect(question.locator('.fw[data-fw="angular"]')).toBeHidden();
  await expect(question.locator('.callout-tldr')).toBeVisible(); // shared content never hides

  await switcher.getByRole('radio', { name: 'Angular' }).click();
  await expect(question.locator('.fw[data-fw="angular"]')).toBeVisible();
  await expect(question.locator('.fw[data-fw="react"]')).toBeHidden();

  // The choice follows the reader to other questions and across reloads.
  await page.goto('/#modal-dialog');
  await page.reload();
  const modal = page.locator('#q-modal-dialog');
  if ((await modal.locator('.q-trigger').getAttribute('aria-expanded')) !== 'true') await modal.locator('.q-trigger').click();
  await modal.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(modal.locator('.fw[data-fw="angular"]')).toBeVisible();

  // A framework-neutral answer has no switch.
  await page.goto('/#http-caching-spa');
  const neutral = page.locator('#q-http-caching-spa');
  if ((await neutral.locator('.q-trigger').getAttribute('aria-expanded')) !== 'true') await neutral.locator('.q-trigger').click();
  await neutral.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(neutral.getByRole('radiogroup', { name: 'Show code in' })).toHaveCount(0);
});

test('practice mode adds the stopwatch to the reveal step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('switch').check();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await openRound(page, 'Accessibility');
  const first = page.locator('.q').first();
  await first.locator('.q-trigger').click();
  await expect(first.locator('.practice')).toBeVisible();
  await expect(first.locator('.callout-prompt')).toBeVisible();
  await expect(first.locator('.callout-tldr')).toHaveCount(0);
  await first.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(first.locator('.callout-tldr')).toBeVisible();
});

test('a finished question opens straight to its answer', async ({ page }) => {
  await page.goto('/');
  await openRound(page, 'Accessibility');
  const first = page.locator('.q').first();
  await first.locator('.done-box').click();
  await page.reload();
  await openRound(page, 'Accessibility');
  await first.locator('.q-trigger').click();
  await expect(first.locator('.callout-tldr')).toBeVisible();
});

test('import, spaced review and reset', async ({ page }) => {
  await page.goto('/');
  const overdue = {
    version: 1,
    questions: { 'xss-react': { done: true, doneAt: 1, stage: 0, dueAt: 1000, notes: '', updatedAt: 2 } },
    lastVisit: null,
  };
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Import…' }).click();
  await page.locator('#import-json').fill(JSON.stringify(overdue));
  await page.getByRole('button', { name: 'Replace current' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /Review/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 answer to refresh');
  await page.locator('.q').first().locator('.q-trigger').click();
  await page.getByRole('button', { name: 'Still solid' }).click();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), PROGRESS_KEY);
  expect(saved.questions['xss-react'].stage).toBe(1);
  expect(saved.questions['xss-react'].dueAt).toBeGreaterThan(1000);

  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Reset progress…' }).click();
  await page.getByRole('button', { name: 'Yes, clear it' }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.goto('/');
  await expect(page.locator('.loop-ring')).toContainText('0/112');
});

test('filters, theme and keyboard basics', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();

  await openRound(page, 'Performance');
  await page.locator('.q').first().getByRole('checkbox').check();
  await page.getByRole('radio', { name: 'Done' }).click();
  await expect(page.locator('.q')).toHaveCount(1);
  await page.getByRole('radio', { name: 'To do' }).click();
  await expect(page.locator('.q')).toHaveCount(6);
  await page.getByRole('radio', { name: 'All' }).click();

  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('"How it\'s built" walkthroughs and Contribute (no backend)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: "How it's built" }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("How it's built");
  await page.getByRole('link', { name: /Email reminders, end to end/ }).click();
  await expect(page).toHaveURL(/#how-its-built\/email-reminders$/);
  // Live excerpts and commit-pinned links to the repository.
  await expect(page.locator('.walk-prose figure.code').first()).toBeVisible();
  await expect(page.locator('.walk-prose a[href*="github.com/anand1296/whetstone/blob/"]').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Email reminders, end to end');

  // Without a backend, proposing a question goes through a GitHub issue form.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Contribute' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contribute');
  await expect(page.getByRole('link', { name: 'Propose it on GitHub' })).toHaveAttribute('href', /issues\/new\?template=question\.yml/);
  expect(errors).toEqual([]);
});
