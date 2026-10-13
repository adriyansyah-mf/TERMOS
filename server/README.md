# termos-server

Backend self-hosted untuk Termos: sync vault antar perangkat, vault tim, dan berbagi sesi terminal live.
Isi vault dienkripsi di perangkat sebelum dikirim; server hanya menyimpan ciphertext. Lihat `../SECURITY.md` untuk model ancaman lengkap.

## Komponen

| Container | Isi | Keterangan |
|---|---|---|
| `db` | PostgreSQL 17 | Jaringan internal saja, tanpa internet, port tidak dipublikasikan, SCRAM-SHA-256, password dari Docker secret |
| `api` | Node 24 + `ws` + `pg` | User `node`, filesystem read-only, tanpa capability, tanpa npm di image |
| `caddy` (opsional) | Caddy 2 | HTTPS otomatis (Let's Encrypt) + HSTS, profil `https` |

Semua image dipin dengan digest. Semua container memakai `read_only`, `no-new-privileges`, `cap_drop: ALL`, batas memori dan jumlah proses.

## Menjalankan

```sh
cd server
./setup.sh                      # sekali: membuat secrets/db_password dan .env
docker compose up -d --build    # API di 127.0.0.1:8080
curl http://127.0.0.1:8080/api/status
```

### Dengan HTTPS (disarankan untuk akses dari internet)

1. Arahkan DNS domain (misalnya `termos.domainmu.id`) ke server ini, buka port 80 dan 443.
2. Isi `TERMOS_DOMAIN=termos.domainmu.id` di `.env`.
3. `docker compose --profile https up -d --build`

### Di Proxmox / LAN

Jalankan di LXC atau VM, lalu pakai profil `https` atau reverse proxy yang sudah ada (Nginx Proxy Manager, Traefik). Aplikasi menerima `http://` hanya untuk localhost dan alamat jaringan lokal.

## Pengaturan (`.env`)

| Variabel | Default | Arti |
|---|---|---|
| `TERMOS_SIGNUP` | `first` | `first`: hanya akun pertama yang boleh daftar dan jadi admin. `invite`: daftar butuh `TERMOS_INVITE_CODE` (min. 16 karakter). `open`: siapa pun yang bisa mengakses server |
| `TERMOS_INVITE_CODE` | acak dari `setup.sh` | Kode undangan untuk mode `invite` |
| `TERMOS_DOMAIN` | | Domain untuk profil `https` |
| `TERMOS_PORT` | `8080` | Port API di 127.0.0.1 |
| `TERMOS_TOKEN_IDLE_DAYS` | `90` | Token perangkat kedaluwarsa setelah selama ini tidak dipakai |
| `TERMOS_MAX_RECORDS` / `TERMOS_MAX_MB` | `20000` / `256` | Kuota per vault (pribadi atau tim) |
| `TERMOS_SIGNUP_PER_HOUR` | `10` | Batas percobaan daftar per IP per jam |

Alur umum untuk tim kecil: mulai dengan `first`, buat akunmu dari aplikasi, ganti ke `invite`, `docker compose up -d`, lalu bagikan kode undangannya.

## Backup

```sh
docker compose exec -T db pg_dump -U termos termos | gzip > termos-$(date +%F).sql.gz
```

Isi backup tetap terenkripsi (ciphertext), tapi simpan juga dengan aman: metadata seperti username dan nama tim terbaca.
Restore: `gunzip -c termos-YYYY-MM-DD.sql.gz | docker compose exec -T db psql -U termos termos`.

## Update

```sh
git pull
docker compose up -d --build
```

Migrasi database berjalan otomatis saat API start.

## Tes

```sh
npm ci
npm test        # menjalankan Postgres sementara di Docker, lalu 21 tes integrasi
```

## API

Semua endpoint JSON di bawah `/api`; yang butuh login memakai `Authorization: Bearer <token>`.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/status` | Mode pendaftaran, jumlah akun |
| POST | `/prelogin` | Parameter KDF untuk username (palsu tapi stabil untuk yang tidak ada) |
| POST | `/register`, `/login`, `/logout` | Akun dan token perangkat |
| GET / DELETE | `/me` | Profil; hapus akun (butuh authKey) |
| POST | `/password` | Ganti password (kunci dibungkus ulang); perangkat lain dikeluarkan |
| GET / DELETE | `/devices`, `/devices/:id` | Daftar dan cabut perangkat |
| GET / POST | `/sync?since=N[&scope=…]` | Tarik / kirim record terenkripsi (last writer wins) |
| GET / POST / DELETE | `/teams`, `/teams/:id`, `/teams/:id/members[/:userId]` | Vault tim |
| GET | `/users/:username/key` | Public key untuk menyegel kunci tim |
| WS | `/share/host`, `/share/join/:id` | Relay berbagi sesi |
