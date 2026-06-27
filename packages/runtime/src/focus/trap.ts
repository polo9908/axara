/**
 * Pure focus-trap analysis.
 *
 * Given the sequence of elements focused by successive Tab presses (captured by
 * the Playwright harness, starting just after a leading sentinel and bounded by
 * a trailing "exit" sentinel), decide whether the component is a keyboard trap:
 *
 *  - `stuck` : focus does not move (the same element twice in a row).
 *  - `cycle` : focus revisits an earlier element before reaching the exit
 *              sentinel — i.e. Tab loops inside the component forever.
 *
 * If the exit sentinel is reached, focus escaped normally → no trap. If neither
 * happens within the step budget, the result is `inconclusive` (not a false
 * "trap"): the caller should raise `maxTabs`.
 */

import type { FocusOrderReport, FocusSnapshot, TrapKind } from './types.js';

export interface AnalyzeOptions {
  /** Id of the trailing exit sentinel. */
  readonly exitId: string;
}

export function analyzeFocusOrder(
  snapshots: readonly FocusSnapshot[],
  options: AnalyzeOptions,
): FocusOrderReport {
  const firstSeen = new Map<string, number>();
  const order: FocusSnapshot[] = [];
  let reachedExit = false;
  let trapKind: TrapKind = 'none';

  for (const snapshot of snapshots) {
    if (snapshot.isExit || snapshot.id === options.exitId) {
      reachedExit = true;
      break;
    }
    const previous = order[order.length - 1];
    if (previous && previous.selector === snapshot.selector) {
      trapKind = 'stuck';
      break;
    }
    if (firstSeen.has(snapshot.selector)) {
      trapKind = 'cycle';
      break;
    }
    firstSeen.set(snapshot.selector, order.length);
    order.push(snapshot);
  }

  const isTrap = !reachedExit && trapKind !== 'none';
  const inconclusive = !reachedExit && trapKind === 'none';
  const focusOrder = order.map((s) => s.selector);

  return {
    isTrap,
    trapKind,
    reachedExit,
    focusOrder,
    focusableCount: order.length,
    inconclusive,
    message: buildMessage({ isTrap, trapKind, reachedExit, inconclusive, count: order.length }),
  };
}

function buildMessage(input: {
  isTrap: boolean;
  trapKind: TrapKind;
  reachedExit: boolean;
  inconclusive: boolean;
  count: number;
}): string {
  if (input.isTrap && input.trapKind === 'stuck') {
    return 'Piège clavier : le focus reste bloqué sur le même élément (RGAA 7.3 / 12.x).';
  }
  if (input.isTrap && input.trapKind === 'cycle') {
    return 'Piège clavier : le focus boucle dans le composant sans pouvoir en sortir au clavier (RGAA 7.3 / 12.x).';
  }
  if (input.reachedExit) {
    return `Ordre de tabulation correct : le focus traverse ${input.count} élément(s) puis sort du composant.`;
  }
  return `Indéterminé : ni sortie ni piège observés en ${input.count} étape(s) — augmentez maxTabs.`;
}
