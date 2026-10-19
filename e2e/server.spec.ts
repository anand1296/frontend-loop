import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Full-stack E2E: the built frontend served by the Go server, against a real,
 * freshly migrated Postgres, with DEV_LOGIN=1 (password-less sign-in) and
 * OWNER_GITHUB_LOGIN=anand1296. CI starts that stack (see .github/workflows/ci.yml);
 * locally:
 *
 *   docker compose up -d db
 *   DEV_LOGIN=1 OWNER_GITHUB_LOGIN=anand1296 DATABASE_URL=… go run ./cmd/server -static dist
 *   E2E_SERVER_URL=http://localhost:8080 npx playwright test --project=server
 *
 * One serial story, because each step builds on the previous one's data.
 */
// Serial and never retried: each step builds on the previous one's data, so a retry would run against a changed database.
test.describe.configure({ mode: 'serial', retries: 0, timeout: 90_000 });

const OWNER = 'anand1296';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // 4xx responses we provoke on purpose (refused sign-in) and blocked fonts are logged as resource errors.
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });
  return errors;
}

/** A fresh deployment is members-only: visitors land on the full-page sign-in screen. */
async function signIn(page: Page, login: string): Promise<void> {
  const screen = page.locator('.auth-screen');
  await expect(screen.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await screen.getByLabel('Developer sign-in (local only)').fill(login);
  await screen.getByRole('button', { name: 'Sign in' }).click();
}

async function newPage(browser: Browser): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { page, errors: collectErrors(page) };
}

let inviteLink = '';

