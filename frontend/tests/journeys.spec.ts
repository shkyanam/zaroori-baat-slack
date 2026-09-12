import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Message } from '../src/types';

const legacyDemoText =
  'Production is blocked. Please review the deployment failure and assign an owner today.';
const designDemoText =
  '<@Mitesh> Please review the new message detail layout before tomorrow. We need feedback on the evidence panel, owner visibility, and the defer journey. Mitesh will own the design walkthrough with the group.';

async function messages(request: APIRequestContext): Promise<Message[]> {
  const response = await request.get('/api/messages');
  expect(response.ok(), 'The local Python API must be running with demo data').toBeTruthy();
  return (await response.json()).messages as Message[];
}

async function setReview(request: APIRequestContext, id: string, decision: string) {
  const response = await request.post(`/api/messages/${encodeURIComponent(id)}/decision`, {
    data: { decision },
  });
  expect(response.ok(), `Unable to set demo fixture review to ${decision}`).toBeTruthy();
}

const test = base.extend<{ demo: Message; runtimeErrors: void }>({
  demo: async ({ request }, use) => {
    const allMessages = await messages(request);
    const demo =
      allMessages.find((message) => message.text === designDemoText) ||
      allMessages.find((message) => message.text === legacyDemoText);
    expect(demo, 'Seed the documented demo database before running mutation journeys').toBeTruthy();
    const fixture = demo!;
    const previousDecision = fixture.decision || 'pending';
    await setReview(request, fixture.id, 'pending');
    try {
      await use({ ...fixture, decision: null });
    } finally {
      await setReview(request, fixture.id, previousDecision);
    }
  },
  runtimeErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
          errors.push(message.text());
      });
      await use();
      expect(errors, 'The journey should not produce browser runtime errors').toEqual([]);
    },
    { auto: true },
  ],
});

