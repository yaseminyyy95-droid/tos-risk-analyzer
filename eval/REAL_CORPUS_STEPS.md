# Gerçek korpusla benchmark — adım adım (kendi makinenizde)

Bu adımlar, `eval/corpus.manifest.json` içindeki 5 gerçek şirket kullanım koşulunu (ve bonus Spotify gizlilik politikasını) değerlendirmeye almak içindir. Geliştirme ortamında ağ erişimi olmadığından bu kısım yapılamadı.

> Metinler yalnızca araştırma/eğitim amaçlı değerlendirme için kullanılır. Ham HTML (`eval/raw/`) **repoya eklenmez** (`.gitignore`'da). Kaynak URL, erişim tarihi ve SHA-256 manifest'e otomatik yazılır.

## Ön koşullar

- Node ≥ 20 ve proje kökünde `npm ci` çalıştırılmış olmalı.
- Chromium tabanlı bir tarayıcı (Chrome/Edge).
- Gerçek model çalıştırması (adım d) için bir sağlayıcı API anahtarı.

## (a) Sayfaları HTML olarak kaydedin

Her satır için: sayfayı tarayıcıda açın → çerez bannerını kabul edin veya kapatın → gerekiyorsa sayfanın sonuna kadar kaydırın (tembel yüklenen bölümler için) → **Dosya → Farklı kaydet → "Web sayfası, yalnızca HTML"** → aşağıdaki adla `eval/raw/` klasörüne kaydedin.

| Kimlik | Şirket | URL | Kaydedilecek dosya |
|---|---|---|---|
| `zoom-tos` | Zoom | https://www.zoom.com/en/trust/terms/ | `eval/raw/zoom-tos.html` |
| `spotify-tou` | Spotify | https://www.spotify.com/us/legal/end-user-agreement/ | `eval/raw/spotify-tou.html` |
| `tiktok-tos-us` | TikTok | https://www.tiktok.com/legal/page/us/terms-of-service/en | `eval/raw/tiktok-tos-us.html` |
| `netflix-tou` | Netflix | https://help.netflix.com/legal/termsofuse | `eval/raw/netflix-tou.html` |
| `reddit-ua` | Reddit | https://redditinc.com/policies/user-agreement | `eval/raw/reddit-ua.html` |
| `spotify-privacy` (bonus) | Spotify | https://www.spotify.com/us/legal/privacy-policy/ | `eval/raw/spotify-privacy.html` |

İpuçları:
- URL bir bölge sayfasına yönlenirse ABD/İngilizce sürümü seçin. Farklı bir URL kullandıysanız `corpus.manifest.json` içindeki `url` alanını güncelleyin.
- Sayfa akordeonlar içeriyorsa kaydetmeden önce açmanıza gerek yok: extractor `<details>` ve `aria-controls` panellerini zaten dahil eder.
- Alternatif olarak ağ erişiminiz varsa adım (b) yerine `npm run eval:fetch` sayfaları Playwright ile doğrudan çekmeyi dener. Bot engeli olursa bu adıma geri dönün.

## (b) Korpusu oluşturun

```bash
npm run eval:fetch -- --from-raw
```

- Her dosya için `eval/corpus/<id>.json` oluşur (uzantının extractor kodu Chromium'da çalıştırılır). Manifest'e `retrievedAt`, `sha256` ve `extractor` yazılır.
- `eval/raw/` boşsa komut beklenen dosya adlarını listeleyip **çıkış kodu 1** ile durur ve manifest'e dokunmaz. Bazı dosyalar eksikse eksikler uyarı olarak listelenir ve atlanır.
- Tek doküman için: `npm run eval:fetch -- --from-raw --only zoom-tos`.
- Çıktıdaki `blok / karakter / karantina` sayılarına bakın. Karakter sayısı beklenenden çok düşükse sayfa eksik kaydedilmiştir (çerez duvarı, "devamını oku" düğmesi); (a) adımını tekrarlayın.

## (c) Gold etiketleri yazın ve doğrulayın

Her doküman için `eval/gold/<id>.json` dosyasını oluşturun. Biçim için `eval/gold/synthetic-acme-cloud-tos.json` dosyasını örnek alın. Kurallar ve severity rubriği `eval/ANNOTATION_GUIDE.md` dosyasındadır.

Kontrol listesi (doküman başına):

- [ ] Metni baştan sona okudum, akordeon ve sekmelerdeki maddeleri de kontrol ettim.
- [ ] 6–15 madde; nötr kalıp metin yok; aynı maddenin alt fıkraları tek item.
- [ ] Her `anchorQuote` metinden **birebir** kopyalandı (≥ 25 karakter, ≥ 5 kelime).
- [ ] `category` ve `severity` ANNOTATION_GUIDE'daki tablo ve rubriğe uygun.
- [ ] `acceptableCategories` yalnızca gerçekten tartışmalı maddelerde birden fazla kategori içeriyor.
- [ ] `annotator` alanına adımı yazdım. İnceleme bitince `annotationStatus: "reviewed"` yaptım (ikinci bir kişi incelediyse daha iyi).
- [ ] Gold'u model çıktısına bakmadan yazdım (annotation bias riskini azaltmak için).

Doğrulama:

```bash
npm run eval:validate-gold
```

Tüm satırlar `✓` olmalı. `anchorQuote metinde yok` hatası çoğunlukla tipografik tırnak veya kopyalama farkından kaynaklanır; alıntıyı `eval/corpus/<id>.json` içindeki `blocks[].text` alanından kopyalayın.

## (d) Gerçek modelle çalıştırın

```bash
OPENAI_API_KEY=sk-... npm run eval:all -- --provider openai --model <MODEL_ADI> --repeats 3
```

- `<MODEL_ADI>` yerine sağlayıcının güncel model listesinden bir ad yazın. Anthropic için `ANTHROPIC_API_KEY` ile `--provider anthropic`, Groq için `GROQ_API_KEY` ile `--provider groq` kullanın.
- `--repeats 3` model nondeterminizmini ölçer (rapordaki `repeatsF1`); tablo 1. tekrardan üretilir.
- Ret-fallback eval'de **her zaman kapalıdır**. Yanıtlayan model istenenden farklıysa terminalde `⚠ yanıtlayan model` uyarısı çıkar ve `eval/runs/_last/meta.json` dosyasında `servedModelMismatch: true` olur. Bu durumda sonuçları raporlamadan önce nedenini araştırın.
- Ham yanıtlar `eval/runs/_last/raw/` altına kaydedilir. Kalıcı olarak saklamak için klasörü yeniden adlandırın (ör. `eval/runs/2026-11-openai`); anahtarsız yeniden skorlama için:

```bash
npm run eval:all -- --provider mock --replay eval/runs/2026-11-openai
```

- Maliyet: her doküman ~1 çağrı (uzun dokümanlarda 40k karakterlik chunk başına 1) ve adversarial test için doküman başına 5 ek çağrı. `--repeats` ile çarpılır.

## (e) FP adjudication

`eval/results/adjudication.csv` dosyasında her yanlış pozitif (FP) için `verdict` sütununu doldurun:

| verdict | Anlamı |
|---|---|
| `true_fp` | Bulgu gerçekten riskli değil veya kategori yanlış |
| `valid_unannotated` | Bulgu geçerli bir risk ama gold'da yoktu (gold'a eklemeyi düşünün) |
| `unclear` | Karar verilemedi (varsayılan) |

Ardından:

```bash
npm run eval:score -- --run eval/runs/_last
```

İşaretler korunur. Rapor ham precision'ı ve "adjudication sonrası precision"ı ayrı gösterir. `valid_unannotated` olanları gold'a eklerseniz (c) adımındaki doğrulamayı tekrarlayın ve bu değişikliği raporda belirtin.

## (f) Sonuçları rapora işleyin

1. `npm run eval:all …` zaten `eval/results/report.md`, `report.json`, `adversarial.json` ve `docs/EVAL_REPORT.md` dosyalarını yazar. Sentetik uyarı bloğu yalnızca sentetik çalışmalarda görünür.
2. `README.md` dosyasındaki **Benchmark** tablosunu gerçek sonuçlarla güncelleyin: micro/macro P-R-F1, doğrulama öncesi halüsinasyon oranı, grounding invariant'ı, adversarial ASR ve tespit oranı. Model adını, tarihi ve tekrar sayısını yazın.
3. Sınırlamaları yazın: n=5, gold'un inceleme durumu (draft/reviewed, annotator sayısı), sitelerin metninin değişebileceği (SHA-256 manifest'te) ve model sürümü (`servedModel`).
4. `eval/corpus/*.json`, `eval/gold/*.json` ve `eval/results/` dosyalarını commit'leyin. `eval/raw/` ve `eval/runs/_last/` commit'lenmez.
