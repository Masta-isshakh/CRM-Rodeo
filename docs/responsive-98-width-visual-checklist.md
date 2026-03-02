# Responsive 98% Width Visual Pass Checklist

Scope: Confirm pixel-perfect full-span behavior on these 7 pages:
- Job Cards (`jobcards`)
- Job History (`jobhistory`)
- Service Execution (`serviceexecution`)
- Quality Check (`qualitycheck`)
- Inspection (`inspection`)
- Users (`users`)
- Roles & Policies (`rolespolicies`)

## 1) Test setup

1. Start app (`npm run dev`) and sign in with a user that can access all 7 pages.
2. Open browser DevTools.
3. Disable browser zoom (100%).
4. Keep side drawer state consistent while testing (closed for measurement pass, then open for visual sanity).

## 2) Viewports to test

Use these 4 required breakpoints:
- Mobile: **390 x 844**
- Tablet: **768 x 1024**
- Desktop: **1440 x 900**
- Ultrawide: **2560 x 1440**

## 3) Measurement helper (paste in DevTools Console on each page)

```js
(() => {
  const root = document.querySelector('.content > *');
  const content = document.querySelector('.content');
  if (!root || !content) {
    console.log('Could not find .content > * or .content');
    return;
  }
  const vp = document.documentElement.clientWidth;
  const rect = root.getBoundingClientRect();
  const expected = vp * 0.98;
  const delta = Math.abs(rect.width - expected);
  const leftGap = rect.left;
  const rightGap = vp - rect.right;

  console.table({
    viewportWidth: vp,
    measuredWidth: Number(rect.width.toFixed(2)),
    expected98pct: Number(expected.toFixed(2)),
    deltaPx: Number(delta.toFixed(2)),
    leftGapPx: Number(leftGap.toFixed(2)),
    rightGapPx: Number(rightGap.toFixed(2)),
    centeredGapDeltaPx: Number(Math.abs(leftGap - rightGap).toFixed(2)),
    passWidth: delta <= 2,
    passCentered: Math.abs(leftGap - rightGap) <= 2
  });
})();
```

Pass criteria:
- `passWidth = true` (within ±2px)
- `passCentered = true` (left/right gap difference within ±2px)

## 4) Visual checklist per page + viewport

For **each page** and **each viewport** (4x):

1. Navigate via sidebar label:
   - Job Cards
   - Job History
   - Service Execution
   - Quality Check
   - Inspection
   - Users
   - Roles & Policies
2. Run the measurement helper.
3. Validate all visual checks:
   - Outer page shell spans ~98% width and is centered.
   - No unexpected large fixed gutters caused by nested wrappers.
   - No full-page horizontal overflow at root level.
   - Data tables/cards can still scroll internally when needed.
   - Header/topbar alignment remains stable.
4. Repeat with drawer open once (sanity check only) and ensure layout still looks full-span.

## 5) Quick pass/fail matrix

Mark one cell per page/viewport as ✅ or ❌.

| Page | Mobile 390 | Tablet 768 | Desktop 1440 | Ultrawide 2560 |
|---|---|---|---|---|
| Job Cards | ☐ | ☐ | ☐ | ☐ |
| Job History | ☐ | ☐ | ☐ | ☐ |
| Service Execution | ☐ | ☐ | ☐ | ☐ |
| Quality Check | ☐ | ☐ | ☐ | ☐ |
| Inspection | ☐ | ☐ | ☐ | ☐ |
| Users | ☐ | ☐ | ☐ | ☐ |
| Roles & Policies | ☐ | ☐ | ☐ | ☐ |

## 6) If any cell fails

Capture:
- Page name + viewport
- Screenshot with DevTools open
- Output table from measurement helper
- Selector suspected to constrain width

Then patch only the offending wrapper (avoid changing modal/input-specific max-width rules).
