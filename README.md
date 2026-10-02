# Zerodeo — Tracker Kegiatan & Budgeting

Internal tool buat tim Zerodeo (Lenno, Ricko, Yanuar, Christina) mencatat kegiatan
dan budgeting launch, plus proses approve/reject oleh Lemon. Ada juga modul marketing
(strategi, lane, channel, hasil event).

## Alur status kegiatan

- **Jalur Pengajuan:** Draft -> Siap Ajukan -> Diajukan -> (tombol Approve/Reject,
  pakai PIN Lemon) -> Approved -> (tombol "Tandai Ditransfer" di dashboard, isi PIC
  Transaksi + Nominal Transfer + Tgl Transfer) -> Ditransfer -> (tombol "Lengkapi"
  di dashboard, buka popup, isi Actual + foto nota) -> Selesai.
- **Jalur Fixed:** lompat approve. Begitu statusnya belum Ditransfer/Selesai, tombol
  "Tandai Ditransfer" langsung muncul di dashboard, tanpa perlu PIN.

## Arsitektur

```
Browser (halaman statis di Vercel)
  └── common.js            zApi.get() / zApi.post(), simpan kode akses tim di localStorage
        └── /api/proxy     Vercel Function (api/proxy.js)
              ├── cek kode akses tim (header x-team-code vs env TEAM_CODE)
              ├── tambahkan SHARED_SECRET (dari env) ke setiap request
              └── Apps Script Web App (URL dari env APPS_SCRIPT_URL, TIDAK ada di repo)
                    └── Google Sheet ("Tracker Zerodeo") = database

Project Apps Script (HIDUP DI GOOGLE, BUKAN DI REPO INI) berisi 2 file terpisah:
  Code.gs       setupTracker(), doGet(), doPost() — tracker kegiatan + approve/reject
  Marketing.gs  modul marketing (strategi/lane/channel/hasil_event) + cek secret
```

Halaman tidak pernah memanggil Apps Script langsung, jadi URL-nya tidak perlu (dan
tidak boleh) ditulis di repo ini karena repo ini public. Tidak ada backend lain —
Google Sheet itu sendiri yang jadi database.

## File di repo ini

Satu halaman (`index.html`) dengan tab di atas. Data tracker dan marketing ditarik
sekali lewat satu panggilan, semua form berupa popup:

- Tab **Tracker**: kartu ringkas + tabel kegiatan. Popup: Input Kegiatan (Tipe
  Capex/Opex), Tandai Ditransfer, Lengkapi (Actual + foto nota, dikompres di browser
  max 1600px JPEG sebelum dikirim).
- Tab **Marketing**, sub-tab **Strategi** dan **Hasil Event**. Popup: Strategi baru
  (lane + channel boleh lebih dari satu) dan Hasil Event (diisi H+1 sampai H+3
  setelah event).

File:
- `index.html` — kerangka halaman: tab, panel, dan semua popup
- `style.css` — satu stylesheet untuk semuanya
- `app.js` — helper bersama, tab/routing, popup, dan pemuatan data
- `tracker.js` — logika tab Tracker (kartu, tabel, approve/reject, ditransfer, input, lengkapi)
- `marketing.js` — logika tab Marketing (strategi, hasil event, popup inputnya)
- `common.js` — kode akses tim, `zApi.get/post` ke `/api/proxy`, dan `zEsc()`
  (wajib dipakai untuk semua teks dari data yang masuk ke innerHTML)
- `input.html`, `complete.html`, `marketing.html`, `strategi-input.html`,
  `hasil-event.html` — **alamat lama saja**, isinya pengalih otomatis ke `index.html`
  (misalnya `input.html` membuka popup Input Kegiatan) supaya bookmark tim tidak putus.
  Aman dihapus kalau sudah tidak ada yang memakai alamat lama.

Link langsung ke bagian tertentu: `/#tracker`, `/#strategi`, `/#event`,
`/#tambah-kegiatan`, `/#tambah-strategi`, `/#tambah-event`, `/#lengkapi=<nomor baris>`.

Vercel Function:
- `api/proxy.js` — perantara browser -> Apps Script. Tanpa package.json, tanpa build step.

Apps Script (**salinan referensi saja**, di-paste manual ke editor Apps Script, bukan
di-deploy lewat Vercel/GitHub; repo cuma nyimpen biar ada version history-nya):
- `Code.gs` — tracker kegiatan. Bergantung pada `Marketing.gs`
  (`isAuthorized_`, `mkt_getData`, `mkt_handlePost`), jadi keduanya harus ada.
- `Marketing.gs` — file TERPISAH di project Apps Script (tombol "+" di sebelah Files ->
  Script -> beri nama "Marketing"), jangan digabung ke Code.gs. Tab `strategi`, `lane`,
  `channel`, `hasil_event` dibuat otomatis saat pertama kali dipanggil.

## Environment variable Vercel

Project Settings -> Environment Variables. Nilainya diisi sendiri di dashboard Vercel,
**jangan ditulis di repo, commit, atau chat**. Setelah env diubah wajib Redeploy.

