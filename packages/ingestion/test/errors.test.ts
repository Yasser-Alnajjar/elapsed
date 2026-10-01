import { describe, expect, it } from "vitest";
import { PERMISSION_DENIED_BRAND, PermissionDeniedError, ProviderUnavailableError, ReauthRequiredError } from "../src";

describe("shared errors", () => {
  it("recognises the class itself and anything carrying the brand, and nothing else", () => {
    const branded = Object.assign(new Error("403"), { [PERMISSION_DENIED_BRAND]: true });
    expect(new PermissionDeniedError()).toBeInstanceOf(PermissionDeniedError);
    expect(branded).toBeInstanceOf(PermissionDeniedError);
    expect(new Error("403")).not.toBeInstanceOf(PermissionDeniedError);
    expect(new ProviderUnavailableError()).not.toBeInstanceOf(PermissionDeniedError);
    expect(new ReauthRequiredError()).not.toBeInstanceOf(PermissionDeniedError);
    expect(null).not.toBeInstanceOf(PermissionDeniedError);
    expect("403").not.toBeInstanceOf(PermissionDeniedError);
  });

  it("names each error and gives it a default message", () => {
    expect(new ReauthRequiredError()).toMatchObject({ name: "ReauthRequiredError" });
    expect(new PermissionDeniedError()).toMatchObject({ name: "PermissionDeniedError" });
    expect(new ProviderUnavailableError("timeout")).toMatchObject({ name: "ProviderUnavailableError", message: "timeout" });
  });
});
