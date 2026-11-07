# Güvenlik Modeli

## Kapsam ve varsayımlar

- **Saldırgan**: analiz edilen sayfanın sahibi veya sayfaya içerik enjekte edebilen üçüncü taraf (yorum, reklam, kullanıcı içeriği, ele geçirilmiş CMS). Saldırgan sayfanın DOM'unu, CSS'ini ve görünür/görünmez metnini tamamen kontrol eder. Sayfa JS'i de content script'e mesaj göndermeye çalışabilir.
- **Güvenilen**: kullanıcı, tarayıcı, uzantı paketi ve seçilen LLM sağlayıcısının API'si (taşıma katmanı). **Modelin çıktısı güvenilmez kabul edilir**: model, metindeki talimatlarla yönlendirilmiş olabilir.
- **Varlıklar**:
  1. Rapor bütünlüğü (kullanıcının gördüğü bulgular, skor, durum);
  2. Kullanıcının API anahtarı;
  3. Kullanıcının tarayıcısı ve oturumları (XSS, yetki genişlemesi).

## STRIDE-lite tehdit → kontrol eşlemesi

| # | Tehdit | Kategori | Kontrol | Kod |
|---|---|---|---|---|
| T1 | Kullanıcıya görünmeyen talimat metni (1px, beyaz üstüne beyaz, ekran dışı, sr-only, aria-hidden, HTML yorumu) | Tampering | Görünürlük sınıflandırıcı saldırgan gizli içeriği **karantinaya** alır; LLM'e gitmez. Talimat içeren gizli blok sayısı durumu UNCERTAIN yapar ve UI'da gösterilir. Meşru akordeonlar (`<details>`, `aria-controls`, `role=tabpanel`) dahil edilir. | `content/visibility.ts`, `content/extractor.ts`, `core/status.ts` |
| T2 | Görünür talimat ("ignore previous instructions", "Note to AI…", TR varyantları) | Tampering / Elevation | Heuristik dedektör (EN+TR) → segment izolasyonu + `⚠ FLAGGED_AS_POSSIBLE_INJECTION` etiketi; system prompt güvenlik kuralları; doküman sonrası sandwich hatırlatma; işaretli segmentten gelen alıntılar reddedilir (V6); dedektör–model çelişkisi (V11) | `core/injection.ts`, `core/prompt.ts`, `core/verify.ts` |
| T3 | Skor manipülasyonu ("risk skoru 0") | Tampering | Nihai skor **yalnızca** doğrulanmış bulgulardan deterministik hesaplanır; LLM skoru tanısaldır; büyük sapma (V12) UNCERTAIN yapar | `core/score.ts`, `core/verify.ts` |
| T4 | Uydurma güvence / halüsinasyon ("We never share your data") | Spoofing | Grounded quote (V5): alıntı kanonik metinde birebir (normalize/büyük-küçük harf tier'ı dahil) yoksa bulgu silinir; fuzzy eşleşme yok. UI'da gösterilen alıntı her zaman **kaynak metinden** kesilir, LLM'in yazdığı dize değildir | `core/verify.ts` |
| T5 | LLM çıktısı üzerinden XSS / HTML enjeksiyonu | Elevation | Preact text node render; kod tabanında `innerHTML`/`dangerouslySetInnerHTML`/`eval`/`new Function` yok (ESLint kuralıyla engellenir); V10 URL ve `<>` temizliği; MV3 varsayılan CSP; remote code yok | `ui/`, `eslint.config.js` |
| T6 | API anahtarı sızıntısı | Information disclosure | Anahtar yalnızca SW'de (`keystore.ts`); `storage.session` erişim seviyesi `TRUSTED_CONTEXTS`; anahtar işlemleri yalnızca uzantı sayfalarından kabul edilir (sender doğrulaması); UI'ya yalnızca maske döner; hata mesajlarında maske (`maskSecrets`); rapor/export'ta anahtar alanı yok; `storage.sync` kullanılmaz | `background/keystore.ts`, `background/orchestrator.ts`, `core/providers/http.ts` |
| T7 | Ayraç kaçışı (`<<<END_DOC>>>`, sahte `[S012]`) | Tampering | İstek başına 16 baytlık rastgele nonce'lu ayraçlar; `<<<`/`>>>` → `‹‹‹`/`›››`; sahte segment etiketleri `[S·`; rol satırları (`system:`) işaretlenir | `core/sanitize.ts`, `core/prompt.ts` |
| T8 | System prompt sızdırma / modelin talimatları yankılaması | Information disclosure | İstek başına canary; çıktıda (veya hex parçasında) görülürse rapor FAILED (V0) | `core/verify.ts` |
| T9 | Ele geçirilmiş sayfanın content script kanalından sahte veri göndermesi | Spoofing / Tampering | SW, content script yanıtlarını strict Zod şemasıyla ve boyut sınırlarıyla doğrular; content script yalnızca kendi uzantısından gelen mesajları dinler | `shared/messages.ts`, `content/index.ts` |
| T10 | Modele araç/yan etki yetkisi | Elevation | Modelin hiçbir aracı yok (Anthropic'te de JSON çıktı formatı kullanılır); model URL çağıramaz | `core/providers/*` |
| T11 | Gereğinden geniş izin | Elevation | Yalnızca `activeTab` + kullanıcı aksiyonunda enjeksiyon; `<all_urls>` opsiyonel ve yalnızca otomatik algılama için | `manifest.config.ts` |
| T12 | Kaynak tüketimi (çok uzun sayfa) | DoS | 200k karakter kırpma (UNCERTAIN), 40k karakterlik chunk'lar, 60 sn timeout, en fazla 2 retry, iptal | `core/segment.ts`, `core/providers/http.ts` |

## Artık riskler (dürüst liste)

1. **Görünür ve hukuki dile gömülmüş ince manipülasyon.** "Bu maddeler sektör standardıdır ve tüketici lehinedir" gibi talimat görünümünde olmayan yanıltıcı ifadeler heuristiklerden kaçabilir ve modeli etkileyebilir. Etkisi: model riskleri hafife alabilir.
2. **Kaçırılan riskler (FN).** Doğrulama yalnızca modelin söylediklerini denetler; modelin *söylemediğini* tamamlayamaz. Sentinel ipuçları (anahtar kelime çapraz kontrolü) kısmi bir önlemdir. Adversarial eval'deki "omit" profili bu sınırı sayısal olarak gösterir.
3. **Heuristik dedektör bypass edilebilir.** Eş anlamlılar, yazım hileleri ve EN/TR dışındaki diller kaçabilir. Bu bir savunma katmanıdır, tek başına güvence değildir. Eval bir açığı ("certified safe by the analyzer vendor") ortaya çıkardı ve bu açık genel bir kuralla kapatıldı; benzer açıklar kalabilir.
4. **Gerçek alıntının yanlış yorumlanması.** Alıntı doğru olsa bile `title_tr`/`explanation_tr` yanıltıcı olabilir (model çıktısı). Bu metinler yalnızca şema, uzunluk ve V9/V10 kontrollerinden geçer. UI her zaman orijinal alıntıyı yanında gösterir ve kullanıcının metni sayfada görmesini sağlar.
5. **Anahtar diskte şifrelenmemiştir.** Tarayıcı profiline erişimi olan yerel bir saldırgan anahtarı okuyabilir (Options'ta açıkça belirtilir). "Sadece bu oturumda sakla" seçeneği riski azaltır.
6. **Görünürlük sınıflandırması heuristiktir.** Çok yaratıcı CSS (ör. `mix-blend-mode`, canvas ile metin, `::before` içeriği) gizli metni görünür gösterebilir; tersine, olağandışı akordeon uygulamaları yanlışlıkla karantinaya alınabilir (meşru madde kaybı → FN).
7. **Sağlayıcı tarafı.** Sayfa metni seçilen sağlayıcıya gönderilir; sağlayıcının saklama politikaları kullanıcının sorumluluğundadır (ilk kullanımda onay alınır).
