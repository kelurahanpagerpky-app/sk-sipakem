# SIPAKEM — SK Digital Kelurahan Pager

Sistem Penyusunan & Arsip Keputusan Elektronik untuk **Kelurahan Pager, Kecamatan Rakumpit, Kota Palangka Raya**.

- **Front-end**: HTML/CSS/JS statis, di-hosting gratis di **GitHub Pages**.
- **Database**: **Google Spreadsheet**, diakses lewat **Google Apps Script** (Web App JSON).
- Fitur: login & peran (Admin/Staf), kop surat & template SK, editor SK + pratinjau F4, tanda tangan elektronik (gambar), penerbitan PDF dengan kode verifikasi + QR, riwayat/arsip SK, halaman **verifikasi publik** (`verifikasi.html`), log aktivitas.

```
index.html          aplikasi utama
verifikasi.html     halaman verifikasi keaslian SK (publik, dibuka dari QR)
css/  js/  assets/  tampilan, logika, logo
js/config.js        <-- isi API_URL di sini
apps-script/        Code.gs + appsscript.json (disalin ke Google Apps Script)
.github/workflows/  deploy otomatis ke GitHub Pages
```

## A. Pasang backend (Google Spreadsheet + Apps Script)

1. Buat **Google Spreadsheet** baru (mis. `DB SIPAKEM Kelurahan Pager`).
2. Menu **Extensions → Apps Script**. Hapus isi default, tempel seluruh isi `apps-script/Code.gs`.
3. (Opsional) Project Settings → centang *Show appsscript.json*, lalu samakan dengan `apps-script/appsscript.json` (zona waktu Asia/Pontianak).
4. Pilih fungsi **`setup`** → **Run**. Setujui izin akses. Fungsi ini membuat sheet `Pengguna, Kop, Template, SK, Aset, Log`, mengisi kop Kelurahan Pager dan 5 template SK, serta membuat akun `admin`.
5. Buka **View → Logs / Execution log**: salin **kata sandi awal admin**. (Wajib diganti saat login pertama.)
6. **Deploy → New deployment → Web app**: *Execute as*: **Me**, *Who has access*: **Anyone** → Deploy. Salin URL yang berakhiran **`/exec`**.

> Setiap mengubah `Code.gs`, buat **New version** pada Deploy → Manage deployments agar perubahan berlaku (URL tetap sama).
> Lupa sandi admin? Jalankan fungsi `resetAdminPassword` dari editor, lihat sandi baru di Execution log.

## B. Hubungkan front-end

Edit `js/config.js`:

```js
API_URL: "https://script.google.com/macros/s/XXXXXXXX/exec",
PUBLIC_URL: "https://USERNAME.github.io/NAMA-REPO/",   // alamat GitHub Pages (untuk QR verifikasi)
```

## C. Hosting di GitHub Pages

