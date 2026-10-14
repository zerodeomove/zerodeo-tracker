# Keamanan Zerodeo: urutan aman untuk Lenno

Repo ini **public**, dan riwayat git lamanya pernah memuat URL Apps Script dan PIN approve lama.
Riwayat tidak ditulis ulang. Sebagai gantinya, semua nilai lama dibuat tidak berguna lewat langkah di bawah.
Kerjakan **berurutan**; urutannya dibuat supaya Zerodeo tidak putus di tengah jalan.

## Sebelum mulai (wajib)

- [ ] Script Property **`SHARED_SECRET`** di Apps Script sudah terisi dan **sama persis** dengan env `SHARED_SECRET` di Vercel.
  Versi baru **menolak semua panggilan** kalau properti ini kosong (sebelumnya kosong = terbuka).
  Kalau belum terisi, isi dulu dan tes dashboard, baru lanjut.
- [ ] Catat **ID folder nota** dari Apps Script yang sedang jalan (baris `NOTA_FOLDER_ID = '...'` di `Code.gs` lama), atau dari alamat
  folder "Nota Zerodeo" di Drive (`drive.google.com/drive/folders/<ID>`). Dipakai di langkah 1.
- [ ] Disarankan: coba semuanya dulu di **salinan Sheet** ("Make a copy"; script ikut tersalin).

## Langkah

1. **Isi Script Property `NOTA_FOLDER_ID`** dengan ID folder nota tadi (Project Settings -> Script Properties).
   Lakukan SEBELUM langkah 2. Kalau terlewat, foto nota baru masuk ke folder baru "Zerodeo - Nota Bukti", bukan folder lama.
2. **Paste `Code.gs` dan `Marketing.gs` terbaru** ke Apps Script, lalu Deploy -> Manage deployments -> pensil -> **New version**
   (URL tidak berubah). Dashboard boleh menampilkan banner kuning "versi Apps Script berbeda" sampai langkah 3 selesai.
3. **Merge PR ini ke `main`.** Vercel otomatis deploy proxy baru (pembacaan data lewat POST, secret tidak lagi di URL).
   Proxy sekarang juga menolak jalan kalau `SHARED_SECRET` di Vercel kosong.
4. **Tes:** buka dashboard, muat data, tambah satu kegiatan contoh. Cek kolom **ID** (kolom T) di tab `kegiatan` terisi.
   Baris lama diisi otomatis; atau jalankan menu **Zerodeo Tools -> Isi ID Kegiatan**.
5. **Matikan jalur GET:** Script Properties -> tambah `BLOCK_GET` = `1`. Tes dashboard sekali lagi.
6. **Arsipkan semua deployment Apps Script lama.** Deploy -> Manage deployments: biarkan **satu** deployment aktif (yang URL-nya
   ada di env `APPS_SCRIPT_URL`), arsipkan yang lain. Tiap deployment lama masih menjalankan kode versinya sendiri,
   termasuk versi yang dulu belum mengecek secret.
7. **Ganti PIN approve Lemon:** menu Zerodeo Tools -> Ganti PIN Lemon. PIN lama ada di riwayat git yang public.
   Kabari PIN baru ke Lemon lewat chat pribadi.
8. **Cek:** buka URL Apps Script **lama** dari riwayat git di browser (tanpa tambahan apa pun). Hasil yang benar:
   `unauthorized`, error Google, atau halaman tidak ditemukan. Kalau muncul data kegiatan, ada deployment lama yang
   masih aktif: kembali ke langkah 6.

## Opsional

- Ganti `SHARED_SECRET` (di Vercel dan Script Properties, nilai sama, lalu Redeploy) kalau ada kemungkinan nilainya pernah terbaca orang lain.
- Ganti `TEAM_CODE` di Vercel kalau kode tim pernah terbaca orang di luar tim.

## Yang sudah dijaga di kode

- Apps Script menolak semua panggilan tanpa secret yang benar (perbandingan aman dari serangan waktu), dan tertutup kalau secret belum diisi.
- Proxy tidak pernah menaruh secret di URL, dan menimpa `secret` kiriman browser dengan nilai dari env server.
- Tidak ada rahasia, PIN, URL Apps Script, atau ID folder di file aktif repo (sudah diperiksa).
- Repo public itu aman selama aturannya dijaga: **jangan menulis secret/PIN/URL/ID ke kode atau commit.**
