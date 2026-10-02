export interface FindingsAccountRow {
  customerName: string;
  escalatedCases: number;
  breachedCases: number;
}

export interface FindingsData {
  /**
   * A work tracker or code host is connected, or escalations were already
   * recorded. False means the escalation figures below are "not measured",
   * not zero: a ticket-source-only organization has support-side findings
   * only (N5.2).
   */
  trackerConnected: boolean;
  periodDays: number;
  totalEscalated: number;
  exceededTarget: number;
  avgEngineeringMinutes: number | null;
  topAccounts: FindingsAccountRow[];
}