test('owner signs in and manages content live', async ({ browser }) => {
  const { page, errors } = await newPage(browser);
  await page.goto('/');
  const side = page.locator('aside.sidebar');
  await expect(side).toHaveCount(0); // no app before signing in

  await signIn(page, OWNER);
  await expect(side.getByRole('button', { name: /Admin/ })).toBeVisible();
  await expect(side.locator('.role-chip')).toHaveText('Super admin');

  await side.getByRole('button', { name: /Admin/ }).click();
  await page.getByRole('tab', { name: 'Content' }).click();
  const rounds = page.getByRole('navigation', { name: 'Rounds' }).locator('.cms-item');
  await expect(rounds.first()).toBeVisible(); // the tab loads its data after opening
  const initialRounds = await rounds.count();
  expect(initialRounds).toBeGreaterThan(10);

  // A new round…
  await page.getByRole('button', { name: 'New round' }).click();
  const newRound = page.getByRole('dialog', { name: 'New round' });
  await newRound.getByLabel('Title').fill('Go Backend Fundamentals');
  await newRound.getByLabel('One-line description').fill('Goroutines, channels, context and HTTP services in Go.');
  await expect(newRound.getByLabel(/^Id/)).toHaveValue('go-backend-fundamentals');
  await newRound.getByRole('button', { name: 'Create round' }).click();
  await expect(rounds).toHaveCount(initialRounds + 1);

  // …and a question, first as a draft, then published.
  await page.getByRole('button', { name: 'New question' }).click();
  await page.getByLabel(/^Question/).fill('How does context cancellation propagate through a Go HTTP service?');
  await page.getByLabel(/^Tags/).fill('go, context, http');
  await page.getByRole('radio', { name: 'Side by side' }).click();
  await expect(page.locator('.editor-preview .callout-tldr')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Create question' }).click();
  await expect(page.getByText('Saved as a draft')).toBeVisible();
  await page.getByRole('switch', { name: /Draft/ }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved and published')).toBeVisible();
  await expect(side.getByRole('button', { name: /Go Backend Fundamentals/ })).toBeVisible();

  // Announcement and a feature switch.
  await page.getByRole('button', { name: 'Close' }).first().click();
  await page.getByRole('tab', { name: 'Features & settings' }).click();
  await page.getByLabel('Message').fill('Mock interviews on Saturday.');
  await page.getByRole('button', { name: 'Publish announcement' }).click();
  await expect(page.locator('.announcement')).toContainText('Mock interviews');
  await page.getByRole('switch', { name: /Personal notes/ }).uncheck();
  await expect(page.getByText('Personal notes switched off')).toBeVisible();

  // An invite link.
  await page.getByRole('tab', { name: 'Invites' }).click();
  await page.getByLabel(/Who is it for/).fill('Priya');
  await page.getByRole('button', { name: 'Create invite link' }).click();
  inviteLink = await page.getByLabel('Invite link').inputValue();
  expect(inviteLink).toContain('?invite=');
  expect(errors).toEqual([]);
});

test('an invited learner joins, studies and syncs across devices', async ({ browser }) => {
  const laptop = await newPage(browser);
  await laptop.page.goto(new URL(inviteLink).pathname + new URL(inviteLink).search);
  const invite = laptop.page.locator('.auth-screen');
  await expect(invite.getByRole('heading', { name: "You're invited" })).toBeVisible();
  await expect(invite).toContainText(`@${OWNER} invited you`);
  expect(laptop.page.url()).not.toContain('invite=');
  await invite.getByLabel('Developer sign-in (local only)').fill('priya');
  await invite.getByRole('button', { name: 'Sign in' }).click();

  const side = laptop.page.locator('aside.sidebar');
  await expect(side.locator('.account-chip')).toContainText('priya');
  await expect(side.getByRole('button', { name: /Admin/ })).toHaveCount(0);
  await expect(laptop.page.locator('.announcement')).toContainText('Mock interviews');

  await side.getByRole('button', { name: /Go Backend Fundamentals/ }).click();
  const question = laptop.page.locator('.q').first();
  await question.locator('.q-trigger').click();
  await question.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(question.locator('.callout-tldr')).toBeVisible();
  await expect(question.getByText('Add your own notes')).toHaveCount(0); // feature switched off
  // The write is debounced; wait for the PUT itself rather than the status text (already "Synced" from the initial pull).
  const saved = laptop.page.waitForResponse((res) => res.url().endsWith('/api/me/progress') && res.request().method() === 'PUT');
  await question.getByRole('checkbox').check();
  expect((await saved).ok()).toBe(true);
  await expect(side.locator('.account-chip')).toContainText('Synced');

  const phone = await newPage(browser);
  await phone.page.goto('/');
  await signIn(phone.page, 'priya');
  await expect(phone.page.locator('aside.sidebar').getByRole('button', { name: /Go Backend Fundamentals/ })).toContainText('1/1', {
    timeout: 10_000,
  });

  expect([...laptop.errors, ...phone.errors]).toEqual([]);
});

test('the owner sees progress; strangers need an invite', async ({ browser }) => {
  const owner = await newPage(browser);
  await owner.page.goto('/');
  await signIn(owner.page, OWNER);
  await owner.page.locator('aside.sidebar').getByRole('button', { name: /Admin/ }).click();
  await owner.page.getByRole('tab', { name: 'Learners' }).click();
  await expect(owner.page.locator('tr', { hasText: 'priya' })).toContainText('1/');

  const stranger = await newPage(browser);
  await stranger.page.goto('/');
  await signIn(stranger.page, 'stranger');
  await expect(stranger.page.locator('.auth-screen').getByRole('alert')).toContainText("isn't on the list");
});

test('a learner contributes a question; it goes live only after the owner approves it', async ({ browser }) => {
  const learner = await newPage(browser);
  await learner.page.goto('/');
  await signIn(learner.page, 'priya');
  await learner.page.locator('aside.sidebar').getByRole('button', { name: 'Contribute' }).click();
  await learner.page.getByRole('button', { name: 'Write a question' }).click();
  const form = learner.page.getByRole('form', { name: 'Submit a question' });
  await form.getByRole('textbox', { name: 'Question' }).fill('How would you debounce a search box?');
  await form.getByRole('textbox', { name: /Tags/ }).fill('react, performance');
  await form.getByRole('textbox', { name: /Your answer/ }).fill(
    '> [!TLDR]\n> Wait for typing to pause, abort the stale request, keep only the latest result.\n\n### How it works\n\n' +
      'A timer resets on every keystroke; when it fires, the request starts and the previous one is aborted. '.repeat(3),
  );
  await form.getByRole('button', { name: 'Send for review' }).click();
  await expect(learner.page.locator('.contrib-list')).toContainText('Waiting for review');

  // Not visible to anyone before review.
  const search = await learner.page.evaluate(() => fetch('/api/bootstrap').then((r) => r.text()));
  expect(search).not.toContain('debounce a search box');

  const owner = await newPage(browser);
  await owner.page.goto('/');
  await signIn(owner.page, OWNER);
  await owner.page.locator('aside.sidebar').getByRole('button', { name: /Admin/ }).click();
  await owner.page.getByRole('tab', { name: /Submissions/ }).click();
  await owner.page.locator('.contrib-list').getByRole('button', { name: 'Review' }).click();
  await owner.page.getByLabel(/Note to @priya/).fill('Great one, thanks!');
  await owner.page.getByRole('button', { name: 'Approve and add' }).click();
  await expect(owner.page.getByText(/Added “How would you debounce a search box\?”/)).toBeVisible();

  await learner.page.goto('/#how-would-you-debounce-a-search-box');
  await learner.page.reload();
  await learner.page.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(learner.page.locator('.contributor-line')).toContainText('@priya');
  expect([...learner.errors, ...owner.errors]).toEqual([]);
});
