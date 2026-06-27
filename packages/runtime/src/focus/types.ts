/** Focus-order / focus-trap analysis types. */

export interface FocusSnapshot {
  /** Tab step index (0-based). */
  readonly index: number;
  readonly tag: string;
  readonly id: string | null;
  readonly role: string | null;
  /** Accessible-ish name (aria-label or trimmed text), if any. */
  readonly name: string | null;
  /** Stable selector used for identity, e.g. `button#submit`. */
  readonly selector: string;
  /** True when this is the trailing exit sentinel (focus escaped the component). */
  readonly isExit: boolean;
}

export type TrapKind = 'none' | 'stuck' | 'cycle';

export interface FocusOrderReport {
  /** A confirmed keyboard trap was detected. */
  readonly isTrap: boolean;
  readonly trapKind: TrapKind;
  /** Whether Tab focus escaped past the component (reached the exit sentinel). */
  readonly reachedExit: boolean;
  /** Distinct focusable elements, in tab order. */
  readonly focusOrder: readonly string[];
  /** Number of distinct focusable elements traversed inside the component. */
  readonly focusableCount: number;
  /**
   * True when neither an exit nor a trap was observed within the step budget —
   * the result is inconclusive (raise `maxTabs`), not a confirmed trap.
   */
  readonly inconclusive: boolean;
  readonly message: string;
}
