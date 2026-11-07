export const RISK_CATEGORIES = [
  "data_sale_or_sharing", // verilerin satışı / üçüncü taraflarla paylaşımı
  "tracking_profiling", // takip, profilleme, hedefli reklam
  "data_retention", // süresiz/belirsiz saklama
  "ai_training_use", // içeriğin/verinin yapay zeka eğitiminde kullanımı
  "sensitive_biometric_data", // biyometrik/hassas veri
  "children_data",
  "auto_renewal", // otomatik yenileme
  "cancellation_refund", // iptal güçlüğü, iade yok
  "price_change", // tek taraflı fiyat değişikliği
  "unilateral_changes", // şartları haber vermeden değiştirme
  "arbitration_class_waiver", // zorunlu tahkim, toplu dava feragati
  "liability_limitation", // sorumluluk sınırlama / feragat
  "content_license_ip", // kullanıcı içeriği üzerinde geniş lisans
  "account_termination", // hesabı tek taraflı kapatma
  "jurisdiction_governing_law",
  "manipulative_content", // metne gömülü AI-yönelimli talimat vb.
  "other",
] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const CATEGORY_INFO: Record<RiskCategory, { label_tr: string; description_tr: string }> = {
  data_sale_or_sharing: {
    label_tr: "Veri satışı / paylaşımı",
    description_tr: "Kişisel verilerinizin satılması veya üçüncü taraflarla geniş biçimde paylaşılması.",
  },
  tracking_profiling: {
    label_tr: "Takip ve profilleme",
    description_tr: "Davranışlarınızın izlenmesi, profil çıkarılması veya hedefli reklam için kullanılması.",
  },
  data_retention: {
    label_tr: "Veri saklama süresi",
    description_tr: "Verilerin süresiz veya belirsiz bir süre boyunca saklanması.",
  },
  ai_training_use: {
    label_tr: "Yapay zekâ eğitimi",
    description_tr: "İçeriğinizin veya verilerinizin yapay zekâ modellerini eğitmek için kullanılması.",
  },
  sensitive_biometric_data: {
    label_tr: "Hassas / biyometrik veri",
    description_tr: "Yüz, ses, parmak izi gibi biyometrik ya da hassas verilerin toplanması.",
  },
  children_data: {
    label_tr: "Çocukların verileri",
    description_tr: "Çocuklara ait verilerin toplanması veya işlenmesiyle ilgili hükümler.",
  },
  auto_renewal: {
    label_tr: "Otomatik yenileme",
    description_tr: "Aboneliğin siz iptal etmedikçe otomatik olarak yenilenip ücretlendirilmesi.",
  },
  cancellation_refund: {
    label_tr: "İptal ve iade",
    description_tr: "İptalin zorlaştırılması veya ödemelerin iade edilmemesi.",
  },
  price_change: {
    label_tr: "Fiyat değişikliği",
    description_tr: "Şirketin fiyatları tek taraflı olarak değiştirebilmesi.",
  },
  unilateral_changes: {
    label_tr: "Tek taraflı değişiklik",
    description_tr: "Şartların size haber verilmeden veya onayınız olmadan değiştirilebilmesi.",
  },
  arbitration_class_waiver: {
    label_tr: "Zorunlu tahkim / toplu dava feragati",
    description_tr: "Uyuşmazlıkların mahkeme yerine tahkimde çözülmesi ve toplu dava hakkından vazgeçilmesi.",
  },
  liability_limitation: {
    label_tr: "Sorumluluk sınırlaması",
    description_tr: "Şirketin zararlardan sorumluluğunu büyük ölçüde sınırlaması veya reddetmesi.",
  },
  content_license_ip: {
    label_tr: "İçerik lisansı",
    description_tr: "Yüklediğiniz içerik üzerinde şirkete geniş, süresiz veya geri alınamaz lisans verilmesi.",
  },
  account_termination: {
    label_tr: "Hesap kapatma",
    description_tr: "Şirketin hesabınızı gerekçesiz veya tek taraflı olarak kapatabilmesi.",
  },
  jurisdiction_governing_law: {
    label_tr: "Yetkili mahkeme / uygulanacak hukuk",
    description_tr: "Uyuşmazlıklarda size uzak bir ülkenin hukukunun veya mahkemesinin yetkili olması.",
  },
  manipulative_content: {
    label_tr: "Manipülatif içerik",
    description_tr: "Metne gömülmüş, yapay zekâ analizini yönlendirmeye çalışan talimatlar.",
  },
  other: {
    label_tr: "Diğer",
    description_tr: "Yukarıdaki kategorilere uymayan ama tüketici için önemli olabilecek hükümler.",
  },
};

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
export const SEVERITY_TR: Record<Severity, string> = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};
