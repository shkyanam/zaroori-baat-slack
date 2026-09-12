import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Message } from '../src/types';

const sourceId = 'hero-review-source';
const unrelatedOwner = 'Unrelated conversation owner';
const sourceOwner = 'Assigned reviewer';
const sender = 'A sender with a deliberately long display name for narrow screen verification';
const channel = 'a-deliberately-long-channel-name-for-responsive-slack-message-review';
const longText =
  'The checkout deployment needs a review before the team can continue with the release. ' +
  'Please keep the complete message visible so the timing, request, and evidence can be read together.\n\n' +
  '<@U_SYNTHETIC> The second paragraph includes the detail that used to disappear after the first sentence. ' +
  'Check https://example.test/deployments/a-deliberately-long-unbroken-reference-for-responsive-message-verification ' +
  'and confirm which checks still need an owner.\n\n' +
  'Final message detail: do not lose the request to share an update before the next review.';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: sourceId,
    text: longText,
    sender,
    channel,
    created_at: '2026-09-12T06:30:00Z',
    classification: 'Incident',
    priority: 'high',
    score: 95,
    reason: 'The message describes a blocked release and asks for a review.',
    suggested_action: 'Check the deployment evidence and confirm the next reviewer.',
    decision: null,
    context: {},
    action_extraction: {
      items: [
        {
          type: 'task',
          title: 'An action from another conversation',
          owner: unrelatedOwner,
          due: 'Unrelated deadline',
          source_message_ids: ['another-message'],
        },
        {
          type: 'task',
          title: 'Review this deployment',
          owner: sourceOwner,
          due: 'Before the next release review',
          source_message_ids: [sourceId],
        },
      ],
    },
    decision_memory: { items: [] },
    ...overrides,
  };
}

async function loadInbox(page: Page, messages: Message[]) {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(request.method());
      await route.fulfill({ status: 405, json: { error: 'This UI check is read only.' } });
      return;
    }
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/messages') {
      await route.fulfill({ json: { messages } });
    } else if (pathname.startsWith('/api/messages/')) {
      const source = messages.find((item) => item.id === pathname.split('/').at(-1));
      await route.fulfill({
        status: source ? 200 : 404,
        json: source || { error: 'Unknown source.' },
      });
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
  await expect(page.getByTestId('focus-message')).toBeVisible();
  return writes;
}

async function expectUnclippedText(locator: Locator) {
  const geometry = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const content = document.createRange();
    const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rectangles: DOMRect[] = [];
    // Preserved spaces may hang past a line edge; visible glyphs must stay inside it.
    while (nodes.nextNode()) {
      const node = nodes.currentNode;
      for (let index = 0; index < (node.textContent?.length || 0); index += 1) {
        if (/\s/.test(node.textContent![index])) continue;
        content.setStart(node, index);
        content.setEnd(node, index + 1);
        rectangles.push(...content.getClientRects());
      }
    }
    return {
      verticalClip: element.scrollHeight > element.clientHeight + 1,
      horizontalClip: element.scrollWidth > element.clientWidth + 1,
      textFits: rectangles.every(
        (rectangle) =>
          rectangle.left >= box.left - 1 &&
          rectangle.right <= box.right + 1 &&
          rectangle.top >= box.top - 1 &&
          rectangle.bottom <= box.bottom + 1,
      ),
    };
  });
  expect(geometry).toEqual({ verticalClip: false, horizontalClip: false, textFits: true });
}

