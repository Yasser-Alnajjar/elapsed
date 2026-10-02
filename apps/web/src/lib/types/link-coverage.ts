/** Link coverage of one organization over a window of recent cases; see `getLinkCoverage`. */
export interface LinkCoverage {
  /** Cases opened in the window (not deleted). */
  cases: number;
  /** Of those, cases with at least one active, `certain` link to a work tracker or code host. */
  linkedCases: number;
  /** `linkedCases / cases`; null when there are no cases to measure. */
  ratio: number | null;
}

/** One case counted against coverage: opened in the window with no active `certain` link to engineering. */
export interface UncoveredCaseRow {
  caseId: string;
  externalId: string;
  subject: string | null;
  customerName: string | null;
  openedAt: string;
  /** Its only active links are `probable` ones, which never count as covered. */
  hasProbableLink: boolean;
}

/** The customer-facing coverage panel (N5.5): the shared number plus the cases behind the gap. */
export interface LinkCoveragePanel extends LinkCoverage {
  windowDays: number;
  /** Of the uncovered cases, those holding a `probable` link. Shown apart; never inflate `linkedCases`. */
  probableOnlyCases: number;
  /** Capped; `uncoveredOverflowCount` reports the rest. Most recent first. */
  uncovered: UncoveredCaseRow[];
  uncoveredOverflowCount: number;
}
