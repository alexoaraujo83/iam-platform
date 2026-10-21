import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const actionSource = readFileSync(
  new URL("./auth0-post-login-claims.js", import.meta.url),
  "utf8",
);

function loadAction() {
  const actionExports = {};
  const warning = vi.fn();
  vm.runInNewContext(actionSource, {
    exports: actionExports,
    URL,
    console: { warn: warning },
  });
  return { onExecutePostLogin: actionExports.onExecutePostLogin, warning };
}

async function executeAction(namespace, roles) {
  const action = loadAction();
  const setCustomClaim = vi.fn();
  await action.onExecutePostLogin(
    {
      secrets: { IAM_CLAIMS_NAMESPACE: namespace },
      authorization: { roles },
    },
    { accessToken: { setCustomClaim } },
  );
  return { ...action, setCustomClaim };
}

describe("Auth0 Post Login claims Action", () => {
  it("emits only namespaced Auth0 role metadata for a valid HTTPS namespace", async () => {
    const { setCustomClaim, warning } = await executeAction(
      "https://auth.acme.test/claims",
      ["admin", "reader"],
    );

    expect(setCustomClaim).toHaveBeenCalledOnce();
    expect(setCustomClaim).toHaveBeenCalledWith(
      "https://auth.acme.test/claims/auth0_roles",
      ["admin", "reader"],
    );
    expect(warning).not.toHaveBeenCalled();
  });

  it("filters non-string and empty role values", async () => {
    const { setCustomClaim } = await executeAction(
      "https://auth.acme.test/claims",
      ["admin", "", null, 7, "reader"],
    );

    expect(setCustomClaim).toHaveBeenCalledWith(
      "https://auth.acme.test/claims/auth0_roles",
      ["admin", "reader"],
    );
  });

  it("emits an empty role list when Auth0 provides no roles", async () => {
    const { setCustomClaim } = await executeAction(
      "https://auth.acme.test/claims",
      undefined,
    );

    expect(setCustomClaim).toHaveBeenCalledWith(
      "https://auth.acme.test/claims/auth0_roles",
      [],
    );
  });

  it.each([
    "http://auth.acme.test/claims",
    "https://example.com/claims",
    "https://example.net/claims",
    "https://example.org/claims",
    "https://example.edu/claims",
    "https://iam.example.com/claims",
    "https://iam.example.net/claims",
    "https://iam.example.org/claims",
    "https://iam.example.edu/claims",
    "https://auth.acme.test/not-claims",
    "https://user:pass@auth.acme.test/claims",
    "https://auth.acme.test/claims?mode=unsafe",
    "https://auth.acme.test/claims#fragment",
    "",
    null,
  ])("skips invalid namespace %s without breaking login", async (namespace) => {
    const { setCustomClaim, warning } = await executeAction(
      namespace,
      ["admin"],
    );

    expect(setCustomClaim).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
  });

  it("normalizes a trailing slash on a valid namespace", async () => {
    const { setCustomClaim } = await executeAction(
      "https://auth.acme.test/claims/",
      ["admin"],
    );

    expect(setCustomClaim).toHaveBeenCalledWith(
      "https://auth.acme.test/claims/auth0_roles",
      ["admin"],
    );
  });
});