async function openDemo(page: Page, demo: Message) {
  await page.goto(`/#/inbox?message=${encodeURIComponent(demo.id)}`);
  await expect(page.getByRole('region', { name: 'Message detail', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review response', exact: true })).toBeVisible();
}

function queueTrigger(page: Page, messageId: string) {
  // As reviews are saved, this conversation can become the main focus card.
  return page
    .locator(`[data-testid="message-row"][data-message-id="${messageId}"]`)
    .or(
      page
        .locator(`[data-testid="focus-message"][data-message-id="${messageId}"]`)
        .getByRole('button', { name: 'Review this', exact: true }),
    );
}

async function decide(page: Page) {
  await page.getByRole('button', { name: 'Decide', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve review', exact: true })).toBeVisible();
}

async function closeDetail(page: Page) {
  await page.getByRole('button', { name: 'Close message detail', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Message detail', exact: true })).toHaveCount(0);
}

async function expectOriginalMessage(page: Page, text: string) {
  const detail = page.getByRole('region', { name: 'Message detail', exact: true });
  await detail.getByRole('button', { name: 'Understand', exact: true }).click();
  await detail.getByText('Original message', { exact: true }).click();
  await expect(detail).toContainText(text);
}

async function expectSavedDecision(
  request: APIRequestContext,
  id: string,
  decision: string | null,
) {
  await expect
    .poll(async () => {
      const response = await request.get(`/api/messages/${encodeURIComponent(id)}`);
      return (await response.json()).decision ?? null;
    })
    .toBe(decision);
}

for (const review of [
  { button: 'Approve review', status: 'approved' },
  { button: 'Dismiss', status: 'dismissed' },
]) {
  test(`${review.button} persists in Reviewed after reload and can be reopened`, async ({
    page,
    request,
    demo,
  }) => {
    await openDemo(page, demo);
    await decide(page);
    await page.getByRole('button', { name: review.button, exact: true }).click();
    await expectSavedDecision(request, demo.id, review.status);
    await closeDetail(page);
    await page.getByRole('link', { name: 'Reviewed', exact: true }).click();
    await page.reload();
    await queueTrigger(page, demo.id).click();
    await expect(page.getByRole('button', { name: 'Reopen review', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reopen review', exact: true }).click();
    await expectSavedDecision(request, demo.id, null);
    await page.goto('/#/inbox');
    await expect(queueTrigger(page, demo.id)).toBeVisible();
  });
}

test('defer moves a message out of Needs review and can be reopened from Deferred', async ({
  page,
  request,
  demo,
}) => {
  await openDemo(page, demo);
  await decide(page);
  await page.getByRole('button', { name: 'Defer', exact: true }).click();
  await expectSavedDecision(request, demo.id, 'deferred');
  await page.goto('/#/inbox');
  await expect(queueTrigger(page, demo.id)).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Queue view', exact: true })
    .getByRole('button', { name: /^Deferred \d+$/ })
    .click();
  await queueTrigger(page, demo.id).click();
  await page.getByRole('button', { name: 'Reopen review', exact: true }).click();
  await expectSavedDecision(request, demo.id, null);
});

test('search and category filters combine, clear, and survive a reload', async ({ page, demo }) => {
  await page.goto('/#/inbox');
  await page.getByRole('button', { name: 'Search & filter', exact: true }).click();
  await page.getByRole('textbox', { name: 'Inbox search', exact: true }).fill(demo.sender);
  await page.getByLabel('Category', { exact: true }).selectOption(demo.classification);
  await expect(queueTrigger(page, demo.id)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Inbox search', exact: true })).toHaveValue(
    demo.sender,
  );
  await page
    .getByRole('textbox', { name: 'Inbox search', exact: true })
    .fill('zz-no-message-matches-874209');
  await expect(page.getByTestId('message-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Inbox search', exact: true })).toHaveValue('');
  await expect(queueTrigger(page, demo.id)).toBeVisible();
  await page.getByRole('textbox', { name: 'Inbox search', exact: true }).fill('all');
  await expect(page.getByRole('textbox', { name: 'Inbox search', exact: true })).toHaveValue('all');
  await expect(page).toHaveURL(/[?&]q=all(?:&|$)/);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Inbox search', exact: true })).toHaveValue('all');
  await expect(page).toHaveURL(/[?&]q=all(?:&|$)/);
});

test('failed initial load has a retry that recovers the message queue', async ({ page }) => {
  await page.route('**/api/messages', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'The test service is temporarily unavailable.' }),
    }),
  );
  await page.goto('/#/inbox');
  await expect(page.getByRole('alert')).toContainText(
    'The test service is temporarily unavailable.',
  );
  await page.unroute('**/api/messages');
  await page.getByRole('button', { name: /retry/i }).click();
  await expect(page.getByTestId('message-row').first()).toBeVisible();
});

test('a failed review keeps the recommendation available for retry', async ({
  page,
  request,
  demo,
}) => {
  await openDemo(page, demo);
  await decide(page);
  const decisionEndpoint = `**/api/messages/${demo.id}/decision`;
  await page.route(decisionEndpoint, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Review could not be saved. Please retry.' }),
    }),
  );
  await page.getByRole('button', { name: 'Approve review', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Review could not be saved. Please retry.');
  await expectSavedDecision(request, demo.id, null);
  await expect(page.getByRole('button', { name: 'Approve review', exact: true })).toBeEnabled();
  await page.unroute(decisionEndpoint);
  await page.getByRole('button', { name: 'Approve review', exact: true }).click();
  await expectSavedDecision(request, demo.id, 'approved');
});

test('the focus recommendation leads through a saved review to the next conversation', async ({
  page,
  request,
}) => {
  const allMessages = await messages(request);
  const ranks = { high: 0, medium: 1, low: 2 };
  const pending = allMessages
    .filter((message) => !message.decision)
    .sort(
      (a, b) =>
        ranks[a.priority] - ranks[b.priority] ||
        b.score - a.score ||
        Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  expect(pending.length, 'The focus journey needs two pending conversations').toBeGreaterThan(1);
  const first = pending[0];
  try {
    await page.goto('/#/inbox');
    const start = page.getByRole('button', { name: 'Review this', exact: true });
    await expect(start).toBeInViewport({ ratio: 1 });
    await start.click();
    await expect(page).toHaveURL(new RegExp(`[?&]message=${first.id}(?:&|$)`));
    await page.getByRole('button', { name: 'Review response', exact: true }).click();
    await page.getByRole('button', { name: 'Continue to decision', exact: true }).click();
    await page.getByRole('button', { name: 'Approve review', exact: true }).click();
    await expectSavedDecision(request, first.id, 'approved');
    await expect(
      page.getByRole('heading', { name: 'Approval recorded', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Next conversation', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]message=${pending[1].id}(?:&|$)`));
    await expect(page.getByRole('button', { name: 'Review response', exact: true })).toBeVisible();
  } finally {
    await setReview(request, first.id, 'pending');
  }
});

test('guided review traps keyboard focus and Escape returns to the selected conversation', async ({
  page,
  demo,
}) => {
  await page.goto('/#/inbox');
  const trigger = queueTrigger(page, demo.id);
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 18; index += 1) {
    await page.keyboard.press('Tab');
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      trigger.evaluate(
        (element) => element === document.activeElement || element.contains(document.activeElement),
      ),
    )
    .toBe(true);
});

test('mobile inbox and detail fit the viewport and return to the queue', async ({ page, demo }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/inbox');
  await queueTrigger(page, demo.id).click();
  await expect(page.getByRole('button', { name: 'Review response', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await closeDetail(page);
  await expect(queueTrigger(page, demo.id)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test('action items can be searched and opened in their source conversation', async ({
  page,
  demo,
}) => {
  await page.goto('/#/actions');
  await expect(page.getByRole('heading', { name: 'Action items', exact: true })).toBeVisible();
  const collection = page.getByRole('region', { name: 'Extracted action items', exact: true });
  const tasks = page
    .getByRole('group', { name: 'Action item type', exact: true })
    .getByRole('button', { name: /^Tasks \d+$/ });
  await tasks.click();
  const source = collection.locator(`[data-message-id="${demo.id}"]`).first();
  await expect(source).toBeVisible();
  await page.getByRole('button', { name: 'Search & filter', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Search action items', exact: true })
    .fill('zz-no-action-matches-874209');
  await expect(
    page.getByRole('heading', { name: 'No items match these filters', exact: true }),
  ).toBeVisible();
  await collection.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await tasks.click();
  await source.getByRole('link', { name: 'View source', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/#/inbox\\?message=${demo.id}$`));
  await expect(page.getByRole('button', { name: 'Review response', exact: true })).toBeVisible();
});

test('decision memory browses records, searches local evidence, and explains no matches', async ({
  page,
  request,
}) => {
  const originalDecision = (await messages(request)).find((message) =>
    message.text.startsWith('We decided to use SQLite for the local pilot.'),
  );
  expect(originalDecision, 'The seeded original SQLite decision must exist').toBeTruthy();
  await page.goto('/#/memory');
  const records = page.getByRole('region', { name: 'Extracted decisions', exact: true });
  await expect(
    records.getByRole('link', { name: 'View source', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search decision memory', exact: true }).fill('SQLite');
  await page.getByRole('button', { name: 'Search memory', exact: true }).click();
  const results = page.getByRole('region', { name: 'Memory search results', exact: true });
  await expect(
    results.getByRole('heading', { name: 'Supporting records', exact: true }),
  ).toBeVisible();
  await expect(results).toContainText('SQLite');
  const sources = results.getByRole('link', { name: 'View source message', exact: true });
  await expect(sources.first()).toBeVisible();
  for (const source of await sources.all()) {
    await expect(source).toHaveAttribute(
      'href',
      new RegExp(`^/?#/inbox\\?message=${originalDecision!.id}$`),
    );
  }
  await sources.first().click();
  await expectOriginalMessage(page, originalDecision!.text);
  await page.goto('/#/memory');
  await page
    .getByRole('searchbox', { name: 'Search decision memory', exact: true })
    .fill('zznomatchingdecision874209');
  await page.getByRole('button', { name: 'Search memory', exact: true }).click();
  await expect(
    results.getByRole('heading', { name: 'No matching decision found', exact: true }),
  ).toBeVisible();
  await results.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(results).toHaveCount(0);
  await expect(
    records.getByRole('link', { name: 'View source', exact: true }).first(),
  ).toBeVisible();
});

test('display density persists after reload and makes the inbox more compact', async ({ page }) => {
  await page.goto('/#/inbox');
  const row = page.getByTestId('message-row').last();
  await expect(row).toBeVisible();
  const comfortableHeight = (await row.boundingBox())!.height;
  await page.getByRole('link', { name: 'System', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'System & preferences', exact: true }),
  ).toBeVisible();
  const density = page.getByRole('group', { name: 'Inbox density', exact: true });
  await density.getByRole('button', { name: 'Compact', exact: true }).click();
  await expect(density.getByRole('button', { name: 'Compact', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await expect(density.getByRole('button', { name: 'Compact', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('/#/inbox');
  await expect(row).toBeVisible();
  await expect.poll(async () => (await row.boundingBox())!.height).toBeLessThan(comfortableHeight);
});

test('background refresh failure preserves loaded messages and retry recovers', async ({
  page,
}) => {
  await page.goto('/#/inbox');
  await expect(page.getByTestId('message-row').first()).toBeVisible();
  const originalCount = await page.getByTestId('message-row').count();
  await page.route('**/api/messages', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Refresh is temporarily unavailable.' }),
    }),
  );
  await page.getByRole('button', { name: 'Refresh queue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Refresh is temporarily unavailable.');
  await expect(page.getByTestId('message-row')).toHaveCount(originalCount);
  await page.unroute('**/api/messages');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('message-row')).toHaveCount(originalCount);
});

test('supporting workspaces fit a mobile viewport and navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/inbox');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Slack workspace', exact: true })
    .getByRole('link', { name: 'Action items', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Action items', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Slack workspace', exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  for (const [route, title] of [
    ['memory', 'Decision memory'],
    ['system', 'System & preferences'],
  ]) {
    await page.goto(`/#/${route}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
});

test('keyboard users can skip navigation and close help without losing their place', async ({
  page,
}) => {
  await page.goto('/#/actions');
  await expect(page.getByRole('heading', { name: 'Action items', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(/\/#\/actions$/);
  const helpButton = page.getByRole('button', { name: 'How it works', exact: true });
  await helpButton.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(helpButton).toBeFocused();
});

test('an edited response survives refresh and navigation, can be copied, and can be reset', async ({
  page,
  context,
  demo,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDemo(page, demo);
  await page.getByRole('button', { name: 'Review response', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Suggested response draft', exact: true });
  const original = await draft.inputValue();
  expect(original.length).toBeGreaterThan(0);
  const edited = 'I will review the evidence panel and share specific feedback with the group.';
  await draft.fill(edited);
  await page.getByRole('button', { name: 'Understand', exact: true }).click();
  await page.getByText('Context & sources', { exact: true }).click();
  await page.getByRole('button', { name: 'Refresh analysis', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare', exact: true }).click();
  await expect(draft).toHaveValue(edited);
  await page.goto('/#/actions');
  await openDemo(page, demo);
  await page.reload();
  await page.getByRole('button', { name: 'Review response', exact: true }).click();
  await expect(draft).toHaveValue(edited);
  await page.getByRole('button', { name: 'Copy response', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(edited);
  await page.getByRole('button', { name: 'Reset response draft', exact: true }).click();
  await expect(draft).toHaveValue(original);
});

test('All messages includes reviewed and deferred messages and survives a reload', async ({
  page,
  request,
}) => {
  const allMessages = await messages(request);
  expect(
    allMessages.some((message) => message.decision),
    'This journey needs reviewed demo examples',
  ).toBe(true);
  await page.goto('/#/inbox');
  await expect(page.getByTestId('focus-message')).toBeVisible();
  const allTab = page
    .getByRole('group', { name: 'Queue view', exact: true })
    .getByRole('button', { name: /^All messages \d+$/ });
  await allTab.click();
  await expect(allTab).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('message-row')).toHaveCount(allMessages.length);
  await page.reload();
  await expect(allTab).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('message-row')).toHaveCount(allMessages.length);
  await page
    .getByRole('group', { name: 'Queue view', exact: true })
    .getByRole('button', { name: /^Needs review/ })
    .click();
  await expect(page.getByTestId('focus-message')).toBeVisible();
  for (const reviewed of allMessages.filter((message) => message.decision)) {
    await expect(page.locator(`[data-message-id="${reviewed.id}"]`)).toHaveCount(0);
  }
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`guided stages and review controls fit at ${viewport.width}x${viewport.height}`, async ({
    page,
    demo,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/inbox');
    await expect(page.getByTestId('message-row').first()).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('inbox.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await openDemo(page, demo);
    const detail = page.getByRole('region', { name: 'Message detail', exact: true });
    const next = detail.getByRole('button', { name: 'Review response', exact: true });
    await expect(next).toBeInViewport({ ratio: 1 });
    await expect(detail.getByRole('button', { name: 'Approve review', exact: true })).toHaveCount(
      0,
    );
    await page.screenshot({
      path: testInfo.outputPath('understand.png'),
      fullPage: false,
      animations: 'disabled',
    });
    await next.click();
    const continueButton = detail.getByRole('button', {
      name: 'Continue to decision',
      exact: true,
    });
    await expect(continueButton).toBeInViewport({ ratio: 1 });
    await expect(
      detail.getByRole('textbox', { name: 'Suggested response draft', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('prepare.png'),
      fullPage: false,
      animations: 'disabled',
    });
    await continueButton.click();
    for (const name of ['Approve review', 'Defer', 'Dismiss']) {
      await expect(detail.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('decide.png'),
      fullPage: false,
      animations: 'disabled',
    });
  });
}

test('repeated extracted actions appear once and link to their original message', async ({
  page,
  request,
}) => {
  const allMessages = await messages(request);
  const original = allMessages.find((message) =>
    message.text.startsWith('The inbox prototype now places the original Slack message above'),
  );
  expect(original, 'The seeded original keyboard-review request must exist').toBeTruthy();
  const title = 'validate the keyboard navigation before tomorrow';
  const references = allMessages
    .flatMap((message) => message.action_extraction?.items || [])
    .filter((item) => item.title === title && item.source_message_ids?.includes(original!.id));
  expect(
    references.length,
    'The fixture must exercise repeated references across conversations',
  ).toBeGreaterThan(1);
  await page.goto('/#/actions');
  const collection = page.getByRole('region', { name: 'Extracted action items', exact: true });
  const tasks = collection.getByRole('region', { name: 'Tasks', exact: true });
  await expect(tasks.getByRole('article')).toHaveCount(3);
  await tasks.getByRole('button', { name: /^Show \d+ more tasks$/ }).click();
  await expect.poll(() => tasks.getByRole('article').count()).toBeGreaterThan(3);
  const heading = collection.getByRole('heading', { name: title, exact: true });
  await expect(heading).toHaveCount(1);
  const row = collection.getByRole('article').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  });
  await expect(row).toHaveAttribute('data-message-id', original!.id);
  const source = row.getByRole('link', { name: 'View source', exact: true });
  await expect(source).toHaveAttribute('href', new RegExp(`^/?#/inbox\\?message=${original!.id}$`));
  await source.click();
  await expectOriginalMessage(page, original!.text);
});
