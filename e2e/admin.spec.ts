import { expect, test, type Page } from '@playwright/test';

/**
 * Admin features only exist when hosted as a claude.ai Artifact. These tests
 * install an in-memory stand-in for `window.claude` that enforces the same
 * access rules we publish (see docs/ADMIN.md).
 */
function installMock(page: Page, role: 'owner' | 'learner' | 'viewer', uid: string, seed: Record<string, unknown>) {
  return page.addInitScript(
    ({ role, uid, seed }) => {
      const store = new Map<string, unknown>(Object.entries(seed));
      Object.assign(window, { __DB: store });
      const listeners = new Set<() => void>();
      const canRead = (path: string) =>
        path.startsWith('learners/') ? role === 'owner' || path === `learners/${uid}` : path.startsWith('data/users/') ? path.startsWith(`data/users/${uid}/`) : true;
      const canWrite = (path: string) =>
        role === 'viewer' ? false : path.startsWith('config/') ? role === 'owner' : path.startsWith('learners/') ? path === `learners/${uid}` : path.startsWith(`data/users/${uid}/`);
      const snap = (path: string) => ({
        id: path.split('/').pop(),
        exists: store.has(path) && canRead(path),
        data: () => (canRead(path) ? store.get(path) : undefined),
        metadata: { fromCache: false, hasPendingWrites: false },
      });
      const notify = () => listeners.forEach((fn) => fn());
      const doc = (path: string) => ({
        set: async (data: unknown) => {
          if (!canWrite(path)) throw { code: 'invalid_argument', message: 'denied' };
          store.set(path, JSON.parse(JSON.stringify(data)));
          setTimeout(notify, 0);
        },
        delete: async () => void store.delete(path),
        onSnapshot: (next: (s: unknown) => void) => {
          const fn = () => next(snap(path));
          listeners.add(fn);
          setTimeout(fn, 0);
          return () => listeners.delete(fn);
        },
      });
      const query = (prefix: string): unknown => ({
        orderBy: () => query(prefix),
        limit: () => query(prefix),
        doc: (id: string) => doc(`${prefix}/${id}`),
        onSnapshot: (next: (s: unknown) => void) => {
          const fn = () => {
            const docs = [...store.keys()].filter((k) => k.startsWith(`${prefix}/`) && canRead(k)).map(snap);
            next({ docs, size: docs.length, empty: docs.length === 0 });
          };
          listeners.add(fn);
          setTimeout(fn, 0);
          return () => listeners.delete(fn);
        },
      });
      const names: Record<string, string> = { u_owner: 'Owner', u_priya: 'Priya S' };
      const user = {
        id: async () => uid,
        isOwner: async () => role === 'owner',
        canEdit: async () => role === 'owner',
        can: async () => role !== 'viewer',
        profiles: async (ids: string[]) =>
          Object.fromEntries(ids.map((id) => [id, { id, name: names[id] ?? '', avatarUrl: '', color: '#888', isMe: id === uid, guest: false }])),
      };
      const db = { doc, collection: query };
      Object.assign(window, { claude: { use: async (name: string) => (name === 'db' ? db : name === 'user' ? user : null) } });
    },
    { role, uid, seed },
  );
}

const seed = {
  'learners/u_priya': { version: 1, doneCount: 41, total: 109, byRound: { 'javascript-internals': 8 }, lastActiveAt: 1, lastSectionId: 'machine-coding' },
  'config/announcement': { message: 'Mock interview on Saturday.', updatedAt: 5 },
};

test('owner sees Admin, the learner dashboard, and can publish an announcement', async ({ page }) => {
  await installMock(page, 'owner', 'u_owner', seed);
  await page.goto('/');
  await expect(page.locator('.announcement')).toContainText('Mock interview on Saturday.');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /Admin/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Admin');
  await expect(page.locator('.learners-table')).toContainText('Priya S');
  await expect(page.locator('.learners-table tbody tr')).toHaveCount(2); // Priya + the owner, registered on open

  await page.locator('#announcement-text').fill('New round added.');
  await page.getByRole('button', { name: 'Publish announcement' }).click();
  await expect(page.locator('.announcement')).toContainText('New round added.');
});

test('learners never see Admin and are told what the owner can see', async ({ page }) => {
  await installMock(page, 'learner', 'u_priya', seed);
  await page.goto('/#admin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Only the owner can open this page');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /Admin/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toContainText('can see a summary of your progress');
});

test('view-only visitors keep progress in their browser', async ({ page }) => {
  await installMock(page, 'viewer', 'u_view', seed);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Performance' }).click();
  await page.locator('.q').first().getByRole('checkbox').check();
  await expect(page.locator('.sidebar .sync-line')).toHaveText('Saved in this browser only', { timeout: 5000 });
});
