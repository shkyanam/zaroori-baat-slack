import { test, expect, type Page } from '@playwright/test';
import { classifications, type Classification, type Message } from '../src/types';

function message(
  id: string,
  classification: Classification,
  priority: Message['priority'],
  score: number,
): Message {
  return {
    id,
    classification,
    priority,
    score,
    text: `${classification}: Review the complete context for ${id} before responding.`,
    sender: 'Synthetic teammate',
    channel: 'synthetic-review',
    created_at: '2026-09-12T06:30:00Z',
    reason: `This conversation has the ${classification} classification.`,
    suggested_action: 'Read the source and prepare a response.',
    decision: null,
    context: {},
    action_extraction: { items: [] },
    decision_memory: { items: [] },
  };
}

const fixtures: Message[] = [
  message('featured-incident', 'Incident', 'high', 99),
  message('featured-escalation', 'Escalation', 'high', 98),
  message('featured-action', 'Action Required', 'high', 97),
  {
    ...message('incident-high', 'Incident', 'high', 80),
    text:
      'A deployment needs investigation with the complete evidence preserved for the reviewer. ' +
      'Reference https://example.test/a-deliberately-long-unbroken-slack-source-reference-for-a-narrow-screen-check ' +
      'and confirm the next step before the release review.',
    channel: 'a-deliberately-long-channel-name-for-a-narrow-screen-check',
    action_extraction: {
      items: [
        {
          type: 'task',
          title: 'Check the deployment',
          owner: 'A deliberately long reviewer display name',
          due: 'Before the next release review',
          source_message_ids: ['incident-high'],
        },
      ],
    },
  },
  message('incident-medium', 'Incident', 'medium', 60),
  message('incident-low', 'Incident', 'low', 20),
  message('incident-extra', 'Incident', 'low', 30),
  message('escalation-medium', 'Escalation', 'medium', 55),
  message('action-medium', 'Action Required', 'medium', 50),
  message('question-low', 'Question', 'low', 20),
  message('approval-high', 'Approval Request', 'high', 75),
  message('decision-medium', 'Decision Needed', 'medium', 45),
  message('fyi-high', 'FYI', 'high', 90),
  message('fyi-low', 'FYI', 'low', 10),
];

const featuredIds = ['featured-incident', 'featured-escalation', 'featured-action'];

async function loadInbox(page: Page) {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.fulfill({ status: 405, json: { error: 'Synthetic UI checks are read only.' } });
      return;
    }
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/messages') {
      await route.fulfill({ json: { messages: fixtures } });
    } else if (pathname.startsWith('/api/messages/')) {
      const item = fixtures.find((fixture) => fixture.id === pathname.split('/').at(-1));
      await route.fulfill({ status: item ? 200 : 404, json: item || { error: 'Unknown source.' } });
    } else if (pathname === '/api/system/status') {
      await route.fulfill({
        json: {
          slack: { configured: true, channel_count: 1, last_sync_at: null },
          context: { enabled: false, external_sources: 'mock' },
          memory: { active: false, enabled: false, configured: false },
          workflow: {},
          demo: false,
        },
      });
    } else {
      await route.fulfill({ status: 404, json: { error: 'No synthetic data for this endpoint.' } });
    }
  });
  await page.goto('/#/inbox');
  await expect(
    page.getByRole('region', { name: 'Classified conversations', exact: true }),
  ).toBeVisible();
  return writes;
}

function queue(page: Page) {
  return page.getByRole('region', { name: 'Classified conversations', exact: true });
}

function typeFilter(page: Page, type: Classification | 'All types') {
  const container =
    type === 'All types'
      ? queue(page)
      : queue(page).getByRole('group', { name: 'Message types', exact: true });
  return container.getByRole('button', { name: new RegExp(`^${type}, \\d+ conversations?$`) });
}

function priorityFilter(page: Page, priority: 'Any' | 'High' | 'Medium' | 'Low') {
  return queue(page)
    .getByRole('group', { name: 'Message priorities', exact: true })
    .getByRole('button', { name: new RegExp(`^${priority} priority, \\d+ conversations?$`) });
}

function group(page: Page, type: Classification) {
  return queue(page).locator(`[data-testid="classification-group"][data-classification="${type}"]`);
}

async function visibleIds(page: Page) {
  return queue(page)
    .getByTestId('message-row')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-message-id')));
}

async function expectFeaturedUnchanged(page: Page) {
  await expect(page.getByTestId('focus-message')).toHaveAttribute(
    'data-message-id',
    featuredIds[0],
  );
  for (const id of featuredIds.slice(1)) {
    await expect(
      page.locator(`[data-testid="message-row"][data-message-id="${id}"]`),
    ).toBeVisible();
  }
}

