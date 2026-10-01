import { describe, expect, it } from "vitest";
import { GithubPermissionDeniedError, GithubReauthRequiredError } from "@sla/github";
import { IntercomPermissionDeniedError, IntercomReauthRequiredError } from "@sla/intercom";
import { JiraApiError, JiraPermissionDeniedError, JiraReauthRequiredError } from "@sla/jira";
import { LinearPermissionDeniedError, LinearReauthRequiredError } from "@sla/linear";
import { ZendeskApiError, ZendeskPermissionDeniedError, ZendeskReauthRequiredError } from "@sla/zendesk";
import { PermissionDeniedError, ProviderUnavailableError, ReauthRequiredError } from "@sla/ingestion";

const permissionDenied = [
  new ZendeskPermissionDeniedError("https://example.zendesk.com/api/v2/tickets"),
  new JiraPermissionDeniedError("https://example.atlassian.net/rest/api/3/search"),
  new LinearPermissionDeniedError(403),
  new IntercomPermissionDeniedError(403, "https://api.intercom.io/conversations"),
  new GithubPermissionDeniedError(403),
];

const reauth = [
  new ZendeskReauthRequiredError(),
  new JiraReauthRequiredError(),
  new LinearReauthRequiredError(),
  new IntercomReauthRequiredError(),
  new GithubReauthRequiredError(),
];

describe("shared provider errors", () => {
  it.each(permissionDenied.map((error) => [error.name, error] as const))("%s is a PermissionDeniedError", (_name, error) => {
    expect(error).toBeInstanceOf(PermissionDeniedError);
  });

  it.each(reauth.map((error) => [error.name, error] as const))("%s is a ReauthRequiredError", (_name, error) => {
    expect(error).toBeInstanceOf(ReauthRequiredError);
  });

  it("keeps a provider's permission error a member of its own API error, with its status", () => {
    const zendesk = permissionDenied[0] as ZendeskPermissionDeniedError;
    expect(zendesk).toBeInstanceOf(ZendeskApiError);
    expect(zendesk.status).toBe(403);
    expect(permissionDenied[1]).toBeInstanceOf(JiraApiError);
  });

  it("keeps each error's own name for logs and Sentry grouping", () => {
    expect(permissionDenied.map((error) => error.name)).toEqual([
      "ZendeskPermissionDeniedError",
      "JiraPermissionDeniedError",
      "LinearPermissionDeniedError",
      "IntercomPermissionDeniedError",
      "GithubPermissionDeniedError",
    ]);
    expect(reauth.map((error) => error.name)).toEqual([
      "ZendeskReauthRequiredError",
      "JiraReauthRequiredError",
      "LinearReauthRequiredError",
      "IntercomReauthRequiredError",
      "GithubReauthRequiredError",
    ]);
  });

  it("does not match unrelated errors", () => {
    expect(new Error("403")).not.toBeInstanceOf(PermissionDeniedError);
    expect(new ZendeskApiError(500, "https://example.zendesk.com")).not.toBeInstanceOf(PermissionDeniedError);
    expect(new ProviderUnavailableError()).not.toBeInstanceOf(PermissionDeniedError);
    expect(new PermissionDeniedError()).not.toBeInstanceOf(ReauthRequiredError);
    expect(null).not.toBeInstanceOf(PermissionDeniedError);
  });

  it("is itself a PermissionDeniedError", () => {
    expect(new PermissionDeniedError()).toBeInstanceOf(PermissionDeniedError);
  });
});
