# Zaroori Baat workspace

Zaroori Baat is a focused review workspace for Slack conversations. Its visual language uses aubergine navigation, white message surfaces, charcoal text, and green actions. Slack source cues belong beside conversations and in the workspace shell so people can immediately connect a review to its source. The Understand → Prepare → Decide journey remains the organizing principle.

[src/tokens.css](src/tokens.css) is the canonical source for color, typography, spacing, radius, shadow, and motion. Consume its semantic variables in CSS Modules. One local Inter variable font is loaded through [src/fonts.css](src/fonts.css); no external font service is needed.

## Inspiration

- [Slack's visual-language evolution](https://slack.design/articles/a-new-visual-language-for-slack/) describes preserving useful information density while making surfaces, hierarchy, and previews easier to understand. Our interpretation uses its familiar aubergine character, restrained depth, and readable conversation previews.
- [Slack's sidebar structure](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences) separates navigation from the channels and conversations within a workspace. Zaroori Baat uses a clear workspace shell around its own review and memory pages.

These references inform the skin and source context. Zaroori Baat keeps its own name, purpose, and guided review workflow. Source branding must identify Slack as the connected message source without suggesting that this application is Slack itself.

## Color and surfaces

| Role | Tokens and values | Use |
| --- | --- | --- |
| Workspace | `--canvas` #f8f7f8; `--canvas-glow` #f1eaf2 | A neutral reading workspace with only restrained lilac accents. |
| Content layers | `--surface` #ffffff; `--surface-subtle` #f8f7f8; `--surface-muted` #f0edf1 | Cards, dialogs, evidence, and quiet grouped controls. |
| Text | `--ink` #1d1c1d; `--text` #383439; `--muted` #615b64; `--faint` #67616b | Headings, body, supporting text, and limited metadata. |
| Primary action | `--brand` #007a5a; `--brand-hover` #006447 | The next useful action on a light surface, with white text. |
| Selection | `--brand-soft` #f3eaf4; `--brand-ink` #4a154b | Selected tabs, contextual recommendations, and links. |
| Navigation and focus | `--nav-bg` #350d36; `--focus-bg` #4a154b; `--focus-raised` #5c2b5e | Navigation and the featured priority conversation. |
| Text on focus | `--on-focus` #ffffff; `--on-focus-muted` #e1cfe3 | Primary and supporting text on dark aubergine. |
| Action on focus | `--accent` #ffffff; `--accent-hover` #f3eaf4; `--accent-ink` #4a154b | A clear white CTA with aubergine text on a dark surface. |
| Completion | `--success` #007a5a; `--success-soft` #e2f2eb | Saved reviews, completed steps, and positive status. |
| Caution | `--warning` #7a5200; `--warning-soft` #fff3cc | Attention or risk, always paired with a label or icon. |
| Error | `--danger` #b42350; `--danger-soft` #fce8ef | Errors and high priority signals. |
| Memory | `--memory` #6b3870; `--memory-soft` #f3eaf4 | Decision memory and associated context. |
| Separation | `--line` #e4dfe5; `--line-strong` #c9c1cb | Dividers and stronger control boundaries. |

Keep most content neutral. Use lilac for selection and aubergine for the workspace structure; reserve green for action and completion. Yellow and pink explain status instead of decorating unrelated surfaces. White cards use `--shadow-card`; hover elevation uses `--shadow-hover`; modal elevation uses `--shadow-modal` with `--overlay`. Avoid stacking shadows within cards.

## Typography

| Role | Rule |
| --- | --- |
| Headings | Inter Variable via `--font-display`; typically 600–750 weight; `--tracking-heading` −0.025em. |
| Body | Inter Variable via `--font-ui`; `--text-base` 15px at a 16px root; `--leading-body` 1.6. |
| Controls | `--text-sm` 13px, medium or semibold. |
| Metadata | `--text-xs` 12px for timestamps and explanations; small count badges and short overlines may use 11px. |
| Supporting text | `--text-lg` 17px. |
| Mobile text entry | 16px for input, select, and textarea text; surrounding labels retain the normal scale. |

Use size, weight, and spacing to establish hierarchy before reducing text contrast. Keep body tracking natural. Allow long subjects and names to wrap; reduce decorative space before shrinking reading text. Sender names, channel names, and Slack source cues should be readable at a glance.

## Conversation hierarchy

The Inbox begins with a compact totals strip, a priority conversation, and a small priority distribution derived from pending message records. The featured conversation shows classification, priority, Slack source, sender, a short source preview, and one primary review action. The explicit Read full message control reveals the unchanged original text, the backend's reason and suggested action, and any source-scoped owner or due date. Keep that detail closed initially and preserve it during background refreshes. The next two conversations use short previews that open the complete review experience.

Use one cohesive queue surface below the overview. A narrow message-type rail becomes a horizontally scrollable selector on mobile. Lightweight group headers and concise source previews keep conversations easy to scan; every row offers Read conversation to access the full source. Keep classification and priority separate, including medium or high priority FYIs. Counts represent the section's actual messages, excluding featured conversations in the default view. Filters combine and survive reload without changing the hero. Show two leading messages per group in the focused view, with explicit expansion; other queue views show all matching messages. Derive counts from message records, never workflow-run totals.

Resolve Slack IDs to names for display while retaining canonical IDs for routing and filters. Opening a Slack source and reviewing a conversation in Zaroori Baat are distinct actions. Only present a live connection when it is supported by actual connection state; source attribution remains useful for imported messages and demo previews too.

## Spacing and interaction

Repeated metadata uses the shared [StatusPill](src/components/StatusPill.tsx) component: a compact, read-only label with an icon and a soft colored background. Its domain variants keep classifications, priorities, review outcomes, work types, and confidence consistent across pages. Channel names use a lilac chip beside the Slack mark; people and dates use labeled icon chips. Metric icons and matching chart colors provide visual anchors without wrapping whole sentences in badges.

| Color | Meaning |
| --- | --- |
| Rose | High priority, incidents, escalations, risks, and failed runs |
| Amber | Medium priority, approval requests, deferred reviews, and attention states |
| Green | Approved/completed reviews, successful runs, and action-required signals |
| Lilac | Decisions, follow-ups, and Slack channel sources |
| Blue | Questions, tasks, and informational metadata |
| Neutral | FYIs, low priority, people, missing details, and dismissed reviews |

Always retain the label and icon: color alone never communicates a state. Classification and priority remain separate API values; an FYI can be high priority. Confidence is explicitly labeled and never represents completion. Dates remain the supplied dates without inferring overdue status from ambiguous text. Extracted suggestions are not completed tasks. Pills are spans; actions and filters remain accessible buttons or links with clear selected states.

Use 24px minimum pill height, 3px/8px padding, a 999px corner radius, and 11px text. Allow long names and labels to wrap. Keep original messages, action titles, reasoning, and explanations as readable prose. Normal-text contrast for all seven pill surface combinations exceeds 4.5:1; the blue information pair is 5.54:1.

Use the 4px spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, and 48px. Keep related content close and separate larger sections with the upper steps. Radius tokens are 8px for controls, 10px for cards, and 12px for feature surfaces. Circles remain appropriate for compact status dots and avatars. Prefer subtle borders and hover color changes over moving whole cards.

Keep the review action footer visible while evidence scrolls. On small screens, let controls wrap and simplify ornamental spacing. Navigation, Slack attribution, and the primary action must remain legible.

Use `--duration-fast` (160ms) for hover and focus feedback and `--duration-normal` (220ms) for short transitions, with `--ease-out`. Movement should explain a state change. Honor `prefers-reduced-motion` by removing decorative movement and unnecessary transitions.

## Contrast rules

Target at least 4.5:1 for normal text, including metadata, and 3:1 for large text and essential graphical controls. Pale dividers are decorative and cannot be the sole indication of an interactive state. Pair status color with words, an icon, or a visible state change; keep keyboard focus visible.

Use `--muted` for metadata on tinted surfaces and `--on-focus-muted` on dark surfaces. Do not reduce the opacity of text tokens. Calculated opaque pairs are:

| Pair | Contrast |
| --- | --- |
| White / primary green | 5.34:1 |
| White / aubergine focus | 14.00:1 |
| White / dark navigation | 16.64:1 |
| Supporting focus text / aubergine focus | 9.49:1 |
| Body / white | 12.22:1 |
| Muted text / muted surface | 5.67:1 |
| Faint text / canvas | 5.62:1 |
| Aubergine text / lilac selection | 11.92:1 |
| Warning text / warning surface | 6.24:1 |
| Error text / error surface | 5.44:1 |
| Success text / success surface | 4.61:1 |
| Memory text / memory surface | 7.38:1 |

These are palette checks, not a claim that every rendered state has been audited. Recheck contrast for gradients, transparency, or a new text and surface combination.
