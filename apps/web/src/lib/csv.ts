// The CSV builder (and its spreadsheet-formula neutralization) lives in
// `@sla/core` so the monthly report's attachment uses the same code; this
// re-export keeps the web app's own imports unchanged.
export { buildCsv, buildCsvHeaderLine, buildCsvRowLines, neutralizeFormula } from "@sla/core";
