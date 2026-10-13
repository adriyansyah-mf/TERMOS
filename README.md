# Termos

Klien SSH desktop untuk sysadmin: simpan host, key, dan password di satu vault terenkripsi, buka terminal SSH/Telnet/Serial, pindahkan file lewat SFTP, atur port forwarding, dan kelola VM/container Proxmox dari satu aplikasi. Sync antar perangkat dan berbagi dengan tim lewat server yang kamu jalankan sendiri.

Termos jalan di Linux dan Windows. Server sync-nya (opsional) jalan di Docker.

- [Fitur](#fitur)
- [Instalasi](#instalasi)
- [Mulai pakai](#mulai-pakai)
- [Panduan fitur](#panduan-fitur)
- [Server sync self-hosted](#server-sync-self-hosted)
- [Pintasan keyboard](#pintasan-keyboard)
- [Lokasi data dan backup](#lokasi-data-dan-backup)
- [Keamanan](#keamanan)
- [Masalah umum](#masalah-umum)
- [Build dari source](#build-dari-source)
- [Struktur proyek](#struktur-proyek)
- [Belum tersedia](#belum-tersedia)

## Fitur

### Koneksi

| Protokol | Keterangan |
|---|---|
| SSH | Engine bawaan (ssh2): password, key, SSH agent, agent forwarding, keyboard-interactive (OTP/2FA), environment variable, keepalive |
| SSH lewat OpenSSH sistem | Untuk sertifikat SSH dan key FIDO2/YubiKey (`ssh` di PATH) |
| Jump host | Rantai beberapa host (setara `ProxyJump`) |
| Proxy | SOCKS4, SOCKS5, HTTP CONNECT, atau perintah (`ProxyCommand`) |
| Mosh | Lewat binary `mosh` sistem |
| Telnet | Termasuk negosiasi ukuran jendela (NAWS) dan tipe terminal |
| Serial | Port `/dev/ttyUSB*`, `COM*`, baud rate 1200 sampai 230400 |
| Terminal lokal | Shell default (`$SHELL` di Linux, PowerShell/cmd di Windows) |

### Terminal

- Tab, dan split sampai 4 panel per tab
- Pencarian di layar, bersihkan layar, scrollback bisa diatur
- Tema terminal (Termos Graphite, Dracula, Solarized Dark, One Light) dan ukuran font, bisa berbeda per host
- Sambung ulang satu klik kalau koneksi putus
- Salin/tempel dengan `Ctrl+Shift+C` / `Ctrl+Shift+V`, atau klik kanan (salin kalau ada seleksi, tempel kalau tidak)
- Charset per host (UTF-8, Latin-1, dan lain-lain)
- Log sesi ke file (opsional, per host)

### Host dan vault

- Grup bertingkat; pengaturan grup (user, port, key, proxy, jump host, tema) diwarisi host di dalamnya
- Tag, pencarian, urutkan berdasarkan nama/alamat/terakhir dipakai
- Quick connect: ketik `user@alamat:port` tanpa menyimpan host
- Import dari `~/.ssh/config` (Host, HostName, User, Port, IdentityFile, ProxyJump, ForwardAgent)
- Snippet saat login: perintah yang otomatis dijalankan setelah tersambung

### Keychain

- Buat key Ed25519, ECDSA P-256, atau RSA 4096
- Import key dari file atau tempel teks (termasuk yang berpassphrase dan sertifikat `*-cert.pub`)
- Identity: username + password/key yang dipakai banyak host sekaligus
- Daftar proxy
- Salin public key atau perintah pemasangan ke `authorized_keys`

### SFTP

- Panel di samping terminal: jelajahi folder, unggah, unduh (file dan folder), seret-lepas file dari desktop
- Buat folder, ganti nama, hapus, ubah izin (`chmod`)
- Buka dan edit file teks langsung (sampai 2 MB, simpan dengan `Ctrl+S`)
- Progres transfer

### Port forwarding

- Local (`-L`), Remote (`-R`), dan Dynamic/SOCKS5 (`-D`)
- Start/stop manual, atau otomatis saat host tersambung

### Snippet dan riwayat

- Simpan perintah yang sering dipakai, jalankan di panel aktif atau kirim ke semua panel sekaligus
- Riwayat perintah per host (baris yang diketik saat prompt password tidak dicatat)

### Proxmox VE

- Login dengan API token atau username/password; sertifikat self-signed dipin saat pertama dipercaya
- Lihat node, VM, dan container beserta CPU, RAM, disk, uptime, dan tag
- Start, shutdown, reboot, suspend, resume, stop paksa
- Snapshot: buat, rollback, hapus
- Task log per node
- SSH ke node, `pct enter` ke container, serial console VM (`qm terminal`), console web noVNC
- Simpan VM/container sebagai host SSH

### Keamanan lokal

- Vault terenkripsi (Argon2id + XChaCha20-Poly1305) dengan master password
- Opsional: buka vault lewat keychain sistem (gnome-keyring/KWallet/Windows)
- Kunci otomatis setelah tidak dipakai (default 15 menit) dan saat komputer tidur atau layar dikunci
- Verifikasi host key SSH; peringatan kalau host key berubah

### Sync dan tim (butuh server sendiri)

- Sync vault antar perangkat, terenkripsi end-to-end: server hanya menyimpan data terenkripsi
- Vault tim: host, key, identity, grup, dan snippet bisa dibagi ke anggota tim
- Verifikasi fingerprint kunci saat menambah anggota
- Berbagi sesi terminal secara live lewat link; penonton bisa diizinkan mengetik
- Daftar perangkat yang login, cabut perangkat, ganti password akun

## Instalasi

Unduh file terbaru dari halaman [Releases](https://github.com/adriyansyah-mf/TERMOS/releases).

| Sistem | File | Cara pasang |
|---|---|---|
| Debian, Ubuntu, Kali, Mint | `termos-<versi>-amd64.deb` | `sudo apt install ./termos-<versi>-amd64.deb` |
| Fedora, RHEL, Rocky, openSUSE | `termos-<versi>-x86_64.rpm` | `sudo dnf install ./termos-<versi>-x86_64.rpm` (openSUSE: `sudo zypper install ./termos-<versi>-x86_64.rpm`) |
| Linux lain | `termos-<versi>-x86_64.AppImage` | `chmod +x termos-<versi>-x86_64.AppImage` lalu jalankan |
| Windows 10/11 (64-bit) | `termos-<versi>-setup-x64.exe` | Jalankan installer |

Semua build untuk x86_64 (amd64).

### Verifikasi file unduhan

Setiap release menyertakan `SHA256SUMS` dan attestation build dari GitHub Actions.

```sh
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify termos-<versi>-amd64.deb --repo adriyansyah-mf/TERMOS
```

Attestation membuktikan file dibuat oleh workflow di repo ini dari commit yang tercatat, bukan diunggah manual.

### Kebutuhan

- Linux: glibc modern (Ubuntu 22.04+, Debian 12+, Fedora 38+, atau setara). Paket `.deb`/`.rpm` otomatis memasang `libsecret`, `nss`, dan `libXtst`.
- Opsional: `mosh` untuk koneksi Mosh, OpenSSH client (`ssh`) untuk engine OpenSSH, gnome-keyring atau KWallet untuk buka vault tanpa password.
- Windows: Windows 10 1809 atau lebih baru (ConPTY).

## Mulai pakai

1. **Buat vault.** Saat pertama dibuka, Termos meminta master password (minimal 8 karakter). Semua data dienkripsi dengan password ini. Password tidak bisa dipulihkan; kalau lupa, isi vault tidak bisa dibuka.
2. **Tambah host.** Menu Hosts, tombol **Host baru**: isi nama, alamat, username, lalu password atau key. Atau klik **Import ~/.ssh/config**.
3. **Hubungkan.** Klik dua kali baris host, tekan Enter, atau tombol **Hubungkan**. Saat pertama konek ke server, Termos menampilkan fingerprint host key; cocokkan lalu pilih **Percayai**.
4. **Coba quick connect.** Tekan `Ctrl+K`, ketik `root@192.168.1.10` lalu Enter.

## Panduan fitur

### Grup dan pewarisan pengaturan

Buat grup (**Grup baru**), isi pengaturan yang sama untuk semua host di dalamnya, misalnya username `deploy` dan key `kunci-kantor`. Host di grup itu yang kolomnya kosong otomatis memakai nilai grup. Form host menampilkan "Diwarisi dari grup ..." di bawah kolom yang mewarisi.

### SSH key

1. Menu **Keychain**, tombol **SSH key baru**. Pilih Ed25519 (disarankan), beri nama, passphrase opsional.
2. Klik **Public key**, lalu **Salin perintah pasang ke server**. Jalankan perintah itu sekali di server (dengan login password).
3. Di form host, pilih key tersebut di kolom **SSH key**.

Untuk sertifikat SSH atau YubiKey/FIDO2, tempel key + sertifikatnya, lalu di form host pilih **Engine SSH: OpenSSH sistem**.

### Jump host dan proxy

Di form host, bagian **Jump host**, tambahkan host perantara sesuai urutan. Termos tersambung ke host pertama, lalu meneruskan koneksi ke host berikutnya, sama seperti `ssh -J`.

Proxy dibuat di **Keychain**, bagian Proxy, lalu dipilih di form host. Tipe **Perintah** menerima `%h` (host), `%p` (port), dan `%r` (user), misalnya `nc -X 5 -x proxy:1080 %h %p`.

### SFTP

Saat tersambung ke host SSH yang tersimpan, klik **SFTP** di toolbar terminal. Klik untuk memilih (Ctrl+klik untuk banyak), klik dua kali atau Enter untuk membuka folder/file. Seret file dari file manager ke panel untuk mengunggah.

### Port forwarding

Menu **Port forwarding**, tombol **Aturan baru**:

| Tipe | Contoh | Artinya |
|---|---|---|
| Local | bind `127.0.0.1:5432`, tujuan `127.0.0.1:5432` | Database di server bisa dibuka dari laptop lewat `localhost:5432` |
| Remote | bind server `0.0.0.0:8080`, tujuan `127.0.0.1:3000` | Aplikasi di laptop (port 3000) bisa diakses dari server port 8080 |
| Dynamic | bind `127.0.0.1:1080` | Proxy SOCKS5 di laptop; lalu lintas keluar lewat server |

Centang aturan di form host (bagian **Port forwarding otomatis**) agar menyala setiap host itu tersambung.

### Snippet

Menu **Snippets**, buat perintah (boleh banyak baris). Di tab terminal, tombol **Snippet** menjalankannya di panel aktif. Kalau tab punya beberapa panel, centang **Broadcast snippet** untuk mengirim ke semua panel.

### Proxmox

1. Di Proxmox: **Datacenter > Permissions > API Tokens > Add**. Pilih user (misalnya `root@pam`), beri nama token (misalnya `termos`). Kalau **Privilege Separation** dicentang, beri token itu peran sendiri di **Permissions > Add > API Token Permission** (contoh: path `/`, role `PVEVMAdmin` untuk kontrol VM, atau `PVEAuditor` untuk lihat saja).
2. Di Termos: menu **Proxmox**, **Server baru**. Isi URL (`https://ip-proxmox:8006`), token ID (`root@pam!termos`), dan secret.
3. **Tes koneksi**. Kalau sertifikatnya self-signed, Termos menampilkan fingerprint SHA-256; cocokkan dengan **Datacenter > node > System > Certificates**, lalu **Percayai & tes ulang**.
4. Untuk tombol **SSH** ke node, isi **Host SSH untuk node** dengan host tersimpan, atau biarkan kosong (Termos SSH sebagai `root` ke IP node).

`pct enter` (container) dan **Serial** (VM, butuh serial console aktif di VM) berjalan lewat SSH ke node. **SSH** pada VM memakai IP dari QEMU guest agent atau interface container.

### Sync antar perangkat

1. Jalankan server (lihat [Server sync self-hosted](#server-sync-self-hosted)).
2. Menu **Sync & tim** (`Ctrl+8`): isi alamat server, **Cek server**, lalu **Daftar akun baru**. Password akun berbeda dari master password vault, minimal 10 karakter.
3. Di perangkat lain, buka Termos, buat vault, lalu **Masuk** dengan akun yang sama.

Yang ikut tersinkron: host, grup, key, identity, proxy, snippet, aturan forwarding, known hosts, server Proxmox. Riwayat perintah dan pengaturan tampilan tetap di perangkat masing-masing.

### Tim

1. **Sync & tim**, **Tim baru**.
2. Buka **Anggota**, **Tambah anggota**, ketik username teman. Termos menampilkan fingerprint kunci akunnya; minta temanmu membacakan **Fingerprint akunmu** dari Termos miliknya lewat telepon/chat. Tambahkan hanya kalau sama.
3. Pindahkan item ke tim lewat kolom **Disimpan di** di form host/grup/identity/snippet, atau di detail key.

Key dan identity yang dipakai host tim juga perlu ada di tim yang sama, supaya anggota lain bisa konek.

### Berbagi sesi live

1. Di tab terminal, **Bagikan**. Centang **Izinkan penonton mengetik** kalau perlu, lalu **Mulai berbagi**.
2. Kirim link yang muncul ke rekan (mereka harus punya akun di server yang sama).
3. Rekan membuka **Hosts**, **Gabung sesi bersama**, lalu menempel link.

Kamu bisa mencabut izin mengetik, mengeluarkan penonton, atau menghentikan berbagi kapan saja dari dialog yang sama.

## Server sync self-hosted

Server ada di folder [`server/`](server/): Node.js + PostgreSQL 17, dijalankan dengan Docker Compose. Ringkasnya:

```sh
git clone https://github.com/adriyansyah-mf/TERMOS.git
cd TERMOS/server
./setup.sh                      # membuat password database (Docker secret) dan .env
docker compose up -d --build    # API di 127.0.0.1:8080
```

Untuk akses dari internet dengan HTTPS otomatis, isi `TERMOS_DOMAIN` di `.env` lalu:

```sh
docker compose --profile https up -d --build
```

Akun pertama yang mendaftar menjadi admin, lalu pendaftaran tertutup (bisa diubah ke mode undangan). Detail pengaturan, backup, dan update ada di [`server/README.md`](server/README.md).

## Pintasan keyboard

| Pintasan | Aksi |
|---|---|
| `Ctrl+1` sampai `Ctrl+9` | Pindah menu: Hosts, Keychain, Snippets, Port forwarding, Proxmox, Known hosts, Riwayat, Sync & tim, Settings |
| `Ctrl+K` | Quick connect |
| `Ctrl+Shift+T` | Terminal lokal baru |
| `Ctrl+Shift+W` | Tutup tab aktif |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Tab berikutnya / sebelumnya |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Salin / tempel di terminal |
| Klik kanan di terminal | Salin seleksi, atau tempel kalau tidak ada seleksi |
| Klik tengah pada tab | Tutup tab |
| `Enter` pada baris host | Hubungkan |
| `Ctrl+S` di editor SFTP | Simpan file |
| `Esc` | Tutup dialog |

## Lokasi data dan backup

| Sistem | Folder |
|---|---|
| Linux | `~/.config/Termos/data/` |
| Windows | `%APPDATA%\Termos\data\` |

Isinya:

- `vault.json`: seluruh vault, terenkripsi dengan master password. Ini satu-satunya file yang perlu di-backup.
- `quick-unlock.bin`: kunci vault yang dibungkus keychain sistem (hanya kalau fitur itu dinyalakan).
- `logs/`: log sesi (hanya untuk host yang mengaktifkannya).

Backup cukup dengan menyalin `vault.json`. File itu tidak bisa dibuka tanpa master password, jadi aman disimpan di cloud, tapi jangan sampai lupa password-nya.

## Keamanan

Ringkasan di bawah; rincian model ancaman, kriptografi, dan batasannya ada di [SECURITY.md](SECURITY.md).

- Vault lokal: Argon2id (64 MiB, 3 pass) + XChaCha20-Poly1305.
- Sync: kunci enkripsi diturunkan dari password akun di perangkat dan tidak pernah dikirim; server hanya menyimpan ciphertext yang terikat ke ID dan waktu record, jadi tidak bisa diubah diam-diam.
- Tim: kunci tim disegel ke kunci X25519 tiap anggota, dengan verifikasi fingerprint.
- Berbagi sesi: kunci hanya ada di link; frame terikat arah dan nomor urut (tidak bisa diulang atau dipantulkan oleh relay).
- Aplikasi: Electron 44 dengan sandbox, CSP ketat, tanpa akses jaringan dari UI, fuses keamanan, auto-lock.
- Server: PostgreSQL di jaringan internal, container read-only tanpa root, rate limit, kuota, HTTPS.

## Masalah umum

**AppImage tidak mau jalan di Ubuntu 22.04+.** AppImage butuh FUSE 2: `sudo apt install libfuse2` (Ubuntu 24.04: `libfuse2t64`). Alternatif: pakai `.deb`.

**AppImage berhenti dengan pesan soal sandbox.** Di beberapa distro, user namespace dibatasi (misalnya AppArmor di Ubuntu 24.04). Pakai paket `.deb`/`.rpm`, atau jalankan `./termos-*.AppImage --no-sandbox` (sandbox Chromium untuk UI jadi nonaktif).

**Windows SmartScreen memperingatkan installer.** Installer belum ditandatangani dengan sertifikat code signing. Pilih **More info > Run anyway** setelah memverifikasi `SHA256SUMS`.

**"Keychain sistem tidak tersedia".** Buka vault dengan keychain butuh gnome-keyring atau KWallet yang berjalan. Tanpa itu, Termos sengaja menolak karena penyimpanan cadangan Electron tidak aman. Master password tetap bisa dipakai.

**"Host key BERUBAH".** Fingerprint server berbeda dari yang tersimpan. Kalau server memang diinstal ulang, hapus entrinya di menu **Known hosts** lalu konek lagi. Kalau tidak, jangan lanjutkan.

**Proxmox: "Sertifikat self-signed belum dipercaya".** Normal untuk Proxmox baru. Cocokkan fingerprint dengan halaman Certificates di Proxmox sebelum mempercayai.

**Sync: "Server di internet harus memakai https://".** Termos hanya menerima `http://` untuk localhost dan alamat jaringan lokal. Pasang server dengan profil `https`.

**Login sync atau buka vault terasa lambat (2 sampai 3 detik).** Disengaja: Argon2id dengan 64 MiB memperlambat tebakan password.

## Build dari source

Kebutuhan: Node.js 24, Git, Python 3, compiler C/C++ (`build-essential` di Debian/Ubuntu, Visual Studio Build Tools di Windows). Untuk paket `.rpm`: `rpm` (`rpmbuild`).

```sh
git clone https://github.com/adriyansyah-mf/TERMOS.git
cd TERMOS
npm ci                 # memasang dependency dan mengompilasi node-pty/serialport untuk Electron
npm run dev            # jalankan mode pengembangan
```

Perintah lain:

| Perintah | Fungsi |
|---|---|
| `npm run typecheck` | Pemeriksaan TypeScript |
| `npm run lint` | ESLint |
| `npm run test:crypto` | Tes unit kriptografi |
| `npm run build:linux` | Paket AppImage, deb, rpm ke `dist/` |
| `npm run build:win` | Installer Windows ke `dist/` |
| `cd server && npm test` | Tes server (menjalankan PostgreSQL sementara di Docker) |

### Membuat release

Workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) membangun semua paket di GitHub Actions:

```sh
git tag v0.2.0
git push origin v0.2.0
```

Workflow menjalankan audit dependency, typecheck, lint, dan tes kripto, lalu membangun AppImage/deb/rpm (Ubuntu) dan installer `.exe` (Windows), dan menerbitkan release berisi file-file itu, `SHA256SUMS`, dan attestation. Jalankan manual dari tab Actions untuk build uji tanpa membuat release.

## Struktur proyek

```
src/
  main/            proses utama Electron: vault, kripto, sesi SSH/Telnet/Serial/PTY,
                   SFTP, port forwarding, Proxmox, sync, berbagi sesi, IPC
  preload/         jembatan IPC yang diekspos ke UI (contextBridge)
  renderer/        UI React: views/ (halaman), components/ (terminal, SFTP, dialog)
  shared/          tipe data dan definisi API yang dipakai main dan UI
server/            server sync self-hosted (Node.js + PostgreSQL, Docker)
test/              tes unit kriptografi
build/             ikon dan hook packaging (Electron fuses)
DESIGN.md          arah desain UI
SECURITY.md        model ancaman dan detail keamanan
```

## Belum tersedia

- Aplikasi Android/iOS dan build macOS
- SFTP dua panel (lokal dan server berdampingan)
- Menyimpan susunan tab/panel (workspace)
- Isian port knocking di form host
- Import host dari AWS, DigitalOcean, Azure
- Autocomplete perintah

## Lisensi

Belum ditentukan. Sampai ada file `LICENSE`, semua hak dipegang pemilik repo.
