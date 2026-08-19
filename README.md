# Media Monitoring Service — Ingestion, Search & Stats

Backend service untuk sebagian kecil dari sebuah *media monitoring platform*: menerima
**mentions** (artikel dan postingan sosial) dalam jumlah besar, membersihkan datanya,
menyimpannya ke PostgreSQL, lalu menyediakan pencarian dan agregasi yang bisa dipakai
seorang PR analyst untuk membuat chart.

Node.js 20 · TypeScript (strict) · Fastify 5 · PostgreSQL 16 lewat `pg` · Zod · Vitest.
Tanpa ORM — skema ditulis tangan sebagai SQL dan di-commit ke repository.

| Endpoint | Kegunaan |
|---|---|
| `POST /internal/mentions/bulk` | Ingest array mentions: normalisasi, dedup, simpan. **Idempotent** |
| `GET /mentions` | Search: `q`, `source`, `from`, `to`, `page`, `page_size` |
| `GET /mentions/stats?group_by=source` | Jumlah mention per source |
| `GET /mentions/stats?group_by=day` | Jumlah mention per hari (UTC) + `missing_published_at` |
| `GET /health` | Liveness, sekaligus satu ping ke basis data |

**Isi dokumen ini** — mengikuti urutan yang diminta brief:
[Cara menjalankan](#1-cara-menjalankan) ·
[Skema](#2-skema-dan-alasan-pemodelannya) ·
[Deteksi duplikat](#3-aturan-deteksi-duplikat-dan-alasannya) ·
[Asumsi](#4-asumsi) ·
[Trade-off](#5-trade-off-yang-diterima-secara-sadar) ·
[Waktu pengerjaan](#6-waktu-yang-dihabiskan) ·
[Satu minggu tambahan](#7-dengan-satu-minggu-tambahan-saya-akan) ·
[Lampiran](#lampiran-a-referensi-api)

---

## 1. Cara Menjalankan

Dari clone sampai endpoint bisa dipakai. Seluruh langkah di bawah sudah diverifikasi
sekali lagi dari clone yang benar-benar bersih dengan basis data kosong.

### Prasyarat

- **Node.js 20+** — cek: `node --version`
- **PostgreSQL 14+** — lokal, atau lewat Docker. Cek: `psql --version`
- **Docker** (opsional, hanya bila tidak punya PostgreSQL lokal) — cek: `docker --version`
- **`seed_mentions.json`** dari brief, diletakkan di root project

### Langkah 1 — Clone dan pasang dependency

```bash
git clone <repo-url>
cd ta-dzikri-alan-full-stack-people-pixel
npm install
```

### Langkah 2 — Siapkan environment

```bash
cp .env.example .env
```

Isi bawaan `.env.example` sudah cocok untuk PostgreSQL lokal standar:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/media_monitoring
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/media_monitoring_test
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
```

Sesuaikan `DATABASE_URL` bila user atau password PostgreSQL Anda berbeda.

### Langkah 3 — Siapkan basis data

Dibutuhkan **dua** basis data: satu utama, satu khusus pengujian.

Bila memakai PostgreSQL lokal:

```bash
createdb media_monitoring
createdb media_monitoring_test
```

Bila memakai Docker Compose — `media_monitoring` sudah dibuat otomatis lewat
`POSTGRES_DB`, jadi tinggal yang untuk pengujian:

```bash
docker compose up -d
docker compose exec postgres createdb -U postgres media_monitoring_test
```

Lalu jalankan migrasi:

```bash
npm run migrate
```

Perintah itu menjalankan berkas SQL di [migrations/](migrations/) secara berurutan,
tiap berkas dalam satu transaksi, dan mencatat namanya di tabel `schema_migrations`
sehingga menjalankannya dua kali tidak mengulang migrasi yang sudah diterapkan.
Skema tidak pernah dibuat lewat GUI dan tidak digenerate ORM.

Memastikan tabelnya jadi:

```bash
psql "$DATABASE_URL" -c '\d mentions'
```

### Langkah 4 — Jalankan server

```bash
npm run dev
```

Memastikan servernya hidup dan basis datanya tersambung:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

> Root URL (`http://localhost:3000/`) sengaja membalas `404` — ini backend murni,
> tidak ada halaman yang dilayani di sana. Gunakan endpoint pada tabel di atas.

### Langkah 5 — Isi data dan pakai endpoint-nya

Lewat CLI, memakai jalur ingestion yang sama persis dengan endpoint HTTP:

```bash
npm run seed                                  # membaca ./seed_mentions.json
npm run seed -- ./path/lain/ke/file.json      # atau tunjuk path lain
```

Atau lewat HTTP:

```bash
curl -X POST http://localhost:3000/internal/mentions/bulk \
  -H 'Content-Type: application/json' \
  --data-binary @seed_mentions.json
```

Lalu cari dan agregasi:

```bash
curl 'http://localhost:3000/mentions?q=ekonomi&source=kompas&from=2024-03-01&to=2024-03-31&page=1&page_size=20'
curl 'http://localhost:3000/mentions/stats?group_by=source'
curl 'http://localhost:3000/mentions/stats?group_by=day'
```

**Membuktikan idempotency:** jalankan perintah ingest yang sama dua kali. Panggilan
kedua membalas `"inserted": 0` dan jumlah baris di basis data tidak bertambah.

### Langkah 6 — Menjalankan pengujian (opsional)

```bash
npm test
```

67 uji terhadap PostgreSQL sungguhan lewat `TEST_DATABASE_URL` — lihat
[Lampiran B](#lampiran-b-pengujian).

### Langkah 7 — Dashboard (opsional)

```bash
cd dashboard
npm install
cp .env.example .env      # API_BASE_URL=http://localhost:3000
npm run dev
```

Buka [http://localhost:3001](http://localhost:3001). Halaman read-only ini hanya
memanggil `/mentions` dan `/mentions/stats` milik sendiri, tanpa akses basis data
langsung. Sesuai brief, dashboard bersifat opsional dan tidak dinilai.

---

## 2. Skema, dan Alasan Pemodelannya

Satu tabel, [migrations/001_create_mentions.sql](migrations/001_create_mentions.sql):

| Kolom | Tipe | Alasan |
|---|---|---|
| `id` | `bigint` identity PK | Kunci sintetis; sekaligus pemecah seri untuk sort yang stabil |
| `fingerprint` | `bytea` (32 byte) | Kunci dedup; unique index membuat ingest idempotent di level basis data |
| `source` | `text` | Bentuk source yang sudah dinormalkan — dipakai filter dan `group_by=source` |
| `source_raw` | `text` | Ejaan asli, dipakai sebagai label tampilan pada stats |
| `title`, `content` | `text` | Teks bersih tanpa HTML; keduanya kolom pencarian `q` |
| `url`, `url_raw` | `text` | URL kanonik dan versi aslinya |
| `published_at` | `timestamptz` | Selalu UTC; nullable karena sebagian data memang tidak punya tanggal |
| `published_at_raw` | `text` | Diisi hanya ketika parsing gagal — jejak untuk diperbaiki nanti |
| `author` | `text` | Bersih, opsional |
| `engagement` | `integer` | Angka yang datang sebagai string dikonversi; `CHECK >= 0` |
| `raw` | `jsonb` | Payload asli utuh, agar normalisasi bisa ditinjau ulang tanpa ingest ulang |
| `created_at` | `timestamptz` | Waktu masuk ke sistem, berbeda dari waktu terbit |

**Kenapa dimodelkan seperti ini.**

* **Satu tabel datar, bukan tabel `sources` terpisah.** Beban kerjanya adalah *read* —
  cari dan hitung. Menyimpan `source` sebagai teks yang sudah dinormalkan berarti filter
  dan `GROUP BY` tidak butuh join, dan aturan normalisasi bisa berubah tanpa migrasi
  tabel dimensi. Kalau nanti source butuh atribut sendiri (negara, tier, domain), tabel
  itu bisa ditambahkan belakangan tanpa mengubah bentuk tabel ini.
* **Nilai bersih dan nilai mentah berdampingan.** Normalisasi bersifat *lossy* dan
  keputusannya bisa saja salah. `source_raw`, `url_raw`, `published_at_raw`, dan `raw`
  membuat tiap keputusan bisa diaudit dan diperbaiki dari data yang sudah tersimpan —
  tanpa perlu meminta ulang data ke sumbernya.
* **`published_at` boleh NULL, tidak diisi tebakan.** Menaruh nilai palsu (misalnya waktu
  ingest) akan merusak chart deret waktu secara diam-diam. Karena itu barisnya tetap
  disimpan, dikecualikan dari `group_by=day`, dan jumlahnya dilaporkan terpisah sebagai
  `missing_published_at`.
* **`fingerprint` sebagai `bytea`, bukan teks hex.** 32 byte, separuh ukuran hex-nya. Dan
  unique index di kolom inilah tempat aturan idempotency benar-benar ditegakkan — bukan
  pengecekan `SELECT` di aplikasi yang bisa kalah balapan dengan request paralel.
* **Tiga indeks, sesuai tiga pola akses yang nyata.** Unique pada `fingerprint` untuk
  ingest; `(published_at DESC NULLS LAST, id DESC)` persis mengikuti sort default agar
  pagination tidak perlu menyortir ulang; `(source, published_at DESC NULLS LAST)` untuk
  filter source yang digabung dengan rentang tanggal.

---

## 3. Aturan Deteksi Duplikat, dan Alasannya

**Aturannya.** Tiap record diringkas menjadi satu `fingerprint` SHA-256, dan `fingerprint`
adalah unique index. Ada dua strategi, dipilih berdasarkan ada tidaknya URL
([fingerprint.ts](src/features/mentions/normalization/fingerprint.ts)):

1. **Ada URL → URL kanonik.** URL dinormalkan lebih dulu: skema dibuang saat hashing,
   `www.` dihapus, fragment dibuang, parameter tracking (`utm_*`, `fbclid`, `gclid`,
   `ref`, …) dibuang, sisa query diurutkan, trailing slash dipangkas. Artikel yang sama
   yang datang sebagai `http://` dan `https://`, dengan atau tanpa `?utm_source=twitter`,
   menghasilkan fingerprint yang sama.
2. **Tidak ada URL → `source` + `title` + 500 karakter pertama `content`.** Ketiganya
   dilipat ke bentuk pembanding: huruf kecil, tanda baca dan simbol diganti spasi, spasi
   dirapatkan. Perbedaan tanda kutip, tanda baca, atau kapitalisasi tidak lagi
   menghasilkan baris kedua.

Dedup dijalankan **dua lapis**: di dalam batch (map berbasis fingerprint sebelum insert)
dan di basis data (`ON CONFLICT (fingerprint) DO NOTHING`). Laporan ingest memisahkan
keduanya lewat `duplicate_breakdown`, sehingga terlihat mana duplikat yang datang dalam
satu file dan mana yang sudah pernah masuk sebelumnya.

**Kenapa aturan ini.**

* **URL adalah identitas yang paling dekat dengan kenyataan.** Untuk artikel berita, URL
  kanonik *adalah* artikelnya. Duplikat pada data ingestion hampir selalu berupa URL yang
  sama dengan pembungkus berbeda — skema, `www.`, atau parameter tracking dari kanal
  distribusi yang berlainan.
* **Fallback dibatasi per-source, bukan lintas-source.** Tanpa URL, dua source yang
  meliput peristiwa sama dengan judul mirip adalah **dua mention sungguhan** bagi seorang
  PR analyst — bukan duplikat. Karena itu `source` ikut masuk ke hash pada strategi kedua.
* **Prefix 500 karakter, bukan seluruh content.** Ingestion sering memotong atau
  memanjangkan body (paragraf boilerplate, teks "baca juga" yang menempel). Membandingkan
  seluruh isi membuat dedup rapuh terhadap perbedaan di ekor teks, sementara paragraf
  pembuka praktis stabil.
* **Ditegakkan di basis data, bukan di aplikasi.** Unique index tetap benar meskipun dua
  worker mengirim batch yang sama secara bersamaan. Pola "cek dulu lalu insert" akan lolos
  pada kondisi itu.
* **Fingerprint diberi versi (`v1`).** Bila aturannya berubah, prefiks itu naik menjadi
  `v2` dan baris lama bisa dihitung ulang dari kolom `raw` — dedup bukan keputusan sekali
  seumur hidup.

**Yang sengaja tidak dilakukan:** *fuzzy matching* (trigram, MinHash, cosine similarity).
Cara itu menangkap parafrase dan artikel sindikasi, tetapi menuntut ambang batas yang
harus disetel dan berisiko menggabungkan dua mention berbeda secara diam-diam. Untuk data
ini, kecocokan persis atas nilai yang sudah dinormalkan sudah menutup duplikat yang
benar-benar ada — dan ketika salah, salahnya bisa dijelaskan.

---

## 4. Asumsi

Bagian-bagian yang tidak dijelaskan spesifik di brief, dan keputusan yang saya ambil.

* **Nama field bervariasi.** Ingestion menerima beberapa alias per konsep
  (`source`/`source_name`/`publisher`, `title`/`headline`,
  `content`/`body`/`text`/`description`, `url`/`link`/`permalink`,
  `published_at`/`date`/`created_at`, `engagement`/`reach`/`views`), memakai nilai pertama
  yang terisi, dan menyimpan sisanya di `raw`.
* **Record minimum.** Sebuah record dianggap valid bila punya `source` dan setidaknya
  salah satu dari `title` atau `content`. Selain itu ditolak **per-record** dan dilaporkan
  berikut indeksnya — satu record rusak tidak menggagalkan seluruh batch.
* **Data diperlakukan sebagai data media Indonesia.** Parser tanggal mengenali nama bulan
  Inggris dan Indonesia (termasuk ejaan lama `Peb`/`Nop`), dan label zona waktu lokal
  `WIB`/`WITA`/`WIT` digeser ke UTC (−7/−8/−9 jam) alih-alih diabaikan. Mengabaikannya
  akan menyimpan jam dinding lokal sebagai UTC dan menggeser artikel sampai sembilan jam.
  Offset numerik yang eksplisit selalu menang atas label.
* **Pemisah ribuan dibaca, bukan ditebak.** `"1,234"`, `"1.240"`, dan `"1 240"` sama-sama
  menjadi integer, begitu pula sufiks `"12rb"`, `"1.2K"`, `"1,5 jt"`. Nilai yang mencampur
  dua gaya sekaligus (`"1.240,5"` — jelas sebuah desimal) ditolak menjadi NULL, bukan
  dipotong diam-diam.
* **Tanggal relatif sengaja tidak diurai.** `"2 jam yang lalu"` dan `"kemarin"` hanya bisa
  diartikan relatif terhadap waktu ingest, sehingga hasilnya berbeda tiap kali batch yang
  sama diulang — persis yang merusak idempotency ketika pipeline melakukan retry.
* **Tanggal tanpa zona waktu dianggap UTC**, dan `group_by=day` juga mengelompokkan dalam
  UTC agar keduanya konsisten.
* **`DD/MM/YYYY`, bukan `MM/DD/YYYY`.** Untuk tanggal bergaris miring yang ambigu
  (`03/04/2024`) dipilih *day-first*, dan keputusannya berupa satu konstanta bernama
  (`AMBIGUOUS_SLASH_DATE_ORDER`) supaya mudah dibalik. Bila salah satu angka lebih besar
  dari 12, urutannya disimpulkan dari angka itu.
* **Tanggal yang tidak bisa diurai bukan alasan membuang data.** Barisnya tetap masuk
  dengan `published_at` NULL dan teks aslinya tersimpan di `published_at_raw`.
* **Nama source dinormalkan agresif.** Huruf kecil, non-alfanumerik dibuang, bentuk domain
  dipangkas ke label pertama — `TechCrunch`, `techcrunch.com`, dan
  `https://www.TechCrunch.com/` menjadi satu kunci `techcrunch`. Query `?source=` melewati
  normalisasi yang sama, sehingga filternya cocok apa pun bentuk yang diketik.
* **Rentang tanggal.** `from` inklusif; `to` yang ditulis sebagai tanggal saja
  (`2024-03-31`) diperlakukan sebagai akhir hari itu, sehingga rentangnya mencakup
  keseluruhan tanggal tersebut.
* **`q` adalah pencarian substring**, case-insensitive, atas `title` dan `content`;
  karakter `%` dan `_` di-escape agar dianggap literal.
* **Bulk ingest terbuka tanpa autentikasi** sesuai brief; prefiks `/internal` menandakan
  endpoint itu semestinya hanya dijangkau dari jaringan internal.
* **Ukuran batch dibatasi 50.000 record** dan body 16 MB — cukup untuk file seed sekaligus
  mencegah satu permintaan menghabiskan memori.

---

## 5. Trade-off yang Diterima Secara Sadar

* **`ILIKE '%q%'`, bukan full-text search.** Sederhana, hasilnya bisa ditebak, dan cocok
  untuk substring parsial pada nama brand — tetapi tidak bisa memakai indeks dan akan
  melambat pada jutaan baris. Perbaikannya sudah jelas: kolom `tsvector` dan indeks GIN,
  atau `pg_trgm`. Pada skala data ini, biaya itu belum terbayar. Alasan tambahan: tidak
  ada *stemmer* bahasa Indonesia di PostgreSQL, sehingga FTS justru lebih buruk untuk
  pencarian nama brand parsial.
* **Pagination `LIMIT`/`OFFSET`, bukan keyset.** `OFFSET` besar makin mahal, tetapi API-nya
  bisa memberi `total` dan `total_pages` yang dibutuhkan dashboard, dan sort key
  `(published_at, id)` sudah siap dipakai bila nanti pindah ke keyset.
* **SQL manual lewat `pg`, bukan ORM.** Brief meminta skema yang terlihat; imbalannya
  query eksplisit dan bisa dibaca, biayanya penulisan mapping baris ke resource secara
  manual.
* **Runner migrasi buatan sendiri (~60 baris) alih-alih dependency.** Menghindari satu
  dependency dan lapisan konfigurasi untuk kebutuhan yang kecil; imbalannya tidak ada
  `down`-migration — untuk saat ini rollback berarti menulis migrasi baru.
* **Seluruh batch dinormalkan di memori sebelum insert.** Sederhana dan membuat dedup
  dalam batch mudah; pada file berukuran ratusan MB ini harus menjadi streaming.
* **Satu transaksi untuk seluruh batch.** Ingest bersifat atomik — semua atau tidak sama
  sekali — dengan konsekuensi transaksi menjadi panjang pada batch besar.
* **Uji integrasi menuntut PostgreSQL sungguhan.** Menjalankan suite butuh basis data
  hidup, jadi lebih lambat daripada mock; tetapi yang diuji adalah perilaku yang memang
  berisiko — unique index, `ON CONFLICT`, `NULLS LAST`, dan `date_trunc` — dan semuanya
  justru hilang bila di-mock.
* **`engagement` sebagai `integer`.** Cukup sampai ~2,1 miliar; nilai yang melebihi itu
  disimpan NULL alih-alih meluap. `bigint` akan lebih aman untuk metrik *reach* yang
  sangat besar.
* **Stats tidak di-cache dan tidak menerima filter.** `group_by` selalu menghitung seluruh
  tabel. Untuk dashboard yang perlu mengikuti filter pencarian, agregasinya harus menerima
  parameter filter yang sama.

---

## 6. Waktu yang Dihabiskan

* **Perkiraan waktu:** ±10 jam.
* **Jumlah sesi:** 2 sesi (19 dan 20 Agustus 2026).

Porsi terbesar habis di normalisasi dan pemilihan aturan duplicate.

**Catatan jujur soal data.** `seed_mentions.json` tidak tersedia pada working copy ini,
sehingga aturan normalisasi dan dedup dikembangkan terhadap
[tests/fixtures/messy-mentions.json](tests/fixtures/messy-mentions.json) — fixture yang
saya tulis sendiri, berisi satu record untuk tiap kategori kekacauan yang disebut brief
(§4), ditambah bentuk-bentuk yang khas pada media Indonesia. Begitu file seed asli
diletakkan di root, `npm run inspect:seed` memprofilkannya (source, format tanggal, HTML,
duplikat) dan `npm run seed` mengalirkannya lewat pipeline yang sama persis dengan
endpoint HTTP. Tidak ada keputusan desain yang bergantung pada isi file yang belum pernah
saya lihat; yang akan menyesuaikan setelah file itu masuk adalah daftar format tanggal dan
alias field — keduanya terpusat di satu berkas.

---

## 7. Dengan Satu Minggu Tambahan, Saya Akan...

**Mengganti `ILIKE` dengan full-text search PostgreSQL** — kolom `tsvector` yang
di-*generate*, indeks GIN, dan peringkat relevansi. Ini batasan pertama yang akan terasa
oleh seorang analyst begitu data bertambah, sekaligus perubahan yang mengubah bentuk query
*dan* skema — jadi paling murah dikerjakan lebih awal, sebelum ada data besar yang harus
dimigrasikan.

Berikutnya, sesuai urutan prioritas:

2. Menerima filter yang sama (`q`, `source`, `from`, `to`) pada endpoint stats, supaya
   chart mengikuti pencarian yang sedang aktif.
3. Pindah ke keyset pagination untuk halaman-halaman jauh, dengan `LIMIT`/`OFFSET`
   dipertahankan untuk permintaan yang memang butuh `total`.
4. Ingestion streaming plus insert per-chunk, agar file berukuran besar tidak perlu masuk
   memori sekaligus.
5. Endpoint kecil untuk meninjau record yang `published_at_raw`-nya terisi — daftar kerja
   untuk format tanggal yang belum tertangani.
6. Aturan dedup yang bisa diatur per-source, plus job perhitungan ulang fingerprint dari
   kolom `raw` ketika aturannya naik ke `v2`.

---

## Lampiran A — Referensi API

**Urutan sortir.** `GET /mentions` selalu mengurutkan
`ORDER BY published_at DESC NULLS LAST, id DESC`. Mention terbaru muncul lebih dulu,
mention tanpa tanggal jatuh ke akhir, dan `id` (kunci primer yang selalu unik) memecah
seri sehingga urutannya deterministik — dua baris dengan `published_at` identik tidak akan
pernah bertukar tempat antar permintaan, dan halaman berikutnya tidak pernah mengulang
atau melewati baris.

**Parameter search.** `q` (maks 200 karakter), `source`, `from`, `to`, `page` (mulai 1),
`page_size` (1–100, default 20). Skema query bersifat `.strict()`: parameter tak dikenal,
`page_size` di luar batas, `from > to`, dan `group_by` yang tidak didukung dibalas `400`
berisi detail per-field — bukan gagal diam-diam atau membalas hasil kosong.

**Balasan ingestion.** Bulk ingest membalas `200` berisi laporan, bukan sekadar status:

```json
{
  "received": 120,
  "accepted": 118,
  "rejected": 2,
  "inserted": 97,
  "duplicates": 21,
  "duplicate_breakdown": { "within_batch": 9, "already_stored": 12 },
  "errors": [{ "index": 44, "reason": "record must contain a title or content" }]
}
```

Record yang tidak bisa dinormalkan ditolak per-record dan dilaporkan bersama indeksnya
(maksimal 50 entri pertama).

---

## Lampiran B — Pengujian

```bash
npm test
```

67 uji dalam 4 berkas, dijalankan terhadap `TEST_DATABASE_URL` — basis data sungguhan,
bukan mock. Tabelnya dikosongkan tiap kali suite berjalan dan terpisah dari basis data
pengembangan.

| Berkas | Yang dicakup |
|---|---|
| [tests/normalization.test.ts](tests/normalization.test.ts) | Pembersihan HTML dan entity, penyamaan nama source, kanonikalisasi URL, beragam format tanggal (ISO, epoch, garis miring ambigu, nama bulan Inggris dan Indonesia, label `WIB`/`WITA`/`WIT`), angka berbentuk string (pemisah ribuan `,` `.` dan spasi, sufiks `k`/`rb`/`jt`), penolakan record |
| [tests/ingestion.test.ts](tests/ingestion.test.ts) | Idempotency, dedup di dalam batch, kedua strategi fingerprint, penolakan per-record, isi laporan |
| [tests/search.test.ts](tests/search.test.ts) | Tiap filter dan kombinasinya, batas pagination, stabilitas urutan termasuk baris tanpa tanggal |
| [tests/stats.test.ts](tests/stats.test.ts) | Hitungan per source dan per hari, `missing_published_at`, validasi `group_by` |

Sesuai brief, cakupannya sengaja tidak menyeluruh — ujinya diarahkan ke logika yang paling
berisiko: normalisasi, dedup, dan stabilitas urutan.

---

## Lampiran C — Struktur dan Skrip

```
migrations/          DDL yang di-commit, dijalankan berurutan oleh runner sendiri
scripts/             migrate, seed, inspect-seed
src/
  app.ts             Perakitan Fastify, error handler, route /health
  config.ts          Konfigurasi dari environment, divalidasi Zod
  db/                Connection pool dan runner migrasi
  features/mentions/ types → validation → normalization → repositories
                     → services → controllers → routes
tests/               Uji normalisasi (unit) dan uji endpoint (integrasi)
dashboard/           Halaman read-only Next.js, opsional
```

```bash
npm run dev              # Server pengembangan dengan hot-reload (tsx watch)
npm run build            # Kompilasi TypeScript ke dist/
npm run start            # Menjalankan server hasil kompilasi
npm run migrate          # Menerapkan migrasi SQL yang belum dijalankan
npm run seed             # Ingest seed_mentions.json lewat pipeline bulk
npm run inspect:seed     # Memprofilkan file seed: source, format tanggal, HTML, duplikat
npm test                 # Menjalankan seluruh uji sekali
npm run test:watch       # Menjalankan uji dalam mode watch
npm run typecheck        # Pemeriksaan tipe tanpa menghasilkan output
```
