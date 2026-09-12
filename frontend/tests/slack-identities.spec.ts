import { expect, test, type Page } from '@playwright/test';
import type { Message } from '../src/types';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'identity-source',
    sender: 'U_IDENTITY_ONE',
    sender_name: 'Asha Patel',
    channel: 'C_RELEASE_ONE',
    channel_name: 'release-team',
    text: 'Please review the deployment checks before the release.',
    created_at: '2026-09-12T06:30:00Z',
    priority: 'high',
    classification: 'Incident',
    score: 99,
    reason: 'The release requires a review.',
    suggested_action: 'Check the release evidence.',
    context: {
      suggested_response: 'I will review the checks.',
      related_messages: [
        {
          id: 'related-source',
          sender: 'U_IDENTITY_RELATED',
          sender_name: 'Sam Chen',
          channel: 'C_PLATFORM',
          channel_name: 'platform-help',
          text: 'The deployment checks are ready.',
        },
      ],
    },
    action_extraction: {
      items: [
        {
          type: 'task',
          title: 'Inspect deployment checks',
          owner: 'Assigned reviewer',
          source: 'Slack channel C_RELEASE_ONE',
          source_message_ids: ['identity-source'],
        },
      ],
    },
    decision_memory: {
      items: [
        {
          decision: 'Use the staged release plan.',
          source_message_ids: ['identity-source'],
        },
      ],
    },
    ...overrides,
  };
}

const fixtures = [
  message(),
  message({
    id: 'second-source',
    sender: 'U_IDENTITY_TWO',
    sender_name: 'Noor Ahmed',
    channel: 'C_RELEASE_TWO',
    channel_name: 'release-team',
    score: 70,
    text: 'Confirm the next planning review.',
    action_extraction: { items: [] },
    decision_memory: {
      items: [{ decision: 'Keep the planning review.', source_message_ids: ['second-source'] }],
    },
  }),
  message({
    id: 'reviewed-source',
    sender: 'U_IDENTITY_REVIEWED',
    sender_name: 'Mira Shah',
    channel: 'C_DESIGN',
    channel_name: 'design-studio',
    decision: 'approved',
    text: 'The design review is complete.',
    action_extraction: { items: [] },
    decision_memory: { items: [] },
  }),
];

async function mockApi(page: Page, messages = fixtures) {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(request.method());
      await route.fulfill({ status: 405, json: { error: 'Identity checks are read only.' } });
      return;
    }
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/messages') {
      await route.fulfill({ json: { messages } });
    } else if (pathname === '/api/system/status') {
      await route.fulfill({
        json: {
          slack: { configured: true, channel_count: 3, last_sync_at: null },
          context: { enabled: false, external_sources: 'mock' },
          memory: { active: false, enabled: false, configured: false },
          workflow: {},
          demo: false,
        },
      });
    } else if (pathname === '/api/decision-memory/search') {
      await route.fulfill({
        json: {
          provider: 'local',
          matches: [
            {
              memory: 'Staged rollout keeps the release reviewable.',
              metadata: { source_message_id: 'identity-source', channel: 'C_RELEASE_ONE' },
            },
            {
              memory: 'A previous team decision.',
              metadata: { channel: 'C_ARCHIVE', channel_name: 'team-archive' },
            },
          ],
        },
      });
    } else if (pathname === '/api/observability/summary') {
      await route.fulfill({
        json: {
          metrics: { total_runs: 1, completed_runs: 1, failed_runs: 0 },
          recent_runs: [
            {
              run_id: 'identity-run',
              channel: 'C_RELEASE_ONE',
              channel_name: 'release-team',
              status: 'completed',
            },
          ],
        },
      });
    } else {
      await route.fulfill({ status: 404, json: { error: 'Unknown synthetic endpoint.' } });
    }
  });
  return writes;
}

