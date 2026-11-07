// Kullanıcı tarafından güncellenebilir; sağlayıcı dokümantasyonundan doğrulayın.
// DOĞRULAMA DURUMU (Faz 11): bu adlar geliştirme sırasında sağlayıcıların canlı dokümanlarıyla doğrulanamadı.
// Claude kimlikleri gömülü bir API referansından (2026-10 önbelleği) alındı; OpenAI ve Groq adları doğrulanmadı.
// Options sayfasında serbest metin alanı da vardır; buradaki liste yalnızca öneridir.
export const SUGGESTED_MODELS = {
  // Claude model kimlikleri (Anthropic API referansı, 2026-10 önbelleği)
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  // OpenAI: json_schema strict destekli modeller — güncelliğini platform.openai.com/docs/models üzerinden doğrulayın
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  // Groq: güncelliğini console.groq.com/docs/models üzerinden doğrulayın
  groq: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
} as const;

export const DEFAULT_MODELS = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-4.1",
  groq: "openai/gpt-oss-120b",
} as const;
