# Kararlar (DECISIONS)

Her satır: belirsiz bir noktada seçilen makul varsayım.

- Build: Vite 6 + @crxjs/vite-plugin 2.x kullanıldı (fallback gerekmedi).
- Content script ayrı bir Vite lib build'iyle tek dosya IIFE (`dist/content.js`) olarak üretilir; `chrome.scripting.executeScript({files})` klasik script beklediği için ES module chunk kullanılamaz.
- ESLint 9 flat config (`eslint.config.js`) kullanıldı; `.eslintrc.cjs` ESLint 9'da varsayılan değil.
- **Cypress yerine Playwright**: Kullanıcı Cypress'i ve ağ/ortam değişikliğini reddetti (Cypress binary'si download.cypress.io'dan iner, bu ortamda erişilemez). E2E + demo videosu, sistemde önceden kurulu Playwright (global, `/opt/node22/lib/node_modules/playwright`) ve Chromium ile düz Node betiği olarak yazıldı; `@playwright/test` eklenmedi. Video Playwright `recordVideo` (webm) ile kaydedilir, sistem `ffmpeg` ile mp4'e çevrilir, `ffprobe` ile süresi ölçülür (ffprobe-static yerine sistem ffprobe).
- `data-cy` öznitelikleri prompt'taki adlarla korundu (test aracı değişse de seçiciler aynı).
- Fixture'lar `cypress/fixtures` yerine `fixtures/` altında tutulur (Cypress yok).
- Eval korpusu: bu oturumun ağ politikası şirket sitelerine erişime izin vermiyor ve kullanıcı ağ erişimi eklenmesini istemedi. `corpus.manifest.json` 5 gerçek ToS kaydını (URL + şirket) içerir ama `sha256/retrievedAt` null kalır; `eval:fetch` kullanıcının kendi makinesinde çalıştırılmak üzere yazıldı (ağ veya `--from-raw`). Anahtarsız eval, açıkça sentetik etiketli kurgusal dokümanlarla çalışır.
- Gold etiketler yalnızca sentetik dokümanlar için üretildi; gerçek dokümanlar çekilmeden gerçek gold üretilemez (uydurma alıntı olur).
- Önbellek anahtarı model+provider+promptVersion+canonicalText SHA-256'sıdır; canonicalText extractor çıktısının sanitize edilmiş halidir.
