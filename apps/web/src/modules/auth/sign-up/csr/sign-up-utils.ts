const FREE_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "mail.com",
];

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export type EmailDomainState = "pending" | "free" | "corporate";

export function emailDomainState(email: string): EmailDomainState {
  const parts = email.split("@");

  if (parts.length !== 2 || !parts[1]?.includes(".")) {
    return "pending";
  }

  return FREE_EMAIL_DOMAINS.includes(parts[1].toLowerCase())
    ? "free"
    : "corporate";
}

export function passwordStrength(password: string) {
  const length = password.length;

  if (length === 0) {
    return {
      level: 0,
      tone: "",
      text: "Minimum 8 characters",
    };
  }

  if (length < 8) {
    return {
      level: 1,
      tone: "bg-error",
      text: `${length}/8 characters`,
    };
  }

  if (length < 12) {
    return {
      level: 2,
      tone: "bg-warning",
      text: "Acceptable",
    };
  }

  if (length < 16) {
    return {
      level: 3,
      tone: "bg-primary-fixed-dim",
      text: "Strong",
    };
  }

  return {
    level: 4,
    tone: "bg-success",
    text: "Very strong",
  };
}
