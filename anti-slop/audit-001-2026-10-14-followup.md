# Follow-up audit 001 (2026-10-14)

Disetujui: semua nomor 1-14 ("ganti UI-nya dulu"). Arah: `DESIGN.md`.
Design Read: aplikasi desktop SSH/Proxmox untuk sysadmin, bahasa visual alat kerja, dial ENERGY 1 / RHYTHM 1 / MOTION 1.

## Status per temuan

| No | Temuan | Status | Bukti |
|---|---|---|---|
| 1 | Kontras teks (R-25) | Diperbaiki | Palet baru diukur: teks redup 4.57-6.14:1 di semua latar, teks utama >= 10.9:1, tulisan di tombol amber 8.1:1, merah 4.5:1 atau lebih |
| 2 | Keyboard (R-32) | Diperbaiki | Tab sesi, baris SFTP, header node Proxmox jadi `<button>`; baris host `tabIndex=0` + Enter menghubungkan (dites E2E); aksi baris selalu terlihat; satu gaya `:focus-visible` untuk semua kontrol; modal memindahkan fokus ke dalam dan tutup dengan Esc; pintasan Ctrl+1..8 (dites E2E) |
| 3 | Em dash (R-02) | Diperbaiki | `grep -rn "—"` di `src/renderer` dan teks UI di `src/main` tidak menemukan apa pun; deskripsi paket diganti |
| 4 | Logo tanpa instruksi (R-23) | Diperbaiki | Kotak "T" bergradien dihapus; diganti wordmark teks "Termos" sampai ada logo resmi |
| 5 | Emoji (R-04) | Diperbaiki | Semua emoji dihapus dari menu, tombol, empty state, ikon file, dan avatar |
| 6 | Tombol simbol (R-04) | Diperbaiki | Aksi Proxmox dan host jadi label teks: Start, Shutdown, Reboot, Suspend, Console, Snapshot, Stop paksa (dipisah, warna merah), Edit, Duplikat, Hapus |
| 7 | Cahaya radial (R-01) | Diperbaiki | Latar layar kunci polos |
| 8 | Tipografi default (R-06) | Diperbaiki | Font sistem untuk UI, monospace sistem hanya untuk terminal/alamat/fingerprint; judul seksi tanpa huruf kapital berspasi |
| 9 | Grid kartu seragam (R-14, R-05, C-3) | Diperbaiki | Host jadi tabel padat (nama, alamat, protokol, tag, terakhir) dengan kolom yang bisa diurutkan; seksi "Terakhir dipakai" dihapus (diganti sortir kolom); Keychain, Snippets, Forwarding, Known hosts, Riwayat, VM/CT Proxmox juga jadi tabel |
| 10 | Bayangan (R-12) | Diperbaiki | Bayangan hanya di modal (satu-satunya permukaan yang melayang) |
| 11 | Terlalu banyak warna (R-29) | Diperbaiki | Grafit netral + amber + hijau/merah status saja; pil VM/CT berwarna dan palet avatar dihapus |
| 12 | Aksen di mana-mana (R-20) | Diperbaiki | Amber hanya untuk tombol aksi utama per layar dan penanda tab sesi aktif; tombol "Hubungkan" per baris memakai gaya biasa; kursor terminal netral |
| 13 | Identitas generik (R-20) | Diperbaiki | Motif: tabel padat + label teks + petunjuk pintasan di menu + satu amber |
| 14 | Tab "Vault" (C-1) | Diperbaiki | Tab pertama menampilkan nama halaman yang terbuka (Hosts, Keychain, ...) |

## Delivery Gate

### Block 1: Hard Gate
- R-02 PASS: tidak ada em dash di teks UI.
- R-03 N/A: aplikasi desktop, lebar minimum jendela 820px, tidak ada target mobile.
- R-17 / R-18 / R-36 / R-38 PASS: tidak ada angka, testimoni, atau klaim karangan; data hanya dari vault dan API Proxmox.
- R-23 PASS: logo karangan dihapus, wordmark teks sebagai placeholder.
- R-24 / R-26 PASS: semua item menu punya halaman; semua tombol punya aksi (lihat click-through).
- R-25 PASS: semua pasangan teks/latar >= 4.5:1 (dihitung).
- R-27 PASS: empty, loading, error state di Hosts, SFTP, Proxmox, Forwarding, Known hosts, Riwayat menyebut penyebab dan langkah berikutnya.
- R-28 N/A: tidak ada FAQ.
- R-32 PASS: lihat nomor 2.
- R-33 PASS: semua perubahan langsung di source; tidak ada skrip patch di repo.
- R-34 N/A: hanya satu tema UI (gelap, sesuai DESIGN.md); tema terminal bisa diganti per host.
- R-35 PASS: build dijalankan, tes E2E 23/23 lolos, 0 error renderer. Click-through yang direkam:
  buat vault -> workspace tampil; Terminal lokal -> tab baru, `echo` kembali; SSH key baru -> key Ed25519 muncul di tabel;
  Host baru -> tersimpan; Enter pada baris host -> dialog host key -> Percayai -> dialog password -> Kirim -> sesi tersambung dan echo kembali;
  Snippet baru -> tersimpan; Proxmox -> Server baru -> editor terbuka -> Batal; menu Port forwarding, Known hosts, Riwayat, Settings -> tampil; Ctrl+2 -> Keychain.
- R-37 PASS: DESIGN.md ada, dari pilihan pemilik produk.

### Block 2: Purpose-Gate
- R-01, R-04, R-06, R-07, R-08, R-09, R-10, R-12, R-13, R-14, R-19, R-22: PASS. Tidak ada gradien, emoji, glass, glow, grid latar, panah dekoratif, badge kapsul, ilustrasi, atau animasi. Panah ↑/↓ hanya di header kolom untuk arah sortir.

### Block 3: Liveliness
- Dial dinyatakan: ENERGY 1 / RHYTHM 1 / MOTION 1; ritme seragam memang disengaja untuk memindai tabel.
- Satu fokus per layar: tombol amber aksi utama.
- Satu aksen: amber.
- Motif identitas: tabel padat + label teks + pintasan Ctrl+N di menu.

### Block 4: Craftsmanship
- PASS untuk C-1..C-5, R-05, R-11 (radius 4px seragam, 6px untuk modal), R-15, R-16, R-20, R-21, R-29, R-30, R-31.

## Belum dicek / catatan jujur
- Belum ada tes pembaca layar (screen reader) sungguhan.
- SFTP, port forwarding, Telnet/Serial/Mosh, dan Proxmox masih belum dites ke server sungguhan.
