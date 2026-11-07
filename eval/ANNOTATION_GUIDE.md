# Annotasyon Rehberi (Gold etiketler)

Bu rehber, `eval/gold/<docId>.json` dosyalarındaki "riskli madde" etiketlerinin nasıl üretileceğini ve inceleneceğini tanımlar. Kategori tanımları ve severity rubriği, modele verilen prompt (`src/core/prompt.ts`) ile **aynıdır**. Böylece model ve annotator aynı ölçütle değerlendirilir.

## Ne "riskli madde" sayılır?

Bireysel bir tüketici için **önemli ölçüde aleyhe** veya **olağandışı** olan hükümler. Nötr kalıp metinler (başlıklar, iletişim bilgileri, tanımlar, "yasaya uyun" gibi genel yükümlülükler) etiketlenmez.

| Kategori | Ne zaman |
|---|---|
| `data_sale_or_sharing` | Kişisel verilerin satışı veya reklam/veri ortaklarıyla, sigorta/işverenlerle geniş paylaşımı. Yalnızca hizmet sağlayıcı (işleyen) paylaşımı **etiketlenmez**. |
| `tracking_profiling` | Davranış takibi, ilgi alanı/ruh hali profili çıkarma, siteler arası hedefli reklam. |
| `data_retention` | Süresiz/belirsiz saklama; silindikten sonra da kalan veriler. Kısa ve tanımlı yedek süreleri (ör. 30 gün) etiketlenmez. |
| `ai_training_use` | Kullanıcı içeriğinin veya verisinin yapay zekâ/model eğitiminde kullanılması. |
| `sensitive_biometric_data` | Yüz/ses izi, sağlık verisi (adet döngüsü, kalp ritmi vb.) toplanması. |
| `children_data` | Çocuk verilerinin toplanması/işlenmesi (yaş sınırı ilanı tek başına etiketlenmez). |
| `auto_renewal` | Otomatik yenileme, deneme süresinin otomatik ücretliye dönmesi. |
| `cancellation_refund` | İade yok, iptalin zorlaştırılması (yalnızca destek üzerinden iptal vb.). |
| `price_change` | Tek taraflı fiyat değişikliği. |
| `unilateral_changes` | Şartların haber vermeden/bireysel bildirim olmadan değiştirilmesi. |
| `arbitration_class_waiver` | Zorunlu tahkim, jüri/toplu dava feragati. |
| `liability_limitation` | Sorumluluğun çok düşük bir tutarla sınırlanması veya geniş feragat. Standart "as is" garantisi reddi tek başına **medium** üstü değildir. |
| `content_license_ip` | Kullanıcı içeriği üzerinde süresiz/geri alınamaz/alt lisanslanabilir geniş lisans. |
| `account_termination` | Hesabın gerekçesiz/"herhangi bir sebeple" kapatılabilmesi. |
| `jurisdiction_governing_law` | Tüketiciye uzak yargı yeri, yalnızca tahkimle birlikte değilse ayrı madde. |
| `manipulative_content` | Metne gömülü, yapay zekâya yönelik talimatlar (gold'da genellikle yoktur; adversarial testte ölçülür). |
| `other` | Yukarıdakilere uymayan ama önemli hükümler (az kullanın). |

## Severity rubriği (prompt ile aynı)

- **critical**: temel hakların feragati veya kişisel verilerin geniş satışı/paylaşımı (zorunlu tahkim + toplu dava feragati, veri satışı, açık rıza olmadan biyometrik veri).
- **high**: önemli mali/gizlilik etkisi (iptali zor otomatik yenileme, iade yok, süresiz geniş içerik lisansı, kullanıcı içeriğiyle yapay zekâ eğitimi).
- **medium**: kayda değer ama yaygın (bildirimli tek taraflı değişiklik, geniş sorumluluk sınırı).
- **low**: küçük veya hafifletilmiş.

## Kurallar

1. **anchorQuote**: maddenin özünü taşıyan, metinden **birebir** kısa alıntı (≥ 25 karakter, ≥ 5 kelime). `npm run eval:validate-gold` her anchorQuote'un kanonik metinde geçtiğini doğrular.
2. **Birleştirme**: aynı maddenin alt fıkraları (ör. tahkim + toplu dava feragati aynı cümlede) **tek** gold item'dır. Farklı paragraflarda ayrı riskler (ör. otomatik yenileme ve "iptal yalnızca destekten") ayrı item'dır.
3. **acceptableCategories**: makul biçimde iki kategoriye girebilecek maddelerde ikisini de listeleyin (ör. tahkim maddesi için `jurisdiction_governing_law`). Ana kategori her zaman listede olmalı.
4. Doküman başına **6–15** madde; en önemlileri önce.
5. **Sınır vakaları**: (a) "Yasanın gerektirdiği durumlar hariç" ifadesi riski ortadan kaldırmaz, severity'yi düşürmez. (b) Opt-out hakkı tanınan tahkim yine **critical**'dır (varsayılan zorunlu). (c) "Bildirimle" yapılan değişiklik **medium**, "bildirimsiz" **medium–high**. (d) Kapalı akordeon içindeki maddeler de etiketlenir.

## İnceleme kontrol listesi (draft → reviewed)

- [ ] Her item gerçekten tüketici aleyhine mi? (nötr kalıp metin yok)
- [ ] Kaçırılan önemli madde var mı? (metni baştan sona okuyun; akordeonları açın)
- [ ] Severity rubriğe uygun mu?
- [ ] acceptableCategories gereksiz geniş mi? (eşleşmeyi yapay kolaylaştırmamalı)
- [ ] `npm run eval:validate-gold` yeşil mi?
- [ ] `annotator` alanına adınızı yazıp `annotationStatus: "reviewed"` yapın.
- [ ] `eval/results/adjudication.csv` içindeki FP'leri `true_fp` / `valid_unannotated` olarak işaretleyin; `valid_unannotated` olanları gold'a eklemeyi düşünün.