test('sender and channel names follow the hero, related conversations, and review stages', async ({
  page,
}) => {
  const writes = await mockApi(page, [
    message({
      action_extraction: {
        items: [
          ...message().action_extraction.items!,
          { type: 'task', title: 'Review related evidence', source: 'Slack channel C_PLATFORM' },
          {
            type: 'task',
            title: 'Check the source note',
            source: 'Release notes for C_RELEASE_ONE',
          },
        ],
      },
    }),
  ]);
  await page.goto('/#/inbox');
  const hero = page.getByTestId('focus-message');
  await expect(hero.getByText('Asha Patel', { exact: true })).toBeVisible();
  await expect(hero.locator('[data-slack-source]')).toContainText('Slack');
  await expect(hero.getByText('#release-team', { exact: true })).toBeVisible();
  await expect(hero).not.toContainText('U_IDENTITY_ONE');
  await expect(hero).not.toContainText('C_RELEASE_ONE');
  await hero.getByRole('button', { name: 'Review this', exact: true }).click();
  const detail = page.getByRole('region', { name: 'Message detail', exact: true });
  await expect(detail.getByText('#release-team', { exact: true })).toBeVisible();
  await expect(detail).toContainText('Asha Patel');
  await detail.getByText('Context & sources', { exact: true }).click();
  await detail.getByText('Related conversations (1)', { exact: true }).click();
  await expect(detail.getByText('Sam Chen', { exact: true })).toBeVisible();
  await expect(detail.getByText('#platform-help', { exact: true })).toBeVisible();
  await detail.getByText('Work & decisions', { exact: true }).click();
  await expect(detail.getByText('Slack channel #release-team', { exact: false })).toBeVisible();
  await expect(detail.getByText('Slack channel #platform-help', { exact: false })).toBeVisible();
  await expect(detail.getByText('Release notes for C_RELEASE_ONE', { exact: false })).toBeVisible();
  await detail.getByText('Original message', { exact: true }).click();
  await expect(detail.locator('p').filter({ hasText: message().text })).toBeVisible();
  await detail.getByRole('button', { name: 'Prepare', exact: true }).click();
  await expect(detail.getByText('To Asha Patel', { exact: false })).toBeVisible();
  await expect(detail.getByText('#release-team', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Decide', exact: true }).click();
  await expect(detail.getByText('#release-team', { exact: true })).toBeVisible();
  await expect(detail.getByText('Assigned reviewer', { exact: true })).toBeVisible();
  await expect(detail).not.toContainText('U_IDENTITY_ONE');
  expect(writes).toEqual([]);
});

test('channel filters show names while duplicate channel names retain distinct ID values and routes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await mockApi(page);
  await page.goto('/#/inbox?view=all');
  await page.getByRole('button', { name: 'Search & filter', exact: true }).click();
  const channels = page.getByRole('combobox', { name: 'Channel', exact: true });
  await expect(channels.locator('option[value="C_RELEASE_ONE"]')).toHaveText('#release-team');
  await expect(channels.locator('option[value="C_RELEASE_TWO"]')).toHaveText('#release-team');
  await channels.selectOption('C_RELEASE_TWO');
  await expect(page).toHaveURL(/[?&]channel=C_RELEASE_TWO(?:&|$)/);
  await expect(page.getByTestId('message-row')).toHaveCount(1);
  await expect(page.getByTestId('message-row')).toHaveAttribute('data-message-id', 'second-source');
  await expect(page.getByTestId('message-row')).toContainText('Noor Ahmed');
  await page.reload();
  await expect(channels).toHaveValue('C_RELEASE_TWO');
  await expect(page.getByTestId('message-row')).toHaveAttribute('data-message-id', 'second-source');
  await channels.selectOption('all');
  const search = page.getByRole('textbox', { name: 'Inbox search', exact: true });
  for (const query of ['Asha Patel', 'U_IDENTITY_ONE', 'C_RELEASE_ONE']) {
    await search.fill(query);
    await expect(page.getByTestId('message-row')).toHaveCount(1);
    await expect(page.getByTestId('message-row')).toHaveAttribute(
      'data-message-id',
      'identity-source',
    );
  }
  await search.fill('release-team');
  await expect(page.getByTestId('message-row')).toHaveCount(2);
  expect(writes).toEqual([]);
});

test('reviewed rows and saved receipts use resolved names without another save', async ({
  page,
}) => {
  const writes = await mockApi(page);
  await page.goto('/#/reviewed');
  const row = page.getByTestId('message-row');
  await expect(row).toContainText('Mira Shah');
  await expect(row).toContainText('#design-studio');
  await row.click();
  const detail = page.getByRole('region', { name: 'Message detail', exact: true });
  await detail.getByRole('button', { name: 'Decide', exact: true }).click();
  await expect(detail.getByText('#design-studio', { exact: true })).toBeVisible();
  await expect(detail.getByText('Mira Shah', { exact: true })).toBeVisible();
  await expect(detail).not.toContainText('U_IDENTITY_REVIEWED');
  expect(writes).toEqual([]);
});

test('unresolved and legacy names remain readable fallbacks', async ({ page }) => {
  const writes = await mockApi(page, [message({ sender_name: ' ', channel_name: undefined })]);
  await page.goto('/#/inbox');
  const hero = page.getByTestId('focus-message');
  await expect(hero.getByText('U_IDENTITY_ONE', { exact: true })).toBeVisible();
  await expect(hero.getByText('#C_RELEASE_ONE', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('action sources, memory filters, workflow runs, and the legacy UI use names', async ({
  page,
}) => {
  const writes = await mockApi(page);
  await page.goto('/#/actions');
  await expect(page.getByRole('main').getByText('#release-team', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Search & filter', exact: true }).click();
  const actionSearch = page.getByRole('searchbox', { name: 'Search action items', exact: true });
  await actionSearch.fill('Asha Patel');
  await expect(
    page.getByRole('heading', { name: 'Inspect deployment checks', exact: true }),
  ).toBeVisible();
  await actionSearch.fill('U_IDENTITY_ONE');
  await expect(
    page.getByRole('heading', { name: 'Inspect deployment checks', exact: true }),
  ).toBeVisible();
  await page.goto('/#/memory');
  const channels = page.getByRole('combobox', { name: 'Filter decisions by channel', exact: true });
  await expect(channels.locator('option[value="C_RELEASE_TWO"]')).toHaveText('#release-team');
  await channels.selectOption('C_RELEASE_TWO');
  await expect(
    page.getByRole('heading', { name: 'Keep the planning review.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Use the staged release plan.', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('searchbox', { name: 'Search decision memory', exact: true })
    .fill('release');
  await page.getByRole('button', { name: 'Search memory', exact: true }).click();
  const results = page.getByRole('region', { name: 'Memory search results', exact: true });
  await expect(results.getByText('#release-team', { exact: true })).toBeVisible();
  await expect(results.getByText('#team-archive', { exact: true })).toBeVisible();
  await expect(results).not.toContainText('C_RELEASE_ONE');
  await page.goto('/#/system');
  await page.locator('summary').filter({ hasText: 'Explore workflow details' }).click();
  await expect(page.getByRole('cell', { name: '#release-team', exact: false })).toBeVisible();
  await page.goto('/legacy');
  const legacyMessage = page.locator('#queue > .message').first();
  await expect(legacyMessage.locator('.metadata')).toContainText('from Asha Patel');
  await expect(legacyMessage.locator('.metadata')).toContainText('#release-team');
  await expect(legacyMessage.locator('.action-meta')).toContainText(
    'Source: Slack channel #release-team',
  );
  await legacyMessage.getByText('Related Slack messages (1)', { exact: true }).click();
  await expect(legacyMessage.locator('.related-message')).toContainText('Sam Chen');
  await expect(legacyMessage.locator('.related-message')).toContainText('#platform-help');
  await expect(legacyMessage).not.toContainText('U_IDENTITY_ONE');
  await expect(legacyMessage).not.toContainText('C_RELEASE_ONE');
  await expect(page.locator('#observability-runs')).toContainText('#release-team');
  await page
    .getByRole('searchbox', { name: 'Decision memory question', exact: true })
    .fill('release');
  await page.getByRole('button', { name: 'Search memory', exact: true }).click();
  await expect(page.locator('#memory-results')).toContainText('Channel: #release-team');
  await expect(page.locator('#memory-results')).toContainText('Channel: #team-archive');
  await expect(page.locator('#memory-results')).not.toContainText('C_RELEASE_ONE');
  expect(writes).toEqual([]);
});
