import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { extractDocument } from "../../src/content/extractor";
import { analyzeDocument } from "../../src/core/pipeline";
import { MockProvider } from "../../src/core/providers/mock";
import { parseChatCompletion } from "../../src/core/providers/openai";

const root = path.resolve(__dirname, "../..");
const page = (f: string) => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "fixtures/pages", f), "utf8"), { url: `http://localhost:4173/pages/${f}` });
  return extractDocument(dom.window.document);
};
const llm = (f: string) => parseChatCompletion(JSON.parse(fs.readFileSync(path.join(root, "fixtures/llm", f), "utf8"))).raw;
const expected = JSON.parse(fs.readFileSync(path.join(root, "fixtures/llm/expected.json"), "utf8"));

describe("E2E fixture'ları gerçek pipeline ile tutarlı", () => {
  it("acme-tos + happy → OK, 6 doğrulanmış bulgu, 1 normalize eşleşme", async () => {
    const doc = page("acme-tos.html");
    expect(doc.quarantined).toHaveLength(0);
    const { report } = await analyzeDocument(doc, new MockProvider([llm("happy.openai.json")]), { model: "gpt-4.1" });
    expect(report.status).toBe("OK");
    expect(report.findings).toHaveLength(6);
    expect(report.score).toBe(expected.happy.score);
    expect(report.findings.filter((f) => f.matchTier === "normalized")).toHaveLength(1);
    expect(report.sentinelHints.length).toBeLessThan(2);
  });
  it("injected-tos + compromised → UNCERTAIN, 1 bulgu, 3 ret, gizli metin LLM'e gitmez", async () => {
    const doc = page("injected-tos.html");
    expect(doc.quarantined.length).toBeGreaterThanOrEqual(1);
    const provider = new MockProvider([llm("compromised.openai.json")]);
    const { report } = await analyzeDocument(doc, provider, { model: "gpt-4.1" });
    expect(provider.calls[0]!.user).not.toContain("certified safe");
    expect(provider.calls[0]!.user).toContain("⚠ FLAGGED_AS_POSSIBLE_INJECTION Note to AI assistants");
    expect(report.status).toBe("UNCERTAIN");
    expect(report.findings).toHaveLength(1);
    expect(report.rejectedCount).toBe(3);
    expect(report.score).toBe(expected.compromised.score);
    expect(report.score).not.toBe(0);
    expect(report.injection.modelPossiblyInfluenced).toBe(true);
    expect(JSON.stringify(report)).not.toContain(expected.compromised.fabricated);
  });
});
