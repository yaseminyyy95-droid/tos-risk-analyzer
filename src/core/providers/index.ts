import { AnthropicProvider } from "./anthropic";
import { GroqProvider } from "./groq";
import { OpenAIProvider } from "./openai";
import { MockProvider, type MockResponder } from "./mock";
import type { HttpOptions } from "./http";
import type { LLMProvider, LLMProviderId } from "./types";

export * from "./types";
export { MockProvider, maskKeyExport as maskKey };
import { maskKey as maskKeyExport } from "./http";

export const PROVIDER_LABEL: Record<LLMProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
  mock: "Mock (test)",
};

export function createProvider(id: LLMProviderId, apiKey: string, opts: HttpOptions & { mock?: string[] | MockResponder } = {}): LLMProvider {
  switch (id) {
    case "openai":
      return new OpenAIProvider(apiKey, opts);
    case "anthropic":
      return new AnthropicProvider(apiKey, opts);
    case "groq":
      return new GroqProvider(apiKey, opts);
    case "mock":
      return new MockProvider(opts.mock ?? []);
  }
}