1. Buat repository baru di GitHub (mis. `sipakem-pager`), unggah seluruh isi folder ini (branch `main`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Setiap `push` ke `main`, workflow `pages.yml` men-deploy situs ke `https://USERNAME.github.io/sipakem-pager/`.
   (Folder `apps-script/` tidak ikut dipublikasikan.)

## D. Mengaktifkan TTE BSrE (opsional, sertifikat elektronik BSSN)

Tanpa langkah ini aplikasi memakai **TTE internal** (jejak audit, bukan tanda tangan tersertifikasi). Dengan BSrE aktif, PDF ditandatangani lewat **Esign Client Service BSrE** menggunakan sertifikat milik penandatangan (Lurah).

**Prasyarat (diurus instansi ke BSrE/Diskominfo):** akun & sertifikat elektronik penandatangan sudah aktif, serta tersedia **server Esign Client Service** beserta username/password API-nya.

1. Di Apps Script: **Project Settings → Script properties → Add**:
   - `BSRE_BASE_URL` = alamat server Esign, **wajib `https://`** (mis. `https://esign.instansi.go.id`)
   - `BSRE_USER` dan `BSRE_PASS` = kredensial Basic Auth API Esign
   - Opsional bila juknis server Anda berbeda: `BSRE_SIGN_PATH` (default `/api/sign/pdf`), `BSRE_VERIFY_PATH` (`/api/sign/verify`), `BSRE_STATUS_PATH` (`/api/user/status/{nik}`), `BSRE_DOWNLOAD_PATH` (`/api/sign/download/{id}`)
   - Opsional tanda tangan tampak (QR BSrE): `BSRE_VISIBLE=1`, `BSRE_PAGE`, `BSRE_X`, `BSRE_Y`, `BSRE_W`, `BSRE_H`, `PUBLIC_URL`
2. Jalankan fungsi `bsreSelfTest` dari editor untuk menguji apakah server Esign terjangkau dari Google. Deploy ulang Web App (**New version**).
3. Menu **Tanda Tangan Elektronik** akan menampilkan status *Aktif*. Saat menerbitkan SK, aplikasi meminta **NIK + passphrase** penandatangan. Keduanya hanya dikirim sekali, **tidak disimpan dan tidak dicatat di log**.

Alur: SK diterbitkan (kode verifikasi dibuat) → PDF dibuat di browser → dikirim ke BSrE lewat Apps Script → PDF bertanda tangan langsung diunduh. Jika penandatanganan gagal (passphrase salah, server mati), SK berstatus **Menunggu TTE BSrE** dan bisa ditandatangani ulang dari Riwayat. PDF final dapat diunduh lagi dari BSrE, dan menu TTE menyediakan pemeriksaan keabsahan PDF.

**Perhatian:**
- Server Esign **harus dapat dijangkau dari internet (HTTPS, sertifikat SSL valid)**. Apps Script berjalan dari IP Google, jadi server yang hanya di jaringan internal atau membatasi IP tidak akan terjangkau. Jika begitu, konsultasikan dengan Diskominfo/BSrE.
- Passphrase yang salah berulang kali dapat memblokir akun TTE.
- Jalur API dan nama field di atas berdasar pola umum Esign Client Service. **Cocokkan dengan juknis/Postman collection dari BSrE untuk server Anda** sebelum dipakai resmi, dan uji dengan dokumen percobaan.

## Keamanan & penanganan error

- Semua aksi data wajib **token sesi** (berlaku 6 jam, bergulir); sesi dicabut jika kata sandi diubah/direset.
- Kata sandi disimpan sebagai **hash + salt** (bukan teks asli); login dikunci 10 menit setelah 5 kali gagal.
- Peran: **Admin** (kop, template, pengguna, hapus SK terbit) dan **Staf** (buat SK, TTE, hapus draf sendiri).
- **LockService** mencegah tabrakan saat banyak orang menyimpan bersamaan; semua input divalidasi (panjang, format, ukuran gambar).
- SK yang sudah terbit **tidak bisa diubah** (hanya disalin); nomor ganda diperingatkan; kop yang dipakai SK tidak bisa dihapus.
- Error server dikembalikan terstruktur `{ok:false, code, error}` dengan kode referensi; kesalahan tak terduga dicatat di sheet `Log`. Front-end menampilkan pesan ramah untuk offline, timeout, sesi habis, dan server sibuk.
- Halaman verifikasi hanya menampilkan data ringkas (nomor, judul, penandatangan, tanggal), bukan isi SK.

## Catatan penting

- URL Web App bersifat publik, tetapi tanpa login tidak ada data yang bisa dibaca (kecuali verifikasi ringkas lewat kode 10 karakter).
- Jangan bagikan spreadsheet database ke banyak orang: sheet `Pengguna` berisi hash kata sandi. Batasi akses hanya untuk admin.
- Kuota Google Apps Script gratis cukup untuk penggunaan kelurahan; tiap aksi membutuhkan beberapa detik.
- Tanpa BSrE aktif (bagian D), tanda tangan & kode verifikasi di PDF hanyalah **jejak audit internal**, bukan tanda tangan elektronik tersertifikasi.
- Data awal (kop, template) dapat diubah di `seedKop_()` dan `seedTemplates_()` pada `Code.gs` **sebelum** menjalankan `setup`, atau lewat menu *Kelola Kop* / *Kelola Template* setelahnya. Nama dan NIP Lurah belum diisi: lengkapi di menu **Kelola Kop Surat**.
