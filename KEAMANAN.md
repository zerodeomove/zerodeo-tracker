# Keamanan Zerodeo: urutan aman untuk Lenno

Repo ini **public**, dan riwayat git lamanya pernah memuat URL Apps Script dan PIN approve lama.
Riwayat tidak ditulis ulang. Sebagai gantinya, semua nilai lama dibuat tidak berguna lewat langkah di bawah.
Kerjakan **berurutan**; urutannya dibuat supaya Zerodeo tidak putus di tengah jalan.

Versi ini juga memindahkan login ke **Hub Pinggiran** dan **menghapus PIN approve**. Karena approve sekarang
bergantung pada login Hub, **Hub harus sudah jalan duluan** (bagian A).

## A. Hub harus siap dulu (sekali)

- [ ] Backend Hub sudah dipasang dan kamu bisa login di Hub (lihat `hub-backend/README.md` di repo `juanda-hub`).
- [ ] Di Hub (menu Tim): semua anggota sudah dibuat, dan Zerodeo sudah diberi akses dengan peran yang benar
  (Lemon = `approver`; Lenno dan Ricko = `admin`; lainnya `anggota`).
- [ ] Salin nilai Script Property **`SECRET_ZERODEO`** dari Script Properties **Hub** (dibuat otomatis oleh `setup()`).
  Nilai yang sama dipakai di Apps Script Zerodeo dan env Vercel. Jangan masuk repo atau chat.
- [ ] Catat URL web app Apps Script **Hub** (`/exec`).

## B. Sebelum mulai di Zerodeo (wajib)

- [ ] Script Property **`SHARED_SECRET`** di Apps Script Zerodeo sudah terisi dan **sama persis** dengan env `SHARED_SECRET` di Vercel.
  Versi baru **menolak semua panggilan** kalau properti ini kosong (sebelumnya kosong = terbuka).
- [ ] Catat **ID folder nota** dari Apps Script yang sedang jalan (baris `NOTA_FOLDER_ID = '...'` di `Code.gs` lama), atau dari alamat
  folder "Nota Zerodeo" di Drive (`drive.google.com/drive/folders/<ID>`). Dipakai di langkah 1.
- [ ] Disarankan: coba semuanya dulu di **salinan Sheet** ("Make a copy"; script ikut tersalin).

## C. Langkah

1. **Isi Script Properties** di Apps Script Zerodeo, SEBELUM langkah 2:
   `NOTA_FOLDER_ID` (ID folder nota tadi), `SECRET_ZERODEO` (dari Hub), dan `HUB_URL` (URL Apps Script Hub).
   Kalau `NOTA_FOLDER_ID` terlewat, foto nota baru masuk ke folder baru "Zerodeo - Nota Bukti", bukan folder lama.
2. **Paste `Code.gs`, `Marketing.gs`, dan `Hub.gs` terbaru** ke Apps Script (`Hub.gs` file baru, buat lewat tombol "+" di Files),
   lalu Deploy -> Manage deployments -> pensil -> **New version** (URL tidak berubah). Izinkan akses yang diminta Google
   (Drive dan akses eksternal untuk sinkron tim).
3. Di Sheet: menu **Zerodeo Tools -> Sinkron Tim dari Hub** (tab `Tim` terisi). Setelah itu sinkron berjalan **otomatis**: saat anggota baru dari Hub membuka Zerodeo, dan paling lama tiap 10 menit. **Pasang Sinkron Harian** hanya opsional sebagai cadangan.
   Baris lama kegiatan yang PIC-nya masih berupa nama ("Ricko") tetap dikenali; kolom **ID** (kolom T) terisi otomatis.
4. Di Vercel: tambah env **`SECRET_ZERODEO`** (nilai yang sama). **Biarkan `TEAM_CODE`** dulu (masa transisi), lalu **merge PR ini
   ke `main`** supaya Vercel deploy proxy baru (baca data lewat POST, token Hub, secret tidak di URL).
5. **Tes dari Hub:** klik kartu Zerodeo, harus terbuka tanpa login lagi. Coba Approve dengan akun Lemon; coba juga dengan akun
   anggota (tombol Approve tidak ada). Cek tab `log_aktivitas` mencatat aksinya.
