import { describe, expect, it } from 'vitest';
import { analyzeFocusOrder } from './trap.js';
import type { FocusSnapshot } from './types.js';

const EXIT = '__exit__';

function snap(partial: Partial<FocusSnapshot> & { selector: string; index: number }): FocusSnapshot {
  return {
    tag: partial.selector.split(/[#.]/)[0] ?? 'div',
    id: partial.id ?? null,
    role: partial.role ?? null,
    name: partial.name ?? null,
    isExit: partial.isExit ?? false,
    ...partial,
  };
}

describe('analyzeFocusOrder', () => {
  it('reports a clean tab order when the exit sentinel is reached', () => {
    const report = analyzeFocusOrder(
      [
        snap({ index: 0, selector: 'button#a' }),
        snap({ index: 1, selector: 'a#b' }),
        snap({ index: 2, selector: `button#${EXIT}`, id: EXIT, isExit: true }),
      ],
      { exitId: EXIT },
    );
    expect(report.isTrap).toBe(false);
    expect(report.reachedExit).toBe(true);
    expect(report.focusOrder).toEqual(['button#a', 'a#b']);
    expect(report.focusableCount).toBe(2);
  });

  it('detects a cycle trap (focus loops back before exit)', () => {
    const report = analyzeFocusOrder(
      [
        snap({ index: 0, selector: 'button#a' }),
        snap({ index: 1, selector: 'button#b' }),
        snap({ index: 2, selector: 'button#a' }), // looped back
      ],
      { exitId: EXIT },
    );
    expect(report.isTrap).toBe(true);
    expect(report.trapKind).toBe('cycle');
    expect(report.reachedExit).toBe(false);
    expect(report.message).toMatch(/boucle/i);
  });

  it('detects a stuck trap (focus does not move)', () => {
    const report = analyzeFocusOrder(
      [
        snap({ index: 0, selector: 'div#modal' }),
        snap({ index: 1, selector: 'div#modal' }),
      ],
      { exitId: EXIT },
    );
    expect(report.isTrap).toBe(true);
    expect(report.trapKind).toBe('stuck');
  });

  it('is inconclusive (not a trap) when neither exit nor loop occurs', () => {
    const report = analyzeFocusOrder(
      [snap({ index: 0, selector: 'button#a' }), snap({ index: 1, selector: 'button#b' })],
      { exitId: EXIT },
    );
    expect(report.isTrap).toBe(false);
    expect(report.inconclusive).toBe(true);
    expect(report.message).toMatch(/augmentez maxTabs/i);
  });

  it('treats no focusable elements (immediate exit) as a clean pass', () => {
    const report = analyzeFocusOrder(
      [snap({ index: 0, selector: `button#${EXIT}`, id: EXIT, isExit: true })],
      { exitId: EXIT },
    );
    expect(report.isTrap).toBe(false);
    expect(report.reachedExit).toBe(true);
    expect(report.focusableCount).toBe(0);
  });
});
