// Cypress destek dosyası. Harness'ta beklenmeyen bir JS hatası testi düşürür (Playwright'taki "sayfada JS hatası yok" kontrolünün karşılığı).
Cypress.on("uncaught:exception", () => true);
export {};
