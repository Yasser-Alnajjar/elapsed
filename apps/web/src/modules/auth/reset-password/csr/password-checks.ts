export interface PasswordCheck {
  label: string;
  status: string;
  met: boolean;
}

/** Live checks shown in the entropy panel; only the 8-char minimum gates submit. */
export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { label: "≥ 8 characters", status: "MET ✓", met: password.length >= 8 },
    {
      label: "Mixed casing, numbers & symbols",
      status: "MET ✓",
      met:
        /[a-z]/.test(password) &&
        /[A-Z]/.test(password) &&
        /\d/.test(password) &&
        /[^A-Za-z0-9]/.test(password),
    },
    { label: "≥ 12 characters", status: "MET ✓", met: password.length >= 12 },
    {
      label: "No repeated character runs",
      status: "CHECKED ✓",
      met: password.length > 0 && !/(.)\1{2,}/.test(password),
    },
  ];
}

/** Share of checks met, as a whole percentage. */
export function passwordEntropy(checks: PasswordCheck[]): number {
  return Math.round(
    (checks.filter((check) => check.met).length / checks.length) * 100,
  );
}
