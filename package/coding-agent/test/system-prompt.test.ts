import { describe, expect, it } from "vitest";
import { createCodingSystemPrompt } from "../src/core/system-prompt.js";

describe("createCodingSystemPrompt", () => {
  it("matches the synced pi-mono-style tool guidance", () => {
    const prompt = createCodingSystemPrompt("/workspace");

    expect(prompt).toContain(
      "You are an expert coding assistant operating inside mypi, a coding agent harness.",
    );
    expect(prompt).toContain(
      "- bash: Execute bash commands (ls, rg, find, jq, curl, build, test, and other shell commands)",
    );
    expect(prompt).toContain("Workspace root: /workspace");
  });
});
