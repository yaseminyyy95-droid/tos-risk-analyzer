# Değerlendirme Raporu (Eval)

> **Gold etiketler LLM destekli taslaktır; insan incelemesinden geçmeden kesin metrik değildir (annotation bias riski).** Tek annotator, küçük n; sitelerin metni zamanla değişebilir; model çıktıları deterministik değildir.

- Çalışma: `eval\runs\_last` — sağlayıcı/model: anthropic/claude-sonnet-5-5, prompt 2026-11-v1, tekrar: 1
- Etiket: Gerçek sağlayıcı çalışması

## Doküman bazında

| Doküman | Gold | Önerilen | Doğrulanan | Reddedilen | TP | FP | FN | Precision | Recall | F1 | Skor | Durum |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| netflix-tou | 10 | 10 | 10 | 0 | 7 | 3 | 3 | 70.0% | 70.0% | 70.0% | 68 | Doğrulandı |
| reddit-ua | 10 | 16 | 14 | 0 | 6 | 8 | 4 | 42.9% | 60.0% | 50.0% | 67 | Doğrulandı |
| spotify-tou | 11 | 21 | 21 | 0 | 9 | 12 | 2 | 42.9% | 81.8% | 56.3% | 92 | Doğrulandı |
| synthetic-acme-cloud-tos | 9 | 11 | 11 | 0 | 8 | 3 | 1 | 72.7% | 88.9% | 80.0% | 90 | Doğrulandı |
| synthetic-brightstream-subscription | 8 | 9 | 9 | 0 | 7 | 2 | 1 | 77.8% | 87.5% | 82.4% | 78 | Doğrulandı |
| synthetic-nimbus-health-privacy | 6 | 5 | 5 | 0 | 5 | 0 | 1 | 100.0% | 83.3% | 90.9% | 75 | Doğrulandı |
| tiktok-tos-us | 12 | 16 | 16 | 0 | 8 | 8 | 4 | 50.0% | 66.7% | 57.1% | 86 | Doğrulandı |
| zoom-tos | 10 | 29 | 29 | 0 | 9 | 20 | 1 | 31.0% | 90.0% | 46.2% | 96 | Doğrulandı |

## Toplam

| Metrik | Değer |
|---|---|
| Micro Precision / Recall / F1 | 51.3% / 77.6% / 61.8% |
| Macro Precision / Recall / F1 | 60.9% / 78.5% / 66.6% |
| Adjudication sonrası precision (valid_unannotated sayılır) | 87.0% |
| Doğrulama öncesi halüsinasyon oranı (reddedilen / önerilen) | 0.0% |
| Doğrulama sonrası grounding (invariant testi) | ✓ 115 doğrulanmış alıntının 0 tanesi metinde yok |
| Severity uyumu (TP'lerde) | 74.6% |
| Durum dağılımı | Doğrulandı: 8 |
| Süre / token (girdi, çıktı) | 200.3 sn / 150799, 29873 |

### Kategori bazında recall

| Kategori | Recall |
|---|---|
| arbitration_class_waiver | 100.0% |
| cancellation_refund | 100.0% |
| auto_renewal | 60.0% |
| other | 80.0% |
| price_change | 75.0% |
| liability_limitation | 100.0% |
| unilateral_changes | 60.0% |
| content_license_ip | 75.0% |
| jurisdiction_governing_law | 66.7% |
| account_termination | 62.5% |
| ai_training_use | 100.0% |
| data_sale_or_sharing | 66.7% |
| tracking_profiling | 100.0% |
| sensitive_biometric_data | 66.7% |
| data_retention | 50.0% |

### Kaçırılan gold maddeleri (FN)

- netflix-tou G7 (unilateral_changes): "Bu Kullanım Koşullarını zaman zaman değiştirebiliriz"
- netflix-tou G8 (content_license_ip): "herhangi bir amaçla dünya çapında ve süresiz olarak kullanmakta serbesttir"
- netflix-tou G9 (jurisdiction_governing_law): "Bu Kullanım Koşulları, Hollanda kanunlarına tabidir"
- reddit-ua G3 (data_sale_or_sharing): "make Your Content available for syndication, broadcast, distribution, or publication by other companies, organizations, or individuals who partner with Reddit"
- reddit-ua G6 (unilateral_changes): "If the changes, in our sole discretion, are material, we may also notify you"
- reddit-ua G8 (account_termination): "delete, deem your content ineligible for monetization, or remove Your Content, at any time and for any reason"
- reddit-ua G10 (content_license_ip): "you irrevocably waive any claims and assertions of moral rights or attribution with respect to Your Content"
- spotify-tou G6 (account_termination): "suspend your access to the Spotify Service at any time if we believe you have breached any of these Terms"
- spotify-tou G11 (unilateral_changes): "we may modify, suspend, or stop (permanently or temporarily) providing all or part of the Spotify Service"
- synthetic-acme-cloud-tos G3 (auto_renewal): "Your subscription will automatically renew at the end of each billing period"
- synthetic-brightstream-subscription G1 (auto_renewal): "Your BrightStream subscription renews automatically every month"
- synthetic-nimbus-health-privacy G6 (sensitive_biometric_data): "menstrual cycle information and blood oxygen levels"
- tiktok-tos-us G6 (data_retention): "Your Content will remain publicly accessible on the Platform if it has been incorporated into content posted by other users"
- tiktok-tos-us G8 (account_termination): "We may remove or restrict access to any content, including yours, whether publicly or privately posted, for any reason"
- tiktok-tos-us G9 (unilateral_changes): "Where we need to make urgent changes, for example, for security, safety, legal or regulatory reasons, we may not be able to provide you with advance notice"
- tiktok-tos-us G11 (other): "YOU MUST INITIATE ANY PROCEEDING OR ACTION WITHIN ONE (1) YEAR OF THE DATE OF THE OCCURRENCE"
- zoom-tos G5 (price_change): "Zoom may change prices for the Services at any time, in its sole discretion"

### FP adjudication

Her FP `eval/results/adjudication.csv` dosyasına `unclear` olarak yazılır; `true_fp` / `valid_unannotated` olarak işaretleyip `eval:score`'u tekrar çalıştırın (işaretler korunur).

