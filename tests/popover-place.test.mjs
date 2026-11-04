import test from 'node:test';
import assert from 'node:assert/strict';
import { placePopover } from '../web/read/popover.mjs';

const viewport = { width: 390, height: 844 };
const base = { viewport, reserveTop: 60, reserveBottom: 84, margin: 12, gap: 8 };

function freeOf(anchor, placed, popover) {
  const height = placed.maxHeight === null ? popover.height : Math.min(popover.height, placed.maxHeight);
  // The popover must never intersect the anchor vertically.
  return placed.top >= anchor.bottom || placed.top + height <= anchor.top;
}

test('sits below the anchor when there is room', () => {
  const anchor = { top: 100, bottom: 140, left: 20, right: 200 };
  const popover = { width: 300, height: 120 };
  const placed = placePopover({ ...base, anchor, popover });

  assert.equal(placed.side, 'below');
  assert.equal(placed.top, 148);
  assert.equal(placed.left, 20);
  assert.equal(placed.maxHeight, null);
  assert.ok(freeOf(anchor, placed, popover));
});

test('flips above the anchor near the bottom', () => {
  const anchor = { top: 700, bottom: 740, left: 20, right: 200 };
  const popover = { width: 366, height: 120 };
  const placed = placePopover({ ...base, anchor, popover });

  assert.equal(placed.side, 'above');
  assert.equal(placed.top, 700 - 8 - 120);
  assert.ok(placed.top + popover.height <= anchor.top);
  assert.ok(freeOf(anchor, placed, popover));
});

test('clamps horizontally to both viewport margins', () => {
  const popover = { width: 200, height: 100 };
  const anchor = { top: 100, bottom: 140, left: 300, right: 350 };
  assert.equal(placePopover({ ...base, anchor, popover }).left, 390 - 12 - 200);

  const offLeft = { top: 100, bottom: 140, left: -30, right: 50 };
  assert.equal(placePopover({ ...base, anchor: offLeft, popover }).left, 12);

  const wide = { width: 366, height: 100 };
  assert.equal(placePopover({ ...base, anchor, popover: wide }).left, 12);
});

test('neither side fits: picks the larger side with a maxHeight, above wins', () => {
  const anchor = { top: 400, bottom: 440, left: 20, right: 200 };
  const popover = { width: 366, height: 700 };
  const placed = placePopover({ ...base, anchor, popover });

  // spaceAbove = 400 - 60 - 8 = 332, spaceBelow = 844 - 84 - 440 - 8 = 312
  assert.equal(placed.side, 'above');
  assert.equal(placed.maxHeight, 332);
  assert.equal(placed.top, 400 - 8 - 332);
  assert.ok(freeOf(anchor, placed, popover));
});

test('neither side fits: picks the larger side with a maxHeight, below wins', () => {
  const anchor = { top: 300, bottom: 340, left: 20, right: 200 };
  const popover = { width: 366, height: 700 };
  const placed = placePopover({ ...base, anchor, popover });

  // spaceAbove = 300 - 60 - 8 = 232, spaceBelow = 844 - 84 - 340 - 8 = 412
  assert.equal(placed.side, 'below');
  assert.equal(placed.maxHeight, 412);
  assert.equal(placed.top, 348);
  assert.ok(freeOf(anchor, placed, popover));
});

test('a narrow visual viewport bounds width and height above the software keyboard', () => {
  const placed = placePopover({ ...base, viewport: { width: 320, height: 360, top: 120, left: 40, layoutHeight: 844 },
    anchor: { top: 280, bottom: 310, left: 330, right: 390 }, popover: { width: 500, height: 800 } });
  assert.equal(placed.visible, true);
  assert.equal(placed.maxWidth, 296);
  assert.ok(placed.left >= 52);
  assert.ok(placed.left + placed.maxWidth <= 348);
  assert.ok(placed.top + placed.maxHeight <= 468);
});

test('anchors behind reader chrome or outside the viewport cannot keep a card open', () => {
  const popover = { width: 300, height: 200 };
  for (const anchor of [{ top: -100, bottom: 40, left: 20, right: 200 },
    { top: 780, bottom: 800, left: 20, right: 200 }, { top: 100, bottom: 140, left: 400, right: 500 }]) {
    assert.equal(placePopover({ ...base, anchor, popover }).visible, false);
  }
});

test('estimated completed content chooses the side before its smaller loading state', () => {
  const anchor = { top: 460, bottom: 490, left: 20, right: 200 };
  const loading = { width: 340, height: 80 };
  const placed = placePopover({ ...base, anchor, popover: loading, expectedHeight: 300 });
  assert.equal(placed.side, 'above');
  assert.ok(freeOf(anchor, placed, loading));
});

test('a growing result keeps its chosen side and scrolls within the available space', () => {
  const anchor = { top: 460, bottom: 490, left: 20, right: 200 };
  const answer = { width: 340, height: 900 };
  for (const preferredSide of ['above', 'below']) {
    const placed = placePopover({ ...base, anchor, popover: answer, preferredSide });
    assert.equal(placed.side, preferredSide);
    assert.ok(placed.maxHeight > 88);
    assert.ok(freeOf(anchor, placed, answer));
    assert.ok(placed.top >= 60);
    assert.ok(placed.top + placed.maxHeight <= 760);
  }
});
