import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import nextGuardrails from "./eslint-next-guardrails.mjs";

const linter = new Linter({ configType: "flat" });

function verify(code, rule) {
  return linter.verify(
    code,
    [
      {
        languageOptions: {
          parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" }
        },
        plugins: { "iam-next-guardrails": nextGuardrails },
        rules: { [`iam-next-guardrails/${rule}`]: "warn" }
      }
    ],
    { filename: "sample.jsx" }
  );
}

describe("local Next.js ESLint guardrails", () => {
  it("flags raw img elements", () => {
    const messages = verify('const View = () => <img src="/logo.svg" alt="Logo" />;', "no-img-element");
    expect(messages.map((message) => message.messageId)).toContain("useNextImage");
  });

  it("flags internal anchor navigation", () => {
    const messages = verify('const View = () => <a href="/settings">Settings</a>;', "no-html-link-for-pages");
    expect(messages.map((message) => message.messageId)).toContain("useNextLink");
  });

  it("does not flag external anchors", () => {
    const messages = verify('const View = () => <a href="https://example.com">External</a>;', "no-html-link-for-pages");
    expect(messages).toHaveLength(0);
  });
});
