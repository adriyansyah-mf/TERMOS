# Keamanan Termos

Dokumen ini menjelaskan apa yang dilindungi Termos, dari siapa, bagaimana caranya, dan apa yang **tidak** dilindungi.

## Model ancaman

| Pihak | Yang dianggap mungkin dilakukan | Yang dijamin Termos |
|---|---|---|
| Pencuri laptop / file vault | Menyalin `vault.json` | Isi vault terenkripsi; butuh master password (Argon2id 64 MiB, 3 pass) |
| Server sync yang dibobol, atau admin server yang jahat | Membaca dan mengubah database, mengirim respons palsu | Tidak bisa membaca isi vault; tidak bisa memindah, mengubah waktu, atau menghapus diam-diam record tanpa ketahuan; tidak bisa menurunkan kekuatan KDF; tidak bisa mengganti kunci anggota tim tanpa fingerprint berbeda |
| Relay berbagi sesi yang jahat | Melihat, mengulang, atau memantulkan frame | Tidak bisa membaca isi terminal; tidak bisa mengulang frame; tidak bisa memantulkan output host menjadi ketikan penonton |
| Penyerang di jaringan | Menyadap atau MITM | HTTPS ke server sync (http hanya untuk localhost/LAN); host key SSH diverifikasi dan diingat; sertifikat Proxmox self-signed dipin |
| Penyerang internet ke server | Brute force, spam akun, DoS | Rate limit login (per akun dan per IP), daftar, prelogin; kuota penyimpanan; batas ukuran request dan pesan; timeout koneksi lambat |
| Halaman web / konten berbahaya di aplikasi | Mencoba menjalankan kode di Termos | Renderer di sandbox Chromium, tanpa akses Node, CSP ketat, tidak boleh navigasi atau memuat apa pun dari jaringan, semua izin web ditolak, IPC hanya dari jendela Termos |

## Kriptografi

- **Vault lokal**: XChaCha20-Poly1305, kunci dari Argon2id (64 MiB, t=3) atas master password. Disimpan atomik dengan izin `0600`, folder `0700`.
- **Akun sync** (mirip Bitwarden): `master = Argon2id(password, salt)`, lalu HKDF memisahkan `authKey` (dikirim ke server untuk login, server menyimpan scrypt-nya) dan `encKey` (tidak pernah keluar dari perangkat). `encKey` membungkus `syncKey` acak dan kunci privat X25519. Setiap bungkusan diberi label sehingga tidak bisa ditukar.
- **Record sync**: setiap record dienkripsi dengan associated data `scope|id|updatedAt|deleted`. Server yang memindah record, mengubah waktunya, atau membalik status hapus membuat dekripsi gagal dan record diabaikan. `teamId` selalu diambil dari scope, bukan dari isi record.
- **Tim**: kunci tim acak 32 byte, disegel ke public key X25519 tiap anggota (sealed box: ECDH efemeral + HKDF + XChaCha20-Poly1305). Sebelum menambah anggota, Termos menampilkan **fingerprint** kunci mereka (8 grup angka) untuk dicocokkan lewat jalur lain; kunci tim hanya disegel kalau fingerprint yang dikonfirmasi masih sama.
- **Berbagi sesi**: kunci 32 byte hanya ada di bagian `#` link (tidak pernah dikirim ke server). Setiap frame terikat ke ID share, arah (host→penonton / penonton→host), pengirim, dan nomor urut yang harus naik.
- **Parameter KDF dari server diperiksa**: aplikasi menolak login kalau server memberi parameter Argon2id di bawah 64 MiB / 3 pass.

## Aplikasi desktop

- Electron 44, renderer `sandbox: true` + `contextIsolation`, tanpa `nodeIntegration`, `app.enableSandbox()`.
- UI dilayani dari origin privat `termos://app/` (hanya file di folder renderer, path traversal ditolak), dengan CSP `default-src 'none'`.
- Semua permintaan jaringan dari renderer diblokir; koneksi SSH/sync/Proxmox berjalan di proses utama.
- IPC hanya diterima dari frame utama jendela Termos; argumen keystroke/resize divalidasi.
- Electron fuses: `RunAsNode`, `NODE_OPTIONS`, `--inspect` dimatikan; aplikasi hanya dimuat dari ASAR; `file://` tanpa hak istimewa.
- Vault terkunci otomatis setelah idle (default 15 menit) dan saat komputer tidur atau layar dikunci; semua sesi ditutup.
- Quick unlock ditolak kalau Linux tidak punya keyring sungguhan (Electron akan jatuh ke `basic_text` yang tidak aman).
- Key SSH untuk OpenSSH sistem ditulis sementara ke folder `0700` / file `0600` dan dihapus.

