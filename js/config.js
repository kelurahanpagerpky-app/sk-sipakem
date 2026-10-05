/**
 * KONFIGURASI SIPAKEM — Kelurahan Pager
 * Isi API_URL dengan URL Web App Google Apps Script (berakhiran /exec).
 * File ini boleh di-commit ke GitHub: URL saja tidak cukup untuk membaca data,
 * karena semua aksi data wajib login.
 */
window.SIPAKEM_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbx-LG65PcqZT87QMLm5cCIQTLckKlG2PuonHFfbNdpg5QYcpXlREk5zW-sgE4Zp4L1iwA/exec",          // contoh: "https://script.google.com/macros/s/AKfycb.../exec"
  PUBLIC_URL: "",       // opsional: alamat situs GitHub Pages, mis. "https://username.github.io/sipakem-pager/"
                        // dipakai pada QR verifikasi. Kosong = otomatis dari alamat halaman.
  APP_NAME: "SIPAKEM Kelurahan Pager"
};
