import { expect, test, type Page } from '@playwright/test';
import type { Message, SystemStatus } from '../src/types';

const messages: Message[] = [
  {
    id: 'slack-release-message',
    sender: 'U_RELEASE_REVIEWER',
    sender_name: 'Asha Patel',
    channel: 'C_RELEASE_CHANNEL',
    channel_name: 'release-team',
    text: 'Please review the release checklist before the deployment.',
    created_at: '2026-09-12T06:30:00Z',
    priority: 'high',
    classification: 'Action Required',
    score: 90,
    reason: 'The release checklist needs a review.',
    suggested_action: 'Review the checklist.',
    context: {},
    action_extraction: { items: [] },
    decision_memory: { items: [] },
  },
  {
    id: 'slack-design-message',
    sender: 'U_DESIGN_REVIEWER',
    sender_name: 'Sam Chen',
    channel: 'C_DESIGN_CHANNEL',
    channel_name: 'design-studio',
    text: 'The updated design notes are ready for the next planning session.',
    created_at: '2026-09-12T05:30:00Z',
    priority: 'low',
    classification: 'FYI',
    score: 30,
    reason: 'Design notes are available.',
    suggested_action: 'Read the design notes.',
    context: {},
    action_extraction: { items: [] },
    decision_memory: { items: [] },
  },
];

const configuredStatus: SystemStatus = {
  slack: { configured: true, channel_count: 2, last_sync_at: null },
  context: { enabled: false, external_sources: 'mock' },
  memory: { active: false, enabled: false, configured: false },
  workflow: {},
  demo: false,
};

async function mockApi(page: Page, status: () => SystemStatus | null = () => configuredStatus) {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.fulfill({ status: 405, json: { error: 'Shell checks are read only.' } });
      return;
    }
    switch (new URL(request.url()).pathname) {
      case '/api/messages':
        await route.fulfill({ json: { messages } });
        break;
      case '/api/system/status': {
        const currentStatus = status();
        await route.fulfill(
          currentStatus
            ? { json: currentStatus }
            : { status: 503, json: { error: 'Synthetic status service unavailable.' } },
        );
        break;
      }
      case '/api/observability/summary':
        await route.fulfill({ json: { metrics: {}, recent_runs: [] } });
        break;
      default:
        await route.fulfill({ status: 404, json: { error: 'Unknown synthetic endpoint.' } });
    }
  });
  return writes;
}

test('Slack channels open their named conversations using canonical channel IDs', async ({
  page,
}) => {
  const writes = await mockApi(page);
  await page.goto('/#/inbox');

  await expect(page.locator('.workspace-source')).toContainText('Slack conversations');
  const channels = page.getByRole('navigation', { name: 'Slack channels', exact: true });
  const release = channels.getByRole('link', {
    name: 'View #release-team Slack messages',
    exact: true,
  });
  await expect(release).toBeVisible();
  await expect(release).toHaveAttribute('href', '#/inbox?view=all&channel=C_RELEASE_CHANNEL');
  await expect(channels).not.toContainText('C_RELEASE_CHANNEL');
  await release.click();
  await expect(page).toHaveURL(/\/inbox\?view=all&channel=C_RELEASE_CHANNEL$/);
  await expect(page.getByTestId('message-row')).toHaveCount(1);
  await expect(page.getByTestId('message-row')).toHaveAttribute(
    'data-message-id',
    'slack-release-message',
  );
  await expect(page.getByTestId('message-row')).toContainText('Asha Patel');

  for (const route of ['actions', 'memory', 'reviewed', 'system']) {
    await page.goto(`/#/${route}`);
    await expect(page.locator('.workspace-source')).toContainText('Slack conversations');
    await expect(
      page.getByRole('navigation', { name: 'Slack channels', exact: true }),
    ).toBeVisible();
  }
  expect(writes).toEqual([]);
});

test('mobile channel switching closes the accessible navigation even within the inbox route', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await mockApi(page);
  await page.goto('/#/inbox?view=all&channel=C_RELEASE_CHANNEL');
  await expect(page.getByTestId('message-row')).toHaveAttribute(
    'data-message-id',
    'slack-release-message',
  );
  await expect(page.locator('.workspace-source')).toContainText('Slack conversations');

  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const navigation = page.getByRole('dialog');
  await expect(navigation).toBeVisible();
  await expect(
    navigation.getByRole('navigation', { name: 'Main navigation', exact: true }),
  ).toBeVisible();
  await navigation
    .getByRole('navigation', { name: 'Slack channels', exact: true })
    .getByRole('link', { name: 'View #design-studio Slack messages', exact: true })
    .click();
  await expect(navigation).toBeHidden();
  await expect(page).toHaveURL(/\/inbox\?view=all&channel=C_DESIGN_CHANNEL$/);
  await expect(page.getByTestId('message-row')).toHaveCount(1);
  await expect(page.getByTestId('message-row')).toHaveAttribute(
    'data-message-id',
    'slack-design-message',
  );
  await expect(page.getByTestId('message-row')).toContainText('Sam Chen');
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  expect(writes).toEqual([]);
});

test('Slack source status distinguishes setup, recorded sync, demo data, and lookup errors', async ({
  page,
}) => {
  let status: SystemStatus | null = configuredStatus;
  const writes = await mockApi(page, () => status);
  await page.goto('/#/inbox');
  const sourceStatus = page.locator('.connection-label').filter({ visible: true });
  await expect(sourceStatus).toHaveText('Ready to sync');
  await expect(sourceStatus).not.toContainText(/connected|live/i);

  status = {
    ...configuredStatus,
    slack: { ...configuredStatus.slack, last_sync_at: '2026-09-12T06:30:00Z' },
  };
  await page.reload();
  await expect(sourceStatus).toContainText('Last synced');
  await expect(sourceStatus).not.toContainText(/connected|live/i);

  status = {
    ...configuredStatus,
    slack: { configured: false, channel_count: 0, last_sync_at: null },
    demo: true,
  };
  await page.reload();
  await expect(sourceStatus).toHaveText('Demo messages');

  status = null;
  await page.reload();
  await expect(sourceStatus).toHaveText('Status unavailable');
  expect(writes).toEqual([]);
});