## Server (`server/`)

- PostgreSQL 17 di jaringan Docker internal (tanpa akses internet, port tidak dipublikasikan), autentikasi SCRAM-SHA-256, password dari Docker secret.
- Semua container: filesystem read-only, `no-new-privileges`, semua Linux capability dicabut (Postgres hanya diberi yang dibutuhkan entrypoint-nya), batas memori dan jumlah proses, image dipin dengan digest. API berjalan sebagai user `node`, tanpa npm di image.
- HTTPS otomatis lewat Caddy (profil `https`), HSTS.
- Token perangkat 256-bit, disimpan sebagai hash SHA-256, kedaluwarsa setelah 90 hari tidak dipakai, bisa dicabut per perangkat; ganti password mencabut semua perangkat lain.
- Login: waktu respons sama untuk username yang ada dan tidak ada; prelogin memberi parameter palsu yang stabil untuk username tak dikenal.
- Semua query memakai parameter (tanpa string SQL dinamis dari input). Input divalidasi ketat (panjang kunci tepat, UUID, base64).
- Penulisan record diserialisasi dengan advisory lock dan last-writer-wins dilakukan atomik di SQL; kuota dicek dalam transaksi yang sama.
- WebSocket: upgrade dari browser (header `Origin`) ditolak, heartbeat memutus koneksi mati, batas ukuran dan laju pesan, maks 5 share aktif per akun dan 16 penonton per share.

## Bukti (tes otomatis)

| Suite | Isi | Hasil |
|---|---|---|
| `npm run test:crypto` | AAD record, nonce unik, bungkusan kunci tidak bisa ditukar, sealed box, penolakan KDF lemah, fingerprint, frame share anti-pantul/anti-ulang/anti-palsu | 9/9 |
| `cd server && npm test` (Postgres sungguhan) | akun, rate limit, sync, cursor tidak melewatkan tulisan paralel, akses tim 3 user, hapus akun, validasi input, header, Origin WS, kuota atomik, kedaluwarsa token | 21/21 |
| E2E aplikasi | vault, terminal lokal, SSH (host key + password), key, host, snippet, semua menu | 23/23 |
| E2E sync dua perangkat (stack Docker Postgres) | sync dua arah, hapus, tim, fingerprint benar/salah, keluar tim, database tanpa plaintext | 18/18 |
| E2E berbagi sesi | link, nonton, mengetik, izin dicabut, sesi diakhiri | 11/11 |
| `npm audit --omit=dev` | aplikasi dan server | 0 kerentanan |

## Batasan yang perlu diketahui

- **Lupa password akun sync = data di server hilang.** Tidak ada yang bisa memulihkan, termasuk admin. Vault lokal di tiap perangkat tetap bisa dibuka dengan master password-nya.
- **Rollback oleh server**: server jahat bisa menahan update terbaru dan hanya menyajikan versi lama ke perangkat yang baru login. Perangkat yang sudah punya versi lebih baru tidak akan mundur.
- **Metadata terlihat server**: username, nama perangkat, nama tim, keanggotaan tim, jumlah record, waktu perubahan, dan ukuran data.
- **Anggota yang dikeluarkan** tetap menyimpan data tim yang sudah ia unduh, dan kunci tim tidak dirotasi. Buat tim baru untuk memutus akses sepenuhnya.
- **Berbagi sesi**: siapa pun yang memegang link (dan punya akun di server) bisa menonton; penonton bisa saling memalsukan tampilan satu sama lain karena berbagi kunci yang sama. Hanya host yang bisa mengizinkan ketikan.
- **Perangkat yang sudah dibobol** (malware dengan akses ke proses Termos saat vault terbuka) bisa membaca isi vault. Auto-lock memperkecil jendela waktunya.
- Belum ada audit keamanan oleh pihak ketiga.

## Melaporkan masalah keamanan

Kirim detailnya langsung ke pemilik repo ini (jangan lewat issue publik).
