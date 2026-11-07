import { describe, it, expect } from "vitest";
import { LLMReportSchema, LLM_REPORT_JSON_SCHEMA, FindingSchema, llmJsonSchema } from "../../src/core/schema";
import { RISK_CATEGORIES, CATEGORY_INFO } from "../../src/core/categories";

type JS = { type?: unknown; properties?: Record<string, JS>; required?: string[]; additionalProperties?: unknown; items?: JS; anyOf?: JS[] };

function walkObjects(node: JS, visit: (o: JS, path: string) => void, path = "#") {
  if (!node || typeof node !== "object") return;
  if (node.type === "object" || node.properties) visit(node, path);
  for (const [k, v] of Object.entries(node.properties ?? {})) walkObjects(v, visit, `${path}/${k}`);
  if (node.items) walkObjects(node.items, visit, `${path}/items`);
  for (const [i, v] of (node.anyOf ?? []).entries()) walkObjects(v, visit, `${path}/anyOf/${i}`);
}

const valid = {
  schema_version: "1.0",
  document_type: "terms_of_service",
  document_language: "en",
  llm_suggested_score: 60,
  summary_tr: "Bu belge birkaç önemli risk içeriyor.",
  findings: [
    {
      category: "auto_renewal",
      severity: "high",
      title_tr: "Otomatik yenileme",
      explanation_tr: "Abonelik siz iptal edene kadar yenilenir ve ücret alınır.",
      quote: "Your subscription will automatically renew each month.",
      segment_id: "S004",
      confidence: 0.9,
    },
  ],
  injection_suspected: false,
  injection_segment_ids: [],
  uncertainty_notes_tr: null,
};

describe("schema", () => {
  it("geçerli raporu kabul eder", () => {
    expect(LLMReportSchema.safeParse(valid).success).toBe(true);
  });
  it("ekstra alanı reddeder (strict)", () => {
    expect(LLMReportSchema.safeParse({ ...valid, risk_score: 0 }).success).toBe(false);
    const f = { ...valid.findings[0], extra: 1 };
    expect(FindingSchema.safeParse(f).success).toBe(false);
  });
  it("geçersiz segment_id ve kategoriyi reddeder", () => {
    expect(FindingSchema.safeParse({ ...valid.findings[0], segment_id: "S1" }).success).toBe(false);
    expect(FindingSchema.safeParse({ ...valid.findings[0], category: "nope" }).success).toBe(false);
  });
  it("uncertainty_notes_tr zorunludur ama null olabilir", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { uncertainty_notes_tr, ...rest } = valid;
    expect(LLMReportSchema.safeParse(rest).success).toBe(false);
  });
  it("JSON Schema: her objede additionalProperties:false ve tüm property'ler required", () => {
    let objects = 0;
    walkObjects(LLM_REPORT_JSON_SCHEMA as JS, (o, path) => {
      objects++;
      expect(o.additionalProperties, path).toBe(false);
      expect([...(o.required ?? [])].sort(), path).toEqual(Object.keys(o.properties ?? {}).sort());
    });
    expect(objects).toBe(2);
  });
  it("JSON Schema'da $ref yok, llmJsonSchema $schema içermez", () => {
    expect(JSON.stringify(LLM_REPORT_JSON_SCHEMA)).not.toContain("$ref");
    expect(llmJsonSchema()).not.toHaveProperty("$schema");
    expect(llmJsonSchema()).toHaveProperty("type", "object");
  });
  it("her kategorinin TR etiketi ve açıklaması var", () => {
    for (const c of RISK_CATEGORIES) {
      expect(CATEGORY_INFO[c].label_tr.length).toBeGreaterThan(2);
      expect(CATEGORY_INFO[c].description_tr.length).toBeGreaterThan(10);
    }
  });
});
