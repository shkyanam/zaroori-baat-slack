# Daybreak

Daybreak is Zaroori Baat's visual language: a cool, quiet workspace with a warm point of focus. Clear type and deliberate color help the next useful action stand out. The existing guided journey remains the organizing principle.

[src/tokens.css](src/tokens.css) is the canonical source for color, typography, spacing, radius, shadow, and motion values. Consume its semantic variables in CSS Modules; change shared values there instead of adding a new palette to each page. Two local variable Latin font files are loaded through [src/fonts.css](src/fonts.css), totaling approximately 76 KB with no external font-service request.

## Inspiration

These are our interpretations of the references, applied to Zaroori Baat's own identity:

- [Things](https://culturedcode.com/things/) emphasizes organizing work around what matters today. Daybreak expresses that with readable rows, restrained chrome, and one prominent conversation.
- [Sunsama](https://www.sunsama.com/) emphasizes calm, intentional planning and focused work. Daybreak carries that into spacious surfaces and the Understand → Prepare → Decide progression.
- [Linear's UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) explains how surface hierarchy, alignment, stronger text contrast, and differentiated heading typography reduce visual noise. Daybreak uses semantic surface layers and a distinct heading/UI font pair.

The cool mist canvas, midnight focus card, apricot accent, and Jakarta/Inter pairing belong to Daybreak. Reference product logos, artwork, palettes, and layouts are not reused.

## Color and surfaces

| Role           | Tokens and current values                                                                        | Use                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Workspace      | `--canvas` #f3f5fa; `--canvas-glow` #e6ecfa                                                      | Background, with a restrained decorative glow away from text.          |
| Content layers | `--surface` #ffffff; `--surface-subtle` #f7f8fc; `--surface-muted` #edf0f7                       | Cards/dialogs; inset evidence; quiet controls and grouped details.     |
| Text           | `--ink` #202b42; `--text` #34415a; `--muted` #5f6b82; `--faint` #657087                          | Headings; body; supporting text; limited metadata on white/canvas.     |
| Action         | `--brand` #355bcb; `--brand-hover` #2949af; `--brand-soft` #e9efff; `--brand-ink` #2f4fa8        | Primary controls, selection, keyboard focus, and recommendations.      |
| Focus          | `--focus-bg` #202c46; `--focus-raised` #2c3a58; `--on-focus` #ffffff; `--on-focus-muted` #c0cbe0 | The main priority card and its light text.                             |
| Warm accent    | `--accent` #f3c4a9; `--accent-hover` #f7d2bc; `--accent-ink` #583922                             | Focus-card CTA and small identity accents. Use dark accent text.       |
| Completion     | `--success` #326953; `--success-soft` #e2f0e9                                                    | Saved reviews, completed steps, positive status.                       |
| Caution/error  | `--warning` #966024 on `--warning-soft` #fff0da; `--danger` #a64d35 on `--danger-soft` #fbe9e1   | Attention needed, risk, and errors, always paired with words or icons. |
| Memory         | `--memory` #5366ab; `--memory-soft` #e9edfb                                                      | Decision memory and associated context.                                |
| Separation     | `--line` #dfe4ee; `--line-strong` #cbd3e1                                                        | Quiet dividers and stronger control boundaries.                        |

Keep most content neutral. Use a tinted surface to explain purpose, and reserve the strongest treatment for the current focus. White cards use `--shadow-card`; hover elevation uses `--shadow-hover`; modal elevation uses `--shadow-modal` with `--overlay`. Avoid accumulating nested shadows.

## Typography

| Role                   | Rule                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Headings               | Plus Jakarta Sans Variable via `--font-display`; typically 600–750 weight; `--tracking-heading` −0.035em. |
| Body                   | Inter Variable via `--font-ui`; `--text-base` 15px at a 16px root; `--leading-body` 1.65.                 |
| Controls               | `--text-sm` 13px; medium/semibold weight.                                                                 |
| Metadata               | `--text-xs` 12px for timestamps and explanations; compact count badges and short overlines may use 11px.  |
| Larger supporting text | `--text-lg` 17px.                                                                                         |
| Mobile text entry      | 16px for input, select, and textarea text; surrounding labels retain the normal scale.                    |

Use size, weight, and spacing to establish hierarchy before reducing text contrast. Keep body tracking natural. Allow long subjects and names to wrap; reduce decorative space before shrinking the reading text.

## Spacing and interaction

Use the 4px spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, and 48px. Keep related content close and separate larger sections with the upper steps. Radius tokens are 10px for controls, 20px for cards, and 24px for feature surfaces. Small optical adjustments inside icons or compact rows are acceptable.

Keep the review action footer visible while evidence scrolls. On small screens, let controls wrap and simplify ornamental spacing. Navigation, labels, and the primary action must remain legible.

Use `--duration-fast` (160ms) for hover/focus feedback and `--duration-normal` (220ms) for short transitions, with `--ease-out`. Movement should explain a state change. Honor `prefers-reduced-motion` by removing decorative movement and unnecessary transitions.

## Contrast rules

Target at least 4.5:1 for normal text, including metadata. Use 3:1 as the minimum for large text and essential graphical controls. The pale divider tokens are decorative and cannot serve as the only indication of an interactive state. Pair status color with a label, icon, or visible state change; keep keyboard focus visible.

Use `--muted` for metadata on tinted surfaces. Restrict `--faint` text to white or the plain canvas: its contrast on the canvas is approximately 4.56:1, leaving little margin. Do not apply opacity to either text token. Use `--on-focus-muted` on dark focus surfaces.

Calculated opaque color pairs include white/brand at 5.98:1, accent-ink/accent at 6.56:1, and muted/surface-muted at 4.71:1. These are palette checks, not a claim that every rendered state has been audited. Recheck contrast when changing tokens, introducing gradients/transparency, or combining text with a new surface.
