# Zerodeo — Tracker Kegiatan & Budgeting

Internal tool buat tim Zerodeo (Lenno, Ricko, Yanuar, Christina) mencatat kegiatan
dan budgeting launch, plus proses approve/reject oleh Lemon.

## Arsitektur

```
Google Sheet ("Tracker Zerodeo")
  └── Code.gs (Apps Script, HIDUP DI GOOGLE, BUKAN DI REPO INI)
        ├── setupTracker()  -> generate tab kegiatan/plafon_fixed/ringkasan
        ├── doGet()         -> expose data sebagai JSON
        └── doPost()        -> terima kegiatan baru + approve/reject + lengkapi (actual & foto nota)

index.html    -> dashboard baca dari doGet, tampil kartu ringkas + tabel filterable
input.html    -> form tambah kegiatan baru (termasuk Tipe Capex/Opex), kirim ke doPost
complete.html -> form lengkapi kegiatan yang sudah Ditransfer (Actual + foto nota), kirim ke doPost
```

Kedua file HTML fetch langsung ke Apps Script Web App URL yang di-hardcode
di dalam masing-masing file (cari `API_URL` / `DEFAULT_API_URL`). Tidak ada
backend lain — Google Sheet itu sendiri yang jadi database.

## File di repo ini

- `index.html` — dashboard (jadi halaman utama / root domain)
- `input.html` — form input kegiatan baru
- `complete.html` — form lengkapi kegiatan (dibuka dari tombol "Lengkapi" di
  dashboard untuk baris berstatus "Ditransfer", pakai `?row=<nomor baris>`).
  Foto nota dikompres di browser (max 1600px, JPEG) sebelum dikirim.
- `Code.gs` — **salinan referensi saja**. File asli harus di-paste manual ke
  Google Apps Script editor (Extensions -> Apps Script di Google Sheet-nya),
  bukan sesuatu yang di-deploy lewat Vercel/GitHub. Repo cuma nyimpen biar ada
  version history-nya.

## Yang HARUS dilakukan manual di luar repo (tidak bisa lewat git push)

1. Google Sheet "Tracker Zerodeo" harus sudah ada tab kegiatan/plafon_fixed/ringkasan
   (dibuat lewat menu Zerodeo Tools -> Setup/Reset Tracker setelah paste Code.gs).
2. Apps Script harus di-deploy sebagai Web App (Deploy -> Manage deployments),
   access level "Anyone with the link", supaya index.html/input.html bisa fetch
   tanpa login Google.
3. Set PIN approve/reject lewat menu Zerodeo Tools -> Ganti PIN Lemon di Google
   Sheet (PIN disimpan di Script Properties, tidak ada di kode). Sebelum PIN diset,
   approve/reject ditolak. Kabari PIN-nya ke Lemon lewat chat pribadi (bukan
   ditulis di repo/commit).
4. Kalau Code.gs diedit, WAJIB redeploy versi baru (Deploy -> Manage deployments
   -> edit -> New version) — edit di editor Apps Script saja tidak otomatis
   update URL yang sudah jadi.
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
- Hosting: Vercel, root files `index.html` dan `input.html` langsung (bukan
  React/Node — plain static HTML, tidak butuh build step)

## Status saat ini (26 Sep 2026)

Baru tahap testing internal, dipakai tim 4 orang. Belum ada data kegiatan
sungguhan, masih 1 baris contoh. Modul Marketing/Ops sengaja belum jadi
tab/halaman terpisah — sekarang cukup difilter dari tabel kegiatan yang sama
di dashboard. Dashboard khusus buat Pak Budianto (ringkas, tanpa detail
internal) belum dibuat — direncanakan terpisah nanti.