test('the queue exposes every API type and priority using counts that exclude featured messages', async ({
  page,
}) => {
  const writes = await loadInbox(page);
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
  await expect(typeFilter(page, 'All types')).toHaveAccessibleName('All types, 11 conversations');
  await expect(typeFilter(page, 'Incident')).toHaveAccessibleName('Incident, 4 conversations');
  await expect(typeFilter(page, 'FYI')).toHaveAccessibleName('FYI, 2 conversations');
  await expect(priorityFilter(page, 'Any')).toHaveAccessibleName('Any priority, 11 conversations');
  await expect(priorityFilter(page, 'High')).toHaveAccessibleName('High priority, 3 conversations');
  await expect(priorityFilter(page, 'Medium')).toHaveAccessibleName(
    'Medium priority, 4 conversations',
  );
  await expect(priorityFilter(page, 'Low')).toHaveAccessibleName('Low priority, 4 conversations');
  await expect(typeFilter(page, 'All types')).toHaveAttribute('aria-pressed', 'true');
  await expect(priorityFilter(page, 'Any')).toHaveAttribute('aria-pressed', 'true');
  await expect(queue(page).getByTestId('classification-group')).toHaveCount(7);
  for (const type of classifications) {
    await expect(typeFilter(page, type)).toBeVisible();
    await expect(group(page, type)).toBeVisible();
    const row = group(page, type).getByTestId('message-row').first();
    await expect(row.getByText(type, { exact: true })).toBeVisible();
    await expect(row.getByText(/^(High|Medium|Low) priority$/)).toBeVisible();
  }
  const ids = await visibleIds(page);
  expect(ids).toHaveLength(9);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.some((id) => featuredIds.includes(id!))).toBe(false);
  await expect(queue(page).locator('[data-message-id="fyi-high"]')).toBeVisible();
  await expectFeaturedUnchanged(page);
  expect(writes).toEqual([]);
});

test('type and priority facets combine without changing the recommended conversations', async ({
  page,
}) => {
  const writes = await loadInbox(page);
  await typeFilter(page, 'Incident').click();
  await priorityFilter(page, 'High').click();
  await expect(typeFilter(page, 'Incident')).toHaveAttribute('aria-pressed', 'true');
  await expect(priorityFilter(page, 'High')).toHaveAttribute('aria-pressed', 'true');
  await expect(queue(page).getByTestId('classification-group')).toHaveCount(1);
  expect(await visibleIds(page)).toEqual(['incident-high']);
  await expectFeaturedUnchanged(page);

  await typeFilter(page, 'All types').click();
  await expect
    .poll(async () => (await visibleIds(page)).sort())
    .toEqual(['approval-high', 'fyi-high', 'incident-high']);
  await expect(priorityFilter(page, 'High')).toHaveAttribute('aria-pressed', 'true');
  await expectFeaturedUnchanged(page);
  expect(writes).toEqual([]);
});

test('section facets survive reload and preserve high priority FYI messages', async ({ page }) => {
  const writes = await loadInbox(page);
  await typeFilter(page, 'FYI').click();
  await priorityFilter(page, 'High').click();
  await expect(page).toHaveURL(/[?&]signal=FYI(?:&|$)/);
  await expect(page).toHaveURL(/[?&]urgency=high(?:&|$)/);
  await page.reload();
  await expect(typeFilter(page, 'FYI')).toHaveAttribute('aria-pressed', 'true');
  await expect(priorityFilter(page, 'High')).toHaveAttribute('aria-pressed', 'true');
  expect(await visibleIds(page)).toEqual(['fyi-high']);
  await expectFeaturedUnchanged(page);
  expect(writes).toEqual([]);
});

test('each classification expands independently without duplicate conversations', async ({
  page,
}) => {
  const writes = await loadInbox(page);
  const incidents = group(page, 'Incident');
  await expect(incidents.getByTestId('message-row')).toHaveCount(2);
  await incidents.getByRole('button', { name: 'Show 2 more in Incident', exact: true }).click();
  await expect(incidents.getByTestId('message-row')).toHaveCount(4);
  expect((await visibleIds(page)).sort()).toEqual(
    fixtures
      .filter((fixture) => !featuredIds.includes(fixture.id))
      .map((fixture) => fixture.id)
      .sort(),
  );
  const allIds = await page
    .locator('[data-message-id]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-message-id')));
  expect(new Set(allIds).size).toBe(allIds.length);
  await incidents.getByRole('button', { name: 'Show fewer in Incident', exact: true }).click();
  await expect(incidents.getByTestId('message-row')).toHaveCount(2);
  await expect(group(page, 'FYI').getByTestId('message-row')).toHaveCount(2);
  await expect(typeFilter(page, 'Incident')).toHaveAccessibleName('Incident, 4 conversations');
  expect(writes).toEqual([]);
});