for (const viewport of [
  { width: 320, height: 760 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1440, height: 1000 },
]) {
  test(`compact hero reveals the complete Slack source at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const fixture = message();
    const writes = await loadInbox(page, [fixture]);
    const hero = page.getByTestId('focus-message');
    const body = page.getByTestId('focus-message-text');
    const review = hero.getByRole('button', { name: 'Review this', exact: true });
    const disclosure = hero.getByRole('button', { name: 'Read full message', exact: true });
    await expect(body).toHaveCount(0);
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(hero.getByRole('heading', { level: 2 })).toHaveText(
      'The checkout deployment needs a review before the team can continue with the release.',
    );
    await expect(hero.getByText('Incident')).toBeVisible();
    await expect(hero.getByText('High priority', { exact: true })).toBeVisible();
    await expect(hero.getByText(sender, { exact: true })).toBeVisible();
    await expect(hero.getByText(`#${channel}`, { exact: true })).toBeVisible();

    if (viewport.width >= 1366) {
      await expect(review).toBeInViewport({ ratio: 1 });
      expect((await hero.boundingBox())!.height).toBeLessThanOrEqual(330);
    }

    await disclosure.focus();
    await page.keyboard.press('Enter');
    const collapse = hero.getByRole('button', { name: 'Hide full message', exact: true });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toBeVisible();
    expect(await body.textContent()).toBe(fixture.text);
    await expectUnclippedText(body);
    await expect(hero).toContainText(fixture.reason);
    await expect(hero).toContainText(fixture.suggested_action);
    await expect(hero).toContainText(sourceOwner);
    await expect(hero).not.toContainText(unrelatedOwner);
    await expect(hero).not.toContainText('Unrelated deadline');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await collapse.focus();
    await page.keyboard.press('Enter');
    await expect(body).toHaveCount(0);
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(disclosure).toBeFocused();
    await review.scrollIntoViewIfNeeded();
    await expect(review).toBeInViewport({ ratio: 1 });
    const bounds = await review.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(writes).toEqual([]);
  });
}

test('question priority and missing assignment stay faithful to the source', async ({ page }) => {
  const fixture = message({
    classification: 'Question',
    priority: 'medium',
    text: 'Which reviewer can help confirm the release checklist?',
    reason: 'A teammate has asked for clarification.',
    suggested_action: 'Review the question and prepare a response.',
    action_extraction: {
      items: [
        {
          type: 'task',
          title: 'An action belonging to another conversation',
          owner: unrelatedOwner,
          due: 'Unrelated deadline',
          source_message_ids: ['another-message'],
        },
      ],
    },
  });
  const writes = await loadInbox(page, [fixture]);
  const hero = page.getByTestId('focus-message');
  await expect(hero.getByText('Question')).toBeVisible();
  await expect(hero.getByText('Medium priority', { exact: true })).toBeVisible();
  await expect(hero.getByText('High priority', { exact: true })).toHaveCount(0);
  await expect(hero.getByText(sender, { exact: true })).toBeVisible();
  await hero.getByRole('button', { name: 'Read full message', exact: true }).click();
  await expect(page.getByTestId('focus-message-text')).toHaveText(fixture.text);
  await expect(hero.getByText('Owner', { exact: true })).toHaveCount(0);
  await expect(hero).not.toContainText(unrelatedOwner);
  await expect(hero).not.toContainText('Unrelated deadline');
  expect(writes).toEqual([]);
});

test('an up-next preview opens its complete source and restores focus on close', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nextText = `${longText}\nThis is the final sentence of the next conversation.`;
  const writes = await loadInbox(page, [
    message({ text: 'Please review the deployment before the next release.' }),
    message({ id: 'next-source', score: 80, text: nextText }),
  ]);
  const next = page.locator('[data-testid="message-row"][data-message-id="next-source"]');
  const body = next.locator('strong');
  expect((await body.textContent())!.length).toBeLessThan(nextText.length);
  await expect(body).not.toContainText('This is the final sentence of the next conversation.');
  await next.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('region', { name: 'Message detail', exact: true });
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(/[?&]message=next-source(?:&|$)/);
  await detail.getByText('Original message', { exact: true }).click();
  const original = detail.locator('details').filter({ hasText: 'Original message' }).locator('p');
  expect(await original.textContent()).toBe(nextText.replace(/<@([^>]+)>/g, '@$1'));
  await expectUnclippedText(original);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(next).toBeFocused();
  expect(writes).toEqual([]);
});

test('keyboard review opens the selected source and Escape restores the hero CTA', async ({
  page,
}) => {
  const writes = await loadInbox(page, [
    message({ text: 'Please review the deployment before the next release.' }),
  ]);
  const review = page.getByTestId('focus-message').getByRole('button', {
    name: 'Review this',
    exact: true,
  });
  await review.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]message=${sourceId}(?:&|$)`));
  await expect(page.getByRole('button', { name: 'Review response', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(review).toBeFocused();
  expect(writes).toEqual([]);
});
