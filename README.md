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
- **Data lama** (kegiatan yang sudah selesai sebelum dashboard dipakai): di popup
  "Kebutuhan baru" centang **Data lama**. Yang wajib hanya Actual; Nominal transfer,
  PIC Transaksi, Tanggal (kapan dibayar), dan link nota opsional (kosong = Nominal sama
  dengan Actual, PIC Transaksi sama dengan PIC). Langsung tersimpan berstatus **Selesai**,
  dengan catatan "Data lama" di kolom Catatan. Opsi ini hanya muncul kalau Apps Script
  sudah versi terbaru.
- **Urgent:** kartu **Perlu Ditransfer** di atas tabel menghitung kegiatan berstatus
  Approved yang belum ditransfer. Kartu menyala kuning kalau ada isinya; diklik, muncul
  daftarnya (urut deadline) dengan tombol Tandai Ditransfer di tiap baris.

## Dana (transfer bulk)

Untuk kasus satu transfer besar yang dipakai membayar banyak kebutuhan (misalnya modal
Rp11.280.000 yang dibelanjakan satu-satu, ada yang lebih murah atau lebih mahal dari
rencana):

1. Catat transfernya sekali lewat **+ Dana** (nama, nominal, tanggal, PIC penerima).
2. Di popup **Kebutuhan baru** pilih **Dibayar dari dana**. Kebutuhan itu tidak perlu
   approve/transfer sendiri (uangnya sudah ada), jadi langsung berstatus **Ditransfer**
   dengan jalur **Dana**, tinggal **Lengkapi** dengan Actual dan nota. Kebutuhan dari dana
   tidak punya Nominal Transfer sendiri supaya tidak terhitung dua kali.
3. Kartu dana menampilkan: dana, **terpakai** (total Actual kebutuhan tertaut), **saldo**
   (dana dikurangi terpakai), serta **rencana belum jalan** (estimasi kebutuhan yang belum
   selesai) dan **sisa bebas** (saldo dikurangi rencana). Pengeluaran yang lebih mahal atau
   tak terduga otomatis mengurangi saldo; kalau melebihi dana, tampil **Kelebihan** merah.
   Klik kartu dana untuk menyaring tabel ke kebutuhan dari dana itu.
4. Kartu **Sudah Cair, Belum Ada Nota** ikut menghitung saldo dana.

Data lama juga bisa ditautkan ke dana: centang **Data lama** lalu pilih dananya. Isian
**Tanggal** di mode Data lama menjadi Tanggal Dicatat di Sheet.

Di Sheet: tab **`dana`** (satu baris per transfer, kolom Terpakai dan Saldo berformula) dan
kolom **Dana** (S) di tab `kegiatan`, dibuat otomatis. Nama dana harus unik; jangan ubah
nama di tab `dana` kalau sudah ada kebutuhan yang tertaut (tautannya memakai nama).
Catatan: tab `ringkasan` belum menghitung dana.

## Kategori

Daftar kategori disimpan di tab **`kategori`** di Sheet (dibuat otomatis, isi awal 6
kategori bawaan). Di popup "Kebutuhan baru" pilih dari daftar, atau tulis kategori
baru di kolom di bawahnya. Kategori baru otomatis masuk ke tab `kategori` dan ke
dropdown di tab `kegiatan`; huruf besar/kecil dan spasi berlebih disamakan. Bisa juga
ditambah/diubah langsung di tab `kategori`. Setup / Reset Tracker tidak menghapus tab ini.
Catatan: tab `plafon_fixed` dan scorecard Marketing/Ops di tab `ringkasan` masih memakai
6 kategori bawaan, jadi kategori tambahan belum masuk ke dua tempat itu.

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

- Tab **Budgeting**: 4 kartu ringkas (Menunggu Approve, Perlu Ditransfer, Sudah Cair
  Belum Ada Nota, Deadline Terdekat) + tabel kegiatan. Popup: Kebutuhan baru (Tipe
  Capex/Opex, kategori, mode Data lama, dibayar dari dana), Dana baru, Perlu ditransfer,
  Tandai Ditransfer, Lengkapi
  (Actual + foto nota, dikompres di browser max 1600px JPEG sebelum dikirim).
- Tab **Marketing**, sub-tab **Strategi** dan **Hasil Event**. Popup: Strategi baru
  (lane + channel boleh lebih dari satu) dan Hasil Event (diisi H+1 sampai H+3
  setelah event).

File:
- `index.html` — kerangka halaman: tab, panel, dan semua popup
- `style.css` — satu stylesheet untuk semuanya
- `app.js` — helper bersama, tab/routing, popup, dan pemuatan data
- `tracker.js` — logika tab Budgeting (kartu, tabel, approve/reject, ditransfer, input, lengkapi)
- `marketing.js` — logika tab Marketing (strategi, hasil event, popup inputnya)
- `common.js` — kode akses tim, `zApi.get/post` ke `/api/proxy`, dan `zEsc()`
  (wajib dipakai untuk semua teks dari data yang masuk ke innerHTML)
- `input.html`, `complete.html`, `marketing.html`, `strategi-input.html`,
  `hasil-event.html` — **alamat lama saja**, isinya pengalih otomatis ke `index.html`
  (misalnya `input.html` membuka popup Kebutuhan baru) supaya bookmark tim tidak putus.
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
5. Tes halaman: buka situsnya, kedua tab (Budgeting, Marketing) dan tiap popup.
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
7. Versi dengan tab `kategori`, mode Data lama, kartu Perlu Ditransfer, dan Dana: cukup
   paste Code.gs terbaru lalu Deploy -> New version. **Tidak perlu Setup / Reset.** Tab
   `kategori` dan `dana` serta header kolom **Dana** (S) di tab `kegiatan` dibuat otomatis
   saat halaman dibuka pertama kali. (Setup / Reset Tracker tidak menghapus tab `kategori`
   dan `dana`, tapi tetap mengosongkan tab `kegiatan`.)
8. **Tidak ada batas jumlah kegiatan.** Template tab `kegiatan` disiapkan sampai baris 500
   (rumus No/Selisih, format, dropdown); lewat dari itu, dashboard menambah baris beserta
   rumusnya sendiri. Sheet yang dibuat versi lama (template cuma sampai baris 60) sebaiknya
   dijalankan sekali: menu **Zerodeo Tools -> Perluas Tabel**. Menu ini menyiapkan baris
   sampai 500, membangun ulang tab `ringkasan` (isinya rumus semua), dan memperbarui rumus
   "Terpakai" di `plafon_fixed` tanpa menyentuh angka Plafon yang diisi manual. **Data tidak
   dihapus** (beda dengan Setup / Reset), dan aman dijalankan berulang. Tanpa menu ini pun
   dashboard tetap menerima kegiatan di atas baris 60; yang belum ikut hanya rumus di
   `ringkasan` dan `plafon_fixed` (masih sampai baris 60) serta rumus No/Selisih untuk baris
   yang diketik manual (Selisih di dashboard dihitung sendiri kalau kosong).

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