test('an empty combination can reset the section filters without disturbing the hero', async ({
  page,
}) => {
  const writes = await loadInbox(page);
  await typeFilter(page, 'Question').click();
  await priorityFilter(page, 'High').click();
  await expect(queue(page).getByTestId('message-row')).toHaveCount(0);
  await queue(page)
    .getByRole('button', { name: 'Reset section filters', exact: true })
    .first()
    .click();
  await expect(typeFilter(page, 'All types')).toHaveAttribute('aria-pressed', 'true');
  await expect(priorityFilter(page, 'Any')).toHaveAttribute('aria-pressed', 'true');
  await expect(queue(page).getByTestId('classification-group')).toHaveCount(7);
  await expect(page).not.toHaveURL(/[?&](signal|urgency)=/);
  await expectFeaturedUnchanged(page);
  expect(writes).toEqual([]);
});

test('All messages includes the featured sources in its classification counts', async ({
  page,
}) => {
  const writes = await loadInbox(page);
  await page
    .getByRole('group', { name: 'Queue view', exact: true })
    .getByRole('button', { name: /^All messages 14$/ })
    .click();
  await expect(page.getByTestId('focus-message')).toHaveCount(0);
  await expect(typeFilter(page, 'All types')).toHaveAccessibleName('All types, 14 conversations');
  await expect(typeFilter(page, 'Incident')).toHaveAccessibleName('Incident, 5 conversations');
  await expect(typeFilter(page, 'Escalation')).toHaveAccessibleName('Escalation, 2 conversations');
  await expect(priorityFilter(page, 'High')).toHaveAccessibleName('High priority, 6 conversations');
  expect((await visibleIds(page)).sort()).toEqual(fixtures.map((fixture) => fixture.id).sort());
  expect(writes).toEqual([]);
});

test('a failed background refresh preserves classification filters and expanded groups', async ({
  page,
}) => {
  const writes = await loadInbox(page);
  await typeFilter(page, 'Incident').click();
  const incidents = group(page, 'Incident');
  await incidents.getByRole('button', { name: 'Show 2 more in Incident', exact: true }).click();
  await expect(incidents.getByTestId('message-row')).toHaveCount(4);
  await page.route('**/api/messages', async (route) => {
    if (!['GET', 'HEAD'].includes(route.request().method())) {
      writes.push(route.request().method());
      await route.fulfill({ status: 405, json: { error: 'Synthetic UI checks are read only.' } });
      return;
    }
    await route.fulfill({
      status: 503,
      json: { error: 'Refresh is temporarily unavailable.' },
    });
  });
  await page.getByRole('button', { name: 'Refresh queue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Refresh is temporarily unavailable.');
  await expect(typeFilter(page, 'Incident')).toHaveAttribute('aria-pressed', 'true');
  await expect(incidents.getByTestId('message-row')).toHaveCount(4);
  await expect(
    incidents.getByRole('button', { name: 'Show fewer in Incident', exact: true }),
  ).toBeVisible();
  await page.unroute('**/api/messages');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(typeFilter(page, 'Incident')).toHaveAttribute('aria-pressed', 'true');
  await expect(incidents.getByTestId('message-row')).toHaveCount(4);
  await expectFeaturedUnchanged(page);
  expect(writes).toEqual([]);
});

for (const width of [320, 390]) {
  test(`classification controls and grouped rows fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const writes = await loadInbox(page);
    for (const type of classifications) await expect(typeFilter(page, type)).toBeVisible();
    await typeFilter(page, 'Incident').click();
    await priorityFilter(page, 'High').click();
    await expect(queue(page).locator('[data-message-id="incident-high"]')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const overflowingRows = await queue(page)
      .getByTestId('message-row')
      .evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length);
    expect(overflowingRows).toBe(0);
    expect(writes).toEqual([]);
  });
}

test('a grouped conversation opens by keyboard and closing restores the selected row', async ({
  page,
}) => {
  const writes = await loadInbox(page);
  const row = queue(page).locator('[data-testid="message-row"][data-message-id="incident-high"]');
  const source = fixtures.find((fixture) => fixture.id === 'incident-high')!;
  const preview = row.getByTestId('conversation-preview');
  expect((await preview.textContent())!.length).toBeLessThan(source.text.length);
  await expect(row.getByText('Read conversation', { exact: true })).toBeVisible();
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/[?&]message=incident-high(?:&|$)/);
  await expect(page.getByRole('button', { name: 'Review response', exact: true })).toBeVisible();
  const detail = page.getByRole('region', { name: 'Message detail', exact: true });
  await detail.getByText('Original message', { exact: true }).click();
  const original = detail.locator('details').filter({ hasText: 'Original message' }).locator('p');
  expect(await original.textContent()).toBe(source.text);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toBeFocused();
  expect(writes).toEqual([]);
});
