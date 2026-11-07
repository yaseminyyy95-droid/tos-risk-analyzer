# Mimari

## Katmanlar

| Katman | Sorumluluk | chrome.* kullanır mı? |
|---|---|---|
| `src/core/` | Şema, normalizasyon, segmentasyon, sanitize, injection heuristikleri, prompt, doğrulama (V0–V12), skor, sentinel, durum, pipeline, sağlayıcılar | **Hayır.** Uzantıda, Vitest'te, E2E harness'ında ve eval CLI'da aynı kod çalışır |
| `src/content/` | DOM → `ExtractedDocument` (extractor + visibility + detector), vurgulama. `handler.ts` belgeyi parametre olarak alır (harness iframe belgesiyle çağırır) | Yalnızca `index.ts` (mesaj dinleyici) |
| `src/background/` | `orchestrator.ts`: tek ayrıcalıklı bileşen; `chrome` API'sini parametre olarak alır (gerçek uzantıda `chrome`, harness'ta shim). Keystore, cache, ayarlar | Evet |
| `src/ui/` | Preact side panel, popup, options; rapor bileşenleri; export | Evet (prop olarak alınabilir) |
| `src/shared/` | Zod ile doğrulanan mesaj protokolü | Hayır |

## Uçtan uca hat (`analyzeDocument`)

1. `sanitizeBlocks`: görünmez ve kontrol karakterleri silinir, ayraç ve rol taklitleri etkisizleştirilir. **Kanonik metin, sanitize edilmiş metindir**; doğrulama LLM'in gördüğü metnin ta kendisi üzerinde yapılır.
2. `segmentBlocks`: `[S001]`… segmentleri (400–1200 karakter, paragraf bütünlüğü korunur). Injection şüpheli bloklar tek başına segment olur.
3. `scanSegments`: heuristik injection taraması → işaretli segmentler.
4. `chunkSegments`: 40k karakterlik chunk'lar, segment sınırında kesilir; önceki başlık yolu bağlam olarak eklenir.
5. Her chunk için: yeni nonce ve canary → `provider.complete` → `parseLLMOutput` (V0–V2, 1 onarım denemesi) → `verifyReport` (V3–V11).
6. Birleştirme (V8, chunk'lar arası), deterministik skor, sentinel, `decideStatus`.
7. Ayrı bir LLM "reduce" çağrısı **yapılmaz**. Birden çok chunk varsa özetler birleştirilip 700 karakterde kırpılır.

## Mesaj protokolü

- **Side panel ⇄ SW**: `chrome.runtime.connect({name: "analysis"})` portu.
  - Panel → SW: `ANALYZE_TAB`, `ANALYZE_SELECTION`, `HIGHLIGHT_QUOTE`, `CANCEL`, `GET_STATE`, `GRANT_CONSENT` (`PanelToSwSchema` ile doğrulanır).
  - SW → panel: `PROGRESS`, `REPORT`, `ERROR`, `NEEDS_CONSENT`, `STATE`, `HIGHLIGHT_RESULT`.
- **SW → content script**: `executeScript(content.js)` + `tabs.sendMessage`: `CONTENT_EXTRACT`, `CONTENT_EXTRACT_SELECTION`, `HIGHLIGHT_QUOTE`. Yanıtlar (`EXTRACT_RESULT`, `HIGHLIGHT_RESULT`, `ERROR`) **güvenilmez** kabul edilir ve `ContentResponseSchema` ile (boyut sınırlarıyla) doğrulanır.
- **Popup/Options → SW** (`runtime.sendMessage`): `SET_KEY`, `DELETE_KEY`, `TEST_KEY`, `KEY_STATUS`, `CLEAR_CACHE`, `OPEN_PANEL_AND_ANALYZE`. Yalnızca uzantı sayfalarından kabul edilir (sender doğrulaması); anahtar SW dışına yalnızca maskeli çıkar.
- **Content → SW**: `LEGAL_PAGE_DETECTED` (yalnızca rozet).

## MV3 service worker yaşam döngüsü

- Uzun LLM çağrısı boyunca açık port ve devam eden `fetch`, SW'yi canlı tutar.
- İş durumu `chrome.storage.session` (`jobs`) içine yazılır. SW yeniden başlarsa kayıtta "running" olan ama bellekte aktif iş bulunmayan sekme için `GET_STATE` → `interrupted` döner ve panel "Analiz yarıda kaldı, tekrar dene" gösterir.
- Panel kapanınca (port bağlantısı kopunca) devam eden işler `AbortController` ile iptal edilir.
- `sidePanel.open` kullanıcı jestine bağlıdır. Popup ve bağlam menüsü önce paneli açar, bekleyen işi `pendingActions` içine yazar; panel `GET_STATE` ile işi alıp başlatır.
- Content script statik kayıtlı değildir (`activeTab` + `executeScript`). Otomatik algılama açık ve `<all_urls>` izni verilmişse `registerContentScripts` ile dinamik kaydedilir, izin kaldırılınca kayıt silinir.

## Build

- `vite build` (crxjs) popup, side panel, options ve SW'yi üretir. `vite build --config vite.content.config.ts` content script'i **tek dosya IIFE** (`dist/content.js`) olarak üretir, çünkü `executeScript({files})` klasik script bekler.
- `vite.harness.config.ts`, E2E harness'ını `dist-harness/` altına derler (`fixtures/` public olarak sunulur).

## E2E harness gerekçesi

Test araçları `chrome-extension://` sayfalarını ve side panel'i doğrudan sürmeyi desteklemez. Harness aynı origin'de iframe (fixture sayfası) ile gerçek side panel uygulamasını yan yana koyar. `chrome-shim.ts`, port, storage, tabs ve scripting API'lerini süreç içinde taklit eder. Böylece gerçek orkestratör, gerçek extractor (iframe DOM'u), gerçek pipeline ve gerçek `OpenAIProvider` çalışır; yalnızca ağ çağrısı stub'lanır. Uzantının gerçekten yüklendiği ayrıca `npm run smoke` ile doğrulanır.
