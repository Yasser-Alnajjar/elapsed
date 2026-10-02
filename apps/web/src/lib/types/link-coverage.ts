/** Link coverage of one organization over a window of recent cases; see `getLinkCoverage`. */
export interface LinkCoverage {
  /** Cases opened in the window (not deleted). */
  cases: number;
  /** Of those, cases with at least one active, `certain` link to a work tracker or code host. */
  linkedCases: number;
  /** `linkedCases / cases`; null when there are no cases to measure. */
  ratio: number | null;
}