| Nama | Isi |
|---|---|
| `TEAM_CODE` | kode akses tim, minimal 8 karakter, bukan angka pendek. Dibagikan ke tim lewat chat pribadi. |
| `APPS_SCRIPT_URL` | URL web app Apps Script (berakhiran `/exec`) |
| `SHARED_SECRET` | string acak panjang, harus SAMA PERSIS dengan Script Property `SHARED_SECRET` di Apps Script |

Ganti kode akses tim: ubah `TEAM_CODE` di Vercel lalu Redeploy. Semua orang akan
diminta memasukkan kode baru saat membuka halaman berikutnya.

## Script Properties Apps Script

Project Settings -> Script Properties (nilainya tidak ditulis di file mana pun di repo):

- `SHARED_SECRET` — sama persis dengan env Vercel. **Selama belum diisi, Apps Script
  berjalan "terbuka"** (masa transisi supaya tracker tidak putus).
- `APPROVAL_PIN` — PIN approve/reject Lemon. Bisa diisi langsung di sini, atau lewat
  menu Zerodeo Tools -> Ganti PIN Lemon di Google Sheet. Sebelum PIN diset,
  approve/reject ditolak.

## Urutan rollout (jangan dibalik)

1. Paste `Code.gs` dan `Marketing.gs` ke project Apps Script, masing-masing sebagai
   file sendiri. Save.
2. Deploy -> Manage deployments -> edit -> New version. Klik Allow / Izinkan kalau
   Google minta izin (akses Drive untuk foto nota).
3. Isi env di Vercel: `TEAM_CODE`, `APPS_SCRIPT_URL`, `SHARED_SECRET`.
4. Redeploy di Vercel.
5. Tes halaman: buka situsnya, kedua tab (Tracker, Marketing) dan tiap popup.
   Tanpa kode -> halaman meminta kode akses; kode benar -> data tampil.
6. BARU SETELAH semua halaman terbukti jalan lewat proxy: isi Script Properties
   `SHARED_SECRET` (sama dengan Vercel) dan `APPROVAL_PIN` (PIN baru, jangan pakai
   PIN lama). Tes ulang. Jangan dikunci lebih awal, tracker langsung error.

Catatan: riwayat git lama masih memuat URL Apps Script dan PIN lama, karena riwayat
tidak ditulis ulang. Pengamannya adalah langkah 6: ganti PIN dan kunci dengan secret,
jadi URL lama tidak berguna tanpa secret. Jangan menunda langkah 6 terlalu lama.

## Yang HARUS dilakukan manual di luar repo (tidak bisa lewat git push)

1. Google Sheet "Tracker Zerodeo" harus sudah ada tab kegiatan/plafon_fixed/ringkasan
   (dibuat lewat menu Zerodeo Tools -> Setup/Reset Tracker setelah paste Code.gs).
2. Apps Script harus di-deploy sebagai Web App (Deploy -> Manage deployments),
   access level "Anyone with the link", supaya Vercel Function bisa memanggilnya
   tanpa login Google. Akses sebenarnya dikunci lewat `SHARED_SECRET`.
3. Set PIN approve/reject (lihat "Script Properties Apps Script" di atas). Kabari
   PIN-nya ke Lemon lewat chat pribadi (bukan ditulis di repo/commit).
4. Kalau Code.gs atau Marketing.gs diedit, WAJIB redeploy versi baru (Deploy ->
   Manage deployments -> edit -> New version) — edit di editor Apps Script saja
   tidak otomatis update URL yang sudah jadi.
5. Fitur foto nota pakai Google Drive (folder "Zerodeo - Nota Bukti", dibuat
   otomatis). Pertama kali Code.gs versi ini di-deploy, Google minta izin akses
   Drive tambahan — klik Allow / Izinkan. Foto nota di-share "anyone with the
   link" (view only).
6. Kolom tab `kegiatan` bertambah (kolom Tipe di G, kolom di kanannya geser satu),
   dan "Ditransfer ke" diganti nama jadi "PIC Transaksi". Sheet lama harus
   dijalankan ulang lewat Zerodeo Tools -> Setup / Reset Tracker (mengosongkan
   isi tab), atau kolomnya digeser manual sesuai urutan header di Code.gs.

## Deploy target

- GitHub organization: `zerodeomove`
- Hosting: Vercel. Halaman = plain static HTML/JS/CSS di root (bukan React/Node),
  ditambah satu Vercel Function di `api/proxy.js`. Tidak butuh build step.

## Status saat ini (2 Okt 2026)

Baru tahap testing internal, dipakai tim 4 orang. Belum ada data kegiatan
sungguhan, masih 1 baris contoh. Modul Marketing sekarang jadi tab di halaman utama
(strategi, lane, channel, hasil event); Ops sengaja belum jadi tab/halaman
terpisah — sekarang cukup difilter dari tabel kegiatan yang sama di dashboard.
Dashboard khusus buat Pak Budianto (ringkas, tanpa detail internal) belum dibuat —
direncanakan terpisah nanti.
