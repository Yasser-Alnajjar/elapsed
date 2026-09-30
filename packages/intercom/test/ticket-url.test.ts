import { describe, expect, it } from "vitest";
import { buildIntercomConversationUrl } from "../src/client";
import { recognizeIntercomConversationUrl } from "../src/ticket-url";

const credentials = { workspaceId: "v9jrtlg9" };

describe("recognizeIntercomConversationUrl (N1.13)", () => {
  it("round-trips the URL this package builds for a conversation", () => {
    expect(recognizeIntercomConversationUrl(buildIntercomConversationUrl("v9jrtlg9", "215467800000123"), credentials)).toBe(
      "215467800000123",
    );
  });

  it("accepts a trailing slash", () => {
    expect(recognizeIntercomConversationUrl("https://app.intercom.com/a/apps/v9jrtlg9/conversations/77/", credentials)).toBe("77");
  });

  it("returns null for another workspace — never correlates cross-tenant", () => {
    expect(recognizeIntercomConversationUrl(buildIntercomConversationUrl("other", "77"), credentials)).toBeNull();
  });

  it("returns null for a lookalike host, another scheme or a different Intercom host", () => {
    for (const url of [
      "https://app.intercom.com.evil.example/a/apps/v9jrtlg9/conversations/77",
      "http://app.intercom.com/a/apps/v9jrtlg9/conversations/77",
      "https://app.eu.intercom.com/a/apps/v9jrtlg9/conversations/77",
      "https://evil.example/a/apps/v9jrtlg9/conversations/77",
    ]) {
      expect(recognizeIntercomConversationUrl(url, credentials)).toBeNull();
    }
  });

  it("returns null for an Intercom URL that is not a conversation", () => {
    for (const url of [
      "https://app.intercom.com/a/apps/v9jrtlg9/users",
      "https://app.intercom.com/a/apps/v9jrtlg9/conversations",
      "https://app.intercom.com/a/apps/v9jrtlg9/conversations/77/extra",
      "not a url",
    ]) {
      expect(recognizeIntercomConversationUrl(url, credentials)).toBeNull();
    }
  });

  it("returns null while the workspace id has not been recorded yet", () => {
    const url = buildIntercomConversationUrl("v9jrtlg9", "77");
    for (const c of [null, undefined, {}, { workspaceId: "" }, { workspaceId: 5 }]) {
      expect(recognizeIntercomConversationUrl(url, c)).toBeNull();
    }
  });
});
