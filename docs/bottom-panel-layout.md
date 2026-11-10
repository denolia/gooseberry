# Fixed bottom controls

[`BottomPanelLayout`](../src/components/ui/BottomPanelLayout.tsx) keeps controls at the bottom of the viewport while its page content scrolls normally. The study reviewer uses it for Show/Check answer and ratings. Reader controls can use the same component later.

```tsx
<BottomPanelLayout label="Reader controls" panel={readerControls}>
  {readerContent}
</BottomPanelLayout>
```

- `children` holds the scrolling page content, including any overlays that need to know the panel's height.
- `panel` holds the fixed controls. Keep the layout mounted when switching control states.
- `label` names the controls region for assistive technology.
- `className` can set `--bottom-panel-content-width` to align controls with a page. The default is `--content-max-width`; study controls use 900px.

The panel spans the viewport with the existing `--input-background` surface (`#1a1a1a` in dark mode), border token and safe-area padding. A `ResizeObserver` measures its full height, including padding, into the scoped `--bottom-panel-height` property. A spacer reserves that space in the document, so content at the end remains reachable even when controls wrap or text size changes. The panel provides visible keyboard focus styles; its children retain ordinary button/tab behavior.

Overlays rendered inside the layout can use `--bottom-panel-height` to sit above it. The review failure toast does this. Mount the layout outside transformed ancestors so its fixed panel remains relative to the viewport. The component does not create an internal scrolling area or control page scrolling; the reviewer separately returns to the top when advancing to another word.

The reviewer keeps Show answer, Ok, simple ratings and full ratings in a single row of at least 64px-high controls. Full mode preserves Hard, Good, Easy, Again and their keyboard shortcuts. Comments retain line breaks and wrap long text. The Reader page's current player is unchanged.

The exercise type is a quiet label in the card's top-right corner. The prompt and revealed answer have no intervening divider, Answer heading or reminder question. Typed comparison retains its Your answer label to identify the learner's input.

Study mode omits the site's logo/navigation header and extra page-bottom padding. The set name and language direction share one line, with End session on the right linking back to `/anki`, where the normal header appears. Long set names ellipsize on narrow screens; their complete text remains in the heading and its title. The study card has no outer border or minimum height. Prompt and answer share a 24–28px text scale, with 16px forms/examples/comments and 14px metadata; both sides use 16px padding. These sizes follow the browser's base font size. Long study prose is left-aligned and is never truncated or collapsed.

Manual verification:

1. Reveal a long answer with many comment lines and scroll to the last line. It should clear the fixed panel; controls should remain visible throughout.
2. Compare New, simple ratings and full ratings at narrow and desktop widths. The panel should stay at the bottom with no horizontal overflow; check keyboard focus and shortcuts too.
3. Advance while scrolled down. The next word should return into view immediately, with the panel still at the bottom.
4. Check mobile safe areas, typing with the on-screen keyboard, browser zoom and a failed-save toast. Content and controls should remain reachable, and the toast should sit above the panel.
