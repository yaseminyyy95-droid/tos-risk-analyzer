# Mini Benchmark (Eval)

> **Gold etiketler LLM destekli taslaktır; insan incelemesinden geçmeden kesin metrik değildir (annotation bias riski).**
> Metinler yalnızca araştırma/eğitim amaçlı değerlendirme için, kaynak URL + tarih + SHA-256 ile kullanılır. Ham HTML (`eval/raw/`) repoya eklenmez.

## Bu repodaki durum

- `corpus.manifest.json` 5 gerçek şirket ToS kaydı (Zoom, Spotify, TikTok US, Netflix, Reddit) ve 1 gizlilik politikası içerir. Bu kayıtlar geliştirme ortamında **çekilmedi**: ağ politikası bu sitelere izin vermiyordu ve internet erişimi eklenmedi. Bu yüzden `sha256/retrievedAt` alanları boştur ve gerçek dokümanlar için gold etiket yoktur (metin görülmeden üretilen etiket uydurma olurdu).
- Anahtarsız uçtan uca çalışma **açıkça sentetik** verilerle yapılır:
  - `eval/synthetic/*.html`: 3 kurgusal doküman (Acme Cloud ToS, BrightStream abonelik şartları, Nimbus Health gizlilik politikası).
  - `eval/corpus/synthetic-*.json`: gerçek extractor ile Chromium'da çıkarılmış hali.
  - `eval/gold/synthetic-*.json`: taslak gold etiketler (6–9 madde).
  - `eval/runs/example-synthetic/`: **simüle model** çıktıları (`scripts/simulated-model.ts`). Kasıtlı hatalar içerir (kaçırılan madde, uydurma/parafraz alıntı, `...` içeren alıntı, yanlış kategori, gold dışı ek bulgu). Gerçek bir LLM performansı değildir.

## Komutlar

```bash
npm run eval:all -- --provider mock --replay eval/runs/example-synthetic
```

Bu komut anahtarsız ve ağsız çalışır. Sırasıyla gold doğrulama, replay, skorlama ve adversarial testi yapar; çıktılar `eval/results/` ve `docs/EVAL_REPORT.md` dosyalarına yazılır.

### Gerçek dokümanlarla (kendi makinenizde)

1. Korpusu çekin:

```bash
npm run eval:fetch
```

Bot engeli olursa sayfayı tarayıcıda açıp "Farklı kaydet (yalnızca HTML)" ile `eval/raw/<id>.html` olarak kaydedin, ardından:

```bash
npm run eval:fetch -- --from-raw
```

2. Her doküman için `eval/gold/<id>.json` dosyasına 6–15 maddelik gold etiket yazın (`ANNOTATION_GUIDE.md`). Ardından doğrulayın:

```bash
npm run eval:validate-gold
```

3. Gerçek sağlayıcıyla çalıştırın:

```bash
OPENAI_API_KEY=sk-... npm run eval:all -- --provider openai --model gpt-4.1 --repeats 1
```

Anthropic için `ANTHROPIC_API_KEY` ile `--provider anthropic --model claude-opus-5-5`, Groq için `GROQ_API_KEY` ile `--provider groq` kullanın.

4. Ham yanıtlar `eval/runs/_last/raw/` altına kaydedilir. Aynı yanıtları anahtarsız yeniden skorlamak için:

```bash
npm run eval:all -- --provider mock --replay eval/runs/_last
```

## Metodoloji

- **Eşleştirme**: tahmin alıntısı ve gold `anchorQuote` kanonik metinde konumlandırılır (normalize + indeks haritası). Span'ler çakışıyorsa ya da aynı/komşu segmentte ≤ 150 karakter aralıktaysa, ve tahmin kategorisi `acceptableCategories` içindeyse eşleşir. Eşleştirme greedy ve bire-birdir.
- **Metrikler**: doküman bazında ve toplamda (micro + macro) Precision/Recall/F1; doğrulama öncesi halüsinasyon oranı (reddedilen/önerilen); doğrulama sonrası grounding (invariant testi, tanım gereği %100); kategori bazında recall; severity uyumu; skor; durum dağılımı; süre ve token.
- **FP adjudication**: `eval/results/adjudication.csv`. İşaretler sonraki skorlamalarda korunur; rapor ham precision ile adjudication sonrası precision'ı ayrı gösterir.
- **Adversarial**: 5 saldırı varyantı (görünür, gizli, sahte ayraç, Türkçe, "vendor certified"). Mock modunda, talimata koşulsuz uyan iki simüle profil kullanılır.

## Sınırlamalar

Küçük n; taslak gold; tek annotator; sitelerin metni değişebilir; model nondeterminizmi (`--repeats` ile ölçün); sentetik sonuçlar gerçek model performansı değildir.
