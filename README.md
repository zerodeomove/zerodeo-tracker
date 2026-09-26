# Zerodeo — Tracker Kegiatan & Budgeting

Internal tool buat tim Zerodeo (Lenno, Ricko, Yanuar, Christina) mencatat kegiatan
dan budgeting launch, plus proses approve/reject oleh Lemon.

## Arsitektur

```
Google Sheet ("Tracker Zerodeo")
  └── Code.gs (Apps Script, HIDUP DI GOOGLE, BUKAN DI REPO INI)
        ├── setupTracker()  -> generate tab kegiatan/plafon_fixed/ringkasan
        ├── doGet()         -> expose data sebagai JSON
        └── doPost()        -> terima kegiatan baru + approve/reject

index.html   -> dashboard baca dari doGet, tampil kartu ringkas + tabel filterable
input.html   -> form tambah kegiatan baru, kirim ke doPost
```

Kedua file HTML fetch langsung ke Apps Script Web App URL yang di-hardcode
di dalam masing-masing file (cari `API_URL` / `DEFAULT_API_URL`). Tidak ada
backend lain — Google Sheet itu sendiri yang jadi database.

## File di repo ini

- `index.html` — dashboard (jadi halaman utama / root domain)
- `input.html` — form input kegiatan baru
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
3. Ganti `APPROVAL_PIN` di Code.gs dari default sebelum dipakai beneran, kabari
   PIN barunya ke Lemon lewat chat pribadi (bukan ditulis di repo/commit).
4. Kalau Code.gs diedit, WAJIB redeploy versi baru (Deploy -> Manage deployments
   -> edit -> New version) — edit di editor Apps Script saja tidak otomatis
   update URL yang sudah jadi.

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