6. **Matikan jalur GET:** Script Properties -> tambah `BLOCK_GET` = `1`. Tes dashboard sekali lagi.
7. **Hapus `TEAM_CODE`** dari env Vercel dan Redeploy (setelah semua orang terbiasa masuk lewat Hub). Sejak itu hanya token Hub yang
   diterima. Hapus juga Script Property `APPROVAL_PIN` kalau masih ada: PIN bersama **sudah tidak dipakai**, jadi PIN lama di
   riwayat git tidak berguna lagi.
8. **Arsipkan semua deployment Apps Script lama.** Deploy -> Manage deployments: biarkan **satu** deployment aktif (yang URL-nya
   ada di env `APPS_SCRIPT_URL`), arsipkan yang lain. Tiap deployment lama masih menjalankan kode versinya sendiri,
   termasuk versi yang dulu belum mengecek secret.
9. **Cek:** buka URL Apps Script **lama** dari riwayat git di browser (tanpa tambahan apa pun). Hasil yang benar:
   `unauthorized`, error Google, atau halaman tidak ditemukan. Kalau muncul data kegiatan, ada deployment lama yang
   masih aktif: kembali ke langkah 8.
10. **Titik merah:** di Script Properties **Hub**, isi `ZERODEO_URL` (URL Apps Script Zerodeo, bukan alamat Vercel).

## Opsional

- Ganti `SHARED_SECRET` (di Vercel dan Script Properties, nilai sama, lalu Redeploy) kalau ada kemungkinan nilainya pernah terbaca orang lain.
- Ganti `SECRET_ZERODEO` (di Hub, Zerodeo, dan Vercel, nilai sama) kalau ada kemungkinan bocor. Semua orang akan masuk lagi lewat Hub.

## Yang sudah dijaga di kode

- Apps Script menolak semua panggilan tanpa secret yang benar (perbandingan aman dari serangan waktu), dan tertutup kalau secret belum diisi.
- Proxy memverifikasi token Hub (tanda tangan, app, masa berlaku) dan menimpa `secret` serta identitas (`hub`) kiriman browser.
  Aksi approve/ubah keputusan hanya untuk approver/admin dan diperiksa lagi di Apps Script; tidak ada yang bisa memutuskan kegiatannya sendiri.
- Titik merah dari Hub hanya diterima dengan token servis bertanda tangan (`hub-service`); token pengguna ditolak untuk aksi itu.
- Proxy tidak pernah menaruh secret di URL.
- Semua aksi tulis dicatat otomatis di `log_aktivitas` (siapa, peran, aksi, ID kegiatan).
- Tidak ada rahasia, PIN, URL Apps Script, atau ID folder di file aktif repo (sudah diperiksa).
- Repo public itu aman selama aturannya dijaga: **jangan menulis secret/PIN/URL/ID ke kode atau commit.**


## Akses yang dicabut di Hub

Token Hub berlaku 12 jam, jadi mencabut akses di Hub tidak otomatis menghentikan token yang sudah beredar. Karena itu Apps Script Zerodeo
memeriksa tab **Tim** (hanya user aktif yang punya akses Zerodeo) pada setiap permintaan: orang yang tidak ada di tab Tim ditolak
(`unauthorized`), dan perannya mengikuti tab Tim, bukan token. Tab Tim disinkron otomatis paling lama tiap 10 menit (dan segera ketika
ada orang yang belum tercatat), jadi akses yang dicabut atau diubah di Kelola Tim berlaku di Zerodeo dalam sekitar 10 menit.
Selama tab Tim belum pernah terisi, pemeriksaan ini tidak aktif.

## Hosting alternatif: Cloudflare Pages

Repo yang sama bisa disajikan oleh Cloudflare Pages selain Vercel. Folder `api/` dipakai Vercel, folder `functions/` dipakai Cloudflare;
isi keduanya setara (verifikasi token Hub, penimpaan `hub` dan `secret`, penolakan tanpa login). Tes: `node tests/cf-proxy.test.js`.

Pasang di Cloudflare: Workers & Pages, Create, Pages, Connect to Git, pilih repo ini; Framework preset: None; Build command: kosong;
Build output directory: `/`. Lalu Settings, Variables and Secrets (jenis Secret): `APPS_SCRIPT_URL`, `SHARED_SECRET`, `SECRET_ZERODEO`.
Jangan isi `TEAM_CODE` (jalur lama sudah ditutup). Setelah mengubah variabel, deploy ulang. Tanda tangan token Hub membawa padding `=`
di ujungnya; proxy Cloudflare sudah menormalkannya.
