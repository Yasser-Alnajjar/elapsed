/**
 * The account-lifecycle emails (verification, email change, password reset,
 * invitation): the web app builds a template request from a token, and the
 * shared `@sla/email` layout renders it. These run the real builders and the
 * real layout end to end, with no mocks, to prove each reaches the recipient
 * inside the Elapsed shell with the right link and lifetime.
 */
import { renderEmail } from "@sla/email";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildEmailChangeVerificationEmail, buildEmailVerificationEmail } from "../src/lib/email-verification-email";
import { buildInvitationEmail } from "../src/lib/invitation-email";
import { buildPasswordResetEmail } from "../src/lib/password-reset-email";

const ORIGINAL = process.env.NEXTAUTH_URL;
beforeEach(() => {
  process.env.NEXTAUTH_URL = "https://sla.example.com";
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ORIGINAL;
});

const expectBrandedShell = (email: ReturnType<typeof renderEmail>) => {
  expect(email.html).toContain('data-elapsed-email="shell"');
  expect(email.html).toContain('src="cid:elapsed-logo"');
  expect(email.html).toContain("© ");
  expect(email.html).toContain('href="https://sla.example.com"');
  expect(email.text).toContain("-- \n");
  expect(email.text).toContain("https://sla.example.com");
};

describe("account emails render through the Elapsed layout", () => {
  it("email verification", () => {
    const request = buildEmailVerificationEmail({ to: "new@example.com", token: "tok 1" });
    expect(request.to).toEqual(["new@example.com"]);
    const email = renderEmail(request);
    expectBrandedShell(email);
    expect(email.subject).toBe("Verify your email for Elapsed");
    expect(email.text).toContain("https://sla.example.com/verify-email?token=tok+1");
    expect(email.text).toContain("expires in 24 hours");
  });

  it("email change confirmation", () => {
    const email = renderEmail(buildEmailChangeVerificationEmail({ to: "b@example.com", token: "tok2" }));
    expectBrandedShell(email);
    expect(email.subject).toBe("Confirm your new email for Elapsed");
    expect(email.text).toContain("https://sla.example.com/verify-email?token=tok2");
  });

  it("password reset", () => {
    const email = renderEmail(buildPasswordResetEmail({ to: "a@example.com", token: "tok3" }));
    expectBrandedShell(email);
    expect(email.subject).toBe("Reset your Elapsed password");
    expect(email.text).toContain("https://sla.example.com/reset-password?token=tok3");
    expect(email.text).toContain("expires in 60 minutes");
  });

  it("invitation, escaping the organization name", () => {
    const request = buildInvitationEmail({ to: "a@example.com", organizationName: "Acme <b>&</b> Co", token: "tok4" });
    const email = renderEmail(request);
    expectBrandedShell(email);
    expect(email.subject).toBe("You've been invited to join Acme <b>&</b> Co on Elapsed");
    expect(email.text).toContain("https://sla.example.com/invite/accept?token=tok4");
    expect(email.text).toContain("expires in 7 days");
    expect(email.html).not.toContain("<b>&</b>");
    expect(email.html).toContain("Acme &lt;b&gt;&amp;&lt;/b&gt; Co");
  });
});
