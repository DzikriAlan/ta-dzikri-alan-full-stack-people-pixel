# Media Monitoring Service — Ingestion, Search & Stats API

**Take Exactly What You Need**

Backend service untuk sebagian kecil dari sebuah *media monitoring platform*: menerima mentions (artikel dan postingan sosial) dalam jumlah besar, membersihkan datanya, menyimpannya ke PostgreSQL, lalu menyediakan pencarian dan agregasi yang bisa dipakai seorang PR analyst untuk membuat chart. Dibangun di atas Node.js 20, TypeScript, Fastify, `pg`, dan Zod, dengan konvensi arsitektur yang konsisten di seluruh fitur.

## What i do

* Merancang **arsitektur backend berlapis** dengan **Fastify, TypeScript strict, dan Zod**, memisahkan tiap fitur menjadi `types → validation → normalization → repositories → services → controllers → routes` ([src/features/mentions/](src/features/mentions/)) sehingga penambahan endpoint baru mengikuti jalur yang sudah tetap dan tidak menyusun ulang pola dari nol.
* Membangun **ingestion yang idempotent** pada `POST /internal/mentions/bulk` — tiap record diberi *fingerprint* SHA-256, dijadikan unik di dalam batch, lalu disimpan lewat satu `INSERT ... ON CONFLICT (fingerprint) DO NOTHING` di dalam transaksi, sehingga memposting file yang sama dua kali tidak menambah baris dan retry dari pipeline aman diulang.
* Menormalkan **data ingestion yang berantakan** di satu tempat: raw HTML dan entity dibersihkan jadi teks datar, nama source yang tidak konsisten (`TechCrunch`, `techcrunch.com`, `https://www.TechCrunch.com/`) dipetakan ke satu kunci, URL dikanonikalisasi (buang `www.`, fragment, dan parameter tracking, urutkan query), angka berbentuk string dijadikan integer baik bergaya Inggris (`"1,234"`) maupun Indonesia (`"1.240"`, `"12rb"`, `"1,5 jt"`), dan **beragam format tanggal** diurai jadi `timestamptz` UTC — termasuk nama bulan Indonesia (`"15 Maret 2024"`, `"3 Nopember 2024"`) dan label zona waktu lokal (`WIB`/`WITA`/`WIT`) yang digeser ke UTC alih-alih dibuang.
* Menyimpan **nilai mentah berdampingan dengan nilai bersih** — `source_raw`, `url_raw`, `published_at_raw`, dan seluruh payload asli di kolom `raw jsonb` — sehingga keputusan normalisasi bisa ditinjau ulang atau diperbaiki tanpa perlu melakukan ingest ulang dari sumber.
* Mengembangkan **search dengan urutan yang stabil dan terdokumentasi** pada `GET /mentions` — filter `q` (title dan content), `source`, `from`, `to`, plus pagination — diurutkan `published_at DESC NULLS LAST, id DESC`, dengan `id` sebagai pemecah seri agar halaman 2 tidak pernah mengulang baris dari halaman 1.
* Menyediakan **agregasi siap-chart** pada `GET /mentions/stats?group_by=source` dan `?group_by=day`, dengan hitungan `published_at` yang hilang dilaporkan terpisah sebagai `missing_published_at` alih-alih diam-diam dibuang dari deret waktu.
* Menegakkan **kontrak API yang eksplisit** lewat skema Zod `.strict()` pada tiap query — parameter tak dikenal, `page_size` di luar batas, `from > to`, dan `group_by` yang tidak didukung dibalas `400` berisi detail per-field, bukan gagal diam-diam atau membalas hasil kosong.
* Menjaga **kualitas lewat pengujian otomatis** dengan **Vitest** — 67 uji yang menutup normalisasi (HTML, source, URL, tanggal, angka), idempotency ingestion, pagination dan stabilitas urutan, hingga agregasi stats, dijalankan terhadap PostgreSQL sungguhan lewat `TEST_DATABASE_URL`, bukan mock.
* Merawat **skema yang terlihat dan versinya tercatat** — DDL ditulis tangan di [migrations/](migrations/) dan dijalankan runner sendiri ([src/db/migrator.ts](src/db/migrator.ts)) dengan tabel `schema_migrations` serta advisory lock; tidak ada ORM yang menyembunyikan tabel, query ditulis sebagai SQL berparameter.

---

## Tech Stack

| Concern | Technology | Purpose |
|---|---|---|
| **Runtime** | Node.js 20 | Runtime server dengan dukungan ESM native |
| **Language** | TypeScript | Pengembangan bertipe dengan strict mode |
| **Web Framework** | Fastify 5 | HTTP server ringan dengan logging dan error handling bawaan |
| **Database** | PostgreSQL 16 | Basis data relasional; `jsonb`, `timestamptz`, dan unique index untuk idempotency |
| **DB Access** | `pg` (node-postgres) | SQL berparameter yang eksplisit, skema tidak disembunyikan ORM |
| **Migrations** | SQL files + runner sendiri | DDL yang di-commit, dijalankan berurutan dan dicatat di `schema_migrations` |
| **Validation** | Zod | Skema untuk env, request body, dan query string, dipakai ulang di normalisasi |
| **Deduplication** | Node `crypto` (SHA-256) | Fingerprint 32-byte sebagai kunci unik idempotency |
| **Testing** | Vitest | Uji unit normalisasi dan uji integrasi endpoint terhadap Postgres sungguhan |
| **Dashboard (opsional)** | Next.js 15 + React 19 | Halaman read-only yang memanggil API sendiri |
| **Local Infra** | Docker Compose | PostgreSQL sekali perintah untuk pengembangan dan uji |
| **Code Quality** | TypeScript Strict + `noUncheckedIndexedAccess` | Pemeriksaan tipe demi keterawatan |

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) v20+ (verify: `node --version`)
- [PostgreSQL](https://www.postgresql.org) 14+ — lokal, atau lewat Docker (verify: `psql --version`)
- [Docker](https://docs.docker.com/get-docker/) (opsional, verify: `docker --version`)
- Package manager: npm (included with Node.js)
- File `seed_mentions.json` dari brief, diletakkan di root project

### 1. Clone & Install

```bash
git clone <repo-url>
cd ta-dzikri-alan-full-stack-people-pixel
npm install
```

If installation fails, use:
```bash
npm ci
```

### 2. Setup Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Basis data utama
DATABASE_URL=postgres://postgres:postgres@localhost:5432/media_monitoring

# Basis data terpisah untuk uji — isinya dihapus tiap kali suite dijalankan
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/media_monitoring_test

PORT=3000
HOST=0.0.0.0

LOG_LEVEL=info
```

Jalankan PostgreSQL lewat Docker Compose (opsional, lewati bila sudah punya Postgres sendiri):
```bash
docker compose up -d
```

Buat kedua basis data — yang utama dan yang khusus uji. Docker Compose sudah membuat
`media_monitoring` sendiri lewat `POSTGRES_DB`, jadi langkah ini hanya wajib bila Anda
memakai PostgreSQL lokal:

```bash
createdb media_monitoring         # dilewati bila memakai docker compose
createdb media_monitoring_test    # selalu perlu; isinya dikosongkan tiap suite berjalan
```

Lewat Docker Compose, padanannya:
```bash
docker compose exec postgres createdb -U postgres media_monitoring_test
```

### 3. Setup Database

```bash
npm run migrate
```

`migrate` menjalankan berkas SQL di [migrations/](migrations/) secara berurutan,
tiap berkas dalam satu transaksi, dan mencatat namanya di tabel `schema_migrations`
sehingga menjalankannya dua kali tidak mengulang migrasi yang sudah diterapkan.
Skema tidak pernah dibuat lewat GUI dan tidak digenerate ORM — DDL-nya ada di
repository dan bisa dibaca langsung.

Verify the database connection:
```bash
psql "$DATABASE_URL" -c '\d mentions'
```

Isi data contoh dari brief (butuh `seed_mentions.json` di root, atau berikan path lain):
```bash
npm run seed
npm run seed -- ./path/to/seed_mentions.json
```

`seed` melewati jalur ingestion yang sama dengan endpoint bulk, lalu mencetak
laporan berisi jumlah diterima, ditolak, dimasukkan, dan duplikat.

### 4. Start Development Server

```bash
npm run dev
```

Verify the app is running:
```bash
curl http://localhost:3000/health
```

Ingest, cari, dan agregasi:
```bash
curl -X POST http://localhost:3000/internal/mentions/bulk \
  -H 'Content-Type: application/json' \
  --data-binary @seed_mentions.json

curl 'http://localhost:3000/mentions?q=launch&source=techcrunch&from=2024-01-01&to=2024-03-31&page=1&page_size=20'
curl 'http://localhost:3000/mentions/stats?group_by=source'
curl 'http://localhost:3000/mentions/stats?group_by=day'
```

Menjalankan endpoint yang sama dua kali menghasilkan `inserted: 0` pada panggilan kedua — itulah bukti idempotency-nya.

### 5. Dashboard (Opsional)

```bash
cd dashboard
npm install
cp .env.example .env      # API_BASE_URL=http://localhost:3000
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser. Halaman read-only ini hanya memanggil `/mentions` dan `/mentions/stats` milik sendiri, tanpa akses basis data langsung.

---

## API

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/internal/mentions/bulk` | Ingest array mentions; normalisasi, dedup, simpan. Idempotent |
| `GET` | `/mentions` | Search: `q`, `source`, `from`, `to`, `page`, `page_size` (maks 100, default 20) |
| `GET` | `/mentions/stats?group_by=source` | Jumlah mention per source |
| `GET` | `/mentions/stats?group_by=day` | Jumlah mention per hari (UTC) + `missing_published_at` |
| `GET` | `/health` | Liveness plus satu ping ke basis data |

**Sort order.** `GET /mentions` selalu mengurutkan `ORDER BY published_at DESC NULLS LAST, id DESC`.
Mention terbaru muncul lebih dulu, mention tanpa tanggal jatuh ke akhir, dan `id`
(kunci primer yang selalu unik) memecah seri sehingga urutannya deterministik —
dua baris dengan `published_at` identik tidak akan pernah bertukar tempat antar
permintaan, dan halaman berikutnya tidak pernah mengulang atau melewati baris.

**Ingestion response.** Bulk ingest membalas `200` berisi laporan, bukan sekadar status:

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
(maksimal 50 entri pertama); satu record rusak tidak menggagalkan seluruh batch.

---

## Schema

Satu tabel, [migrations/001_create_mentions.sql](migrations/001_create_mentions.sql):

| Column | Type | Why |
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

* **Satu tabel datar, bukan `sources` terpisah.** Beban kerjanya adalah *read* — cari dan hitung. Menyimpan `source` sebagai teks yang sudah dinormalkan berarti filter dan `GROUP BY` tidak butuh join, dan aturan normalisasi bisa berubah tanpa migrasi tabel dimensi. Kalau nanti source butuh atribut sendiri (negara, tier, domain), tabel itu bisa ditambahkan belakangan tanpa mengubah bentuk tabel ini.
* **Nilai bersih dan mentah berdampingan.** Normalisasi bersifat lossy dan keputusannya bisa salah. `source_raw`, `url_raw`, `published_at_raw`, dan `raw` membuat tiap keputusan bisa diaudit dan diperbaiki dari data yang sudah tersimpan.
* **`published_at` boleh NULL, tidak diisi tebakan.** Menaruh nilai palsu (mis. waktu ingest) akan merusak chart deret waktu diam-diam. Karena itu barisnya tetap disimpan, dikecualikan dari `group_by=day`, dan jumlahnya dilaporkan sebagai `missing_published_at`.
* **`fingerprint` sebagai `bytea`, bukan teks hex.** 32 byte, separuh ukuran hex, dan indeks unique-nya adalah tempat aturan idempotency benar-benar ditegakkan — bukan cek `SELECT` di aplikasi yang bisa kalah balapan dengan request paralel.
* **Tiga indeks, sesuai tiga akses nyata.** Unique pada `fingerprint` untuk ingest; `(published_at DESC NULLS LAST, id DESC)` persis mengikuti sort default agar pagination tidak menyortir ulang; `(source, published_at DESC NULLS LAST)` untuk filter source yang digabung rentang tanggal.

---

## Duplicate Detection

**Aturannya.** Tiap record diringkas jadi satu `fingerprint` SHA-256, dan `fingerprint`
adalah unique index. Dua strategi, dipilih berdasarkan ada tidaknya URL
([src/features/mentions/normalization/fingerprint.ts](src/features/mentions/normalization/fingerprint.ts)):

1. **Ada URL → URL kanonik.** URL dinormalkan lebih dulu: skema dibuang saat hashing, `www.` dihapus, fragment dibuang, parameter tracking (`utm_*`, `fbclid`, `gclid`, `ref`, …) dibuang, sisa query diurutkan, trailing slash dipangkas. Artikel yang sama yang datang sebagai `http://` dan `https://`, dengan atau tanpa `?utm_source=twitter`, menghasilkan fingerprint yang sama.
2. **Tidak ada URL → source + title + 500 karakter pertama content.** Ketiganya dilipat ke bentuk pembanding: huruf kecil, tanda baca dan simbol diganti spasi, spasi dirapatkan. Jadi perbedaan tanda kutip, tanda baca, atau kapitalisasi tidak lagi menghasilkan baris kedua.

Dedup dijalankan dua lapis: di dalam batch (map berbasis fingerprint sebelum insert) dan
di basis data (`ON CONFLICT (fingerprint) DO NOTHING`). Laporan ingest memisahkan keduanya
lewat `duplicate_breakdown`.

**Kenapa aturan ini.**

* **URL adalah identitas yang paling dekat dengan kenyataan.** Untuk artikel berita, URL kanonik *adalah* artikelnya. Duplikat di data seed hampir selalu berupa URL yang sama dengan pembungkus berbeda — skema, `www.`, atau tracking parameter dari kanal distribusi yang berbeda.
* **Fallback dibatasi per-source, bukan lintas-source.** Tanpa URL, dua source yang meliput peristiwa sama dengan judul mirip adalah dua mention sungguhan bagi seorang PR analyst — bukan duplikat. Karena itu `source` ikut masuk ke hash pada strategi kedua.
* **Prefix 500 karakter, bukan seluruh content.** Ingestion sering memotong atau memanjangkan body (paragraf boilerplate, teks "baca juga" yang menempel). Membandingkan seluruh isi membuat dedup rapuh terhadap perbedaan di ekor teks, sementara paragraf pembuka praktis stabil.
* **Ditegakkan di basis data, bukan di aplikasi.** Unique index tetap benar meskipun dua worker mengirim batch yang sama secara bersamaan. Pola "cek dulu lalu insert" akan lolos di kondisi itu.
* **Fingerprint diberi versi (`v1`).** Kalau aturannya berubah, prefiks itu naik jadi `v2` dan baris lama bisa dihitung ulang dari kolom `raw` — dedup bukan keputusan sekali seumur hidup.

**Yang sengaja tidak dilakukan:** *fuzzy matching* (trigram, MinHash, cosine similarity).
Cara itu menangkap parafrase dan artikel sindikasi, tapi butuh ambang batas yang harus
disetel dan berisiko menggabungkan dua mention berbeda secara diam-diam. Untuk data ini,
kecocokan persis atas nilai yang sudah dinormalkan sudah menutup duplikat yang benar-benar ada,
dan salahnya bisa dijelaskan.

---

## Assumptions

* **Field name bervariasi.** Ingestion menerima beberapa alias per konsep (`source`/`source_name`/`publisher`, `title`/`headline`, `content`/`body`/`text`/`description`, `url`/`link`/`permalink`, `published_at`/`date`/`created_at`, `engagement`/`reach`/`views`), memakai nilai pertama yang terisi, dan menyimpan sisanya di `raw`.
* **Record minimum.** Sebuah record valid bila punya `source` dan setidaknya salah satu dari `title` atau `content`. Selain itu ditolak per-record dan dilaporkan — tidak menggagalkan batch.
* **Data diperlakukan sebagai data media Indonesia.** Parser tanggal mengenali nama bulan Inggris dan Indonesia (termasuk ejaan lama `Peb`/`Nop`), dan label zona waktu lokal `WIB`/`WITA`/`WIT` digeser ke UTC (−7/−8/−9 jam) alih-alih diabaikan — mengabaikannya akan menyimpan jam dinding lokal sebagai UTC dan menggeser artikel sampai sembilan jam. Offset numerik yang eksplisit selalu menang atas label.
* **Pemisah ribuan dibaca, bukan ditebak.** `"1,234"`, `"1.240"`, dan `"1 240"` sama-sama menjadi integer, begitu pula sufiks `"12rb"`, `"1.2K"`, `"1,5 jt"`. Nilai yang mencampur dua gaya sekaligus (`"1.240,5"` — jelas sebuah desimal) ditolak jadi NULL, bukan dipotong diam-diam.
* **Tanggal relatif sengaja tidak diurai.** `"2 jam yang lalu"` dan `"kemarin"` hanya bisa diartikan relatif terhadap waktu ingest, sehingga hasilnya berbeda tiap kali batch yang sama diulang — persis yang merusak idempotency. Record tetap disimpan dengan `published_at` NULL dan teks aslinya di `published_at_raw`.
* **Tanggal tanpa zona waktu dianggap UTC.** Brief tidak menyebut zona waktu asal, dan `group_by=day` juga mengelompokkan dalam UTC agar konsisten.
* **`DD/MM/YYYY`, bukan `MM/DD/YYYY`.** Untuk tanggal bergaris miring yang ambigu (`03/04/2024`) dipilih *day-first*, dan keputusannya berupa satu konstanta bernama (`AMBIGUOUS_SLASH_DATE_ORDER`) supaya mudah dibalik. Bila salah satu angka lebih besar dari 12, urutannya disimpulkan dari angka itu.
* **Tanggal yang tidak bisa diurai bukan alasan membuang data.** Barisnya tetap masuk dengan `published_at` NULL dan teks aslinya di `published_at_raw`.
* **Nama source dinormalkan agresif.** Huruf kecil, non-alfanumerik dibuang, bentuk domain dipangkas ke label pertama — `TechCrunch`, `techcrunch.com`, dan `https://www.TechCrunch.com/` menjadi satu kunci `techcrunch`. Query `?source=` melewati normalisasi yang sama sehingga filternya cocok apa pun bentuk yang diketik.
* **Rentang tanggal.** `from` inklusif; `to` yang ditulis sebagai tanggal saja (`2024-03-31`) diperlakukan sebagai akhir hari itu, sehingga rentangnya mencakup keseluruhan tanggal tersebut.
* **`q` adalah pencarian substring**, case-insensitive, atas `title` dan `content`; karakter `%` dan `_` di-escape agar dianggap literal.
* **Bulk ingest terbuka tanpa autentikasi** sesuai brief; prefiks `/internal` menandakan endpoint itu semestinya hanya dijangkau dari jaringan internal.
* **Ukuran batch dibatasi 50.000 record** dan body 16 MB, cukup untuk file seed sekaligus mencegah satu permintaan menghabiskan memori.

---

## Trade-offs

* **`ILIKE '%q%'`, bukan full-text search.** Sederhana, memberi hasil yang bisa ditebak, dan cocok untuk substring parsial — tapi tidak bisa memakai indeks dan akan melambat pada jutaan baris. Perbaikannya sudah jelas: kolom `tsvector` dan indeks GIN, atau `pg_trgm`. Pada skala data ini, biaya itu belum terbayar.
* **Pagination `LIMIT`/`OFFSET`, bukan keyset.** `OFFSET` besar makin mahal, tapi API-nya memberi `total` dan `total_pages` yang dibutuhkan dashboard, dan sort key `(published_at, id)` sudah siap dipakai bila nanti pindah ke keyset.
* **SQL manual lewat `pg`, bukan ORM.** Brief meminta skema yang terlihat; imbalannya query eksplisit dan bisa dibaca, biayanya penulisan mapping baris ke resource secara manual.
* **Runner migrasi buatan sendiri (~60 baris) alih-alih dependency.** Menghindari satu dependency dan lapisan konfigurasi untuk kebutuhan yang kecil; imbalannya tidak ada `down`-migration — untuk saat ini rollback berarti menulis migrasi baru.
* **Seluruh batch dinormalkan di memori sebelum insert.** Sederhana dan membuat dedup dalam batch mudah; pada file berukuran ratusan MB ini harus jadi streaming.
* **Satu transaksi untuk seluruh batch.** Ingest bersifat atomik — semua atau tidak sama sekali — dengan konsekuensi transaksi menjadi panjang pada batch besar.
* **Uji integrasi menuntut Postgres sungguhan.** Menjalankan suite butuh basis data hidup, jadi lebih lambat dari mock; tapi yang diuji adalah perilaku yang sebetulnya berisiko — unique index, `ON CONFLICT`, `NULLS LAST`, dan `date_trunc` — yang justru hilang bila di-mock.
* **`engagement` sebagai `integer`.** Cukup sampai ~2,1 miliar dan nilai yang melebihi itu disimpan NULL alih-alih meluap; `bigint` akan lebih aman untuk metrik reach yang sangat besar.
* **Stats tidak di-cache dan tidak difilter.** `group_by` selalu menghitung seluruh tabel. Untuk dashboard yang perlu mengikuti filter search, agregasinya harus menerima parameter filter yang sama.

---

## Time Spent

* **Perkiraan waktu:** ±10 jam.
* **Jumlah sesi:** 2 sesi (19 dan 20 Agustus 2026).

Porsi terbesar habis di normalisasi dan pemilihan aturan duplicate.

**Catatan jujur soal data:** `seed_mentions.json` tidak tersedia pada working copy ini,
jadi aturan normalisasi dan dedup dikembangkan terhadap
[tests/fixtures/messy-mentions.json](tests/fixtures/messy-mentions.json) — fixture yang
ditulis sendiri, satu record untuk tiap kategori kekacauan yang disebut brief di §4,
ditambah bentuk-bentuk yang khas pada media Indonesia. Begitu file seed asli diletakkan
di root, `npm run inspect:seed` memprofilkannya (source, format tanggal, HTML, duplikat)
dan `npm run seed` mengalirkannya lewat pipeline ingestion yang sama persis dengan
endpoint HTTP. Tidak ada keputusan desain yang bergantung pada isi file yang belum
pernah saya lihat; yang menyesuaikan setelah file itu masuk adalah daftar format
tanggal dan alias field, keduanya terpusat di satu berkas.

---

## With Another Week, I Would...

1. **Mengganti `ILIKE` dengan full-text search Postgres** — kolom `tsvector` yang di-*generate*, indeks GIN, dan peringkat relevansi. Ini batasan pertama yang akan terasa oleh seorang analyst begitu data bertambah, sekaligus perubahan yang mengubah bentuk query dan skema, jadi paling murah dikerjakan lebih awal.

Berikutnya, sesuai urutan:

2. Menerima filter yang sama (`q`, `source`, `from`, `to`) pada endpoint stats, supaya chart mengikuti pencarian aktif.
3. Pindah ke keyset pagination untuk halaman-halaman jauh, dengan `LIMIT`/`OFFSET` dipertahankan untuk permintaan yang butuh `total`.
4. Ingestion streaming plus insert per-chunk, agar file berukuran besar tidak perlu masuk memori sekaligus.
5. Endpoint kecil untuk meninjau record dengan `published_at_raw` terisi — daftar kerja untuk format tanggal yang belum tertangani.
6. Aturan dedup yang bisa diatur per-source, plus job perhitungan ulang fingerprint dari kolom `raw` ketika aturannya naik ke `v2`.

---

## Testing

```bash
createdb media_monitoring_test    # sekali saja
npm test
```

67 uji dalam 4 berkas, dijalankan terhadap `TEST_DATABASE_URL` (tabelnya dikosongkan
tiap kali suite berjalan, terpisah dari basis data pengembangan):

| File | Covers |
|---|---|
| [tests/normalization.test.ts](tests/normalization.test.ts) | Pembersihan HTML dan entity, penyamaan nama source, kanonikalisasi URL, beragam format tanggal (ISO, epoch, garis miring ambigu, nama bulan Inggris dan Indonesia, label `WIB`/`WITA`/`WIT`), angka berbentuk string (pemisah ribuan `,` `.` dan spasi, sufiks `k`/`rb`/`jt`), penolakan record |
| [tests/ingestion.test.ts](tests/ingestion.test.ts) | Idempotency, dedup di dalam batch, kedua strategi fingerprint, penolakan per-record, isi laporan |
| [tests/search.test.ts](tests/search.test.ts) | Tiap filter, kombinasinya, batas pagination, stabilitas urutan termasuk baris tanpa tanggal |
| [tests/stats.test.ts](tests/stats.test.ts) | Hitungan per source dan per hari, `missing_published_at`, validasi `group_by` |

Sesuai brief, cakupannya sengaja tidak menyeluruh — ujinya diarahkan ke logika yang
paling berisiko: normalisasi, dedup, dan stabilitas urutan.

---

## Scripts

```bash
npm run dev              # Development server with hot-reload (tsx watch)
npm run build            # Compile TypeScript to dist/
npm run start            # Start the compiled server
npm run migrate          # Apply pending SQL migrations
npm run seed             # Ingest seed_mentions.json through the bulk pipeline
npm run inspect:seed     # Profile the seed file: sources, date formats, HTML, duplicates
npm run test             # Run the Vitest suite once
npm run test:watch       # Run Vitest in watch mode
npm run typecheck        # Type-check the whole project without emitting
```

---

## Documentation

- **[PRD.md](./PRD.md)** — Brief technical assessment, requirement, dan deliverables
- **[migrations/001_create_mentions.sql](./migrations/001_create_mentions.sql)** — DDL tabel `mentions`, constraint, dan indeks
- **[src/features/mentions/](./src/features/mentions/)** — Modul fitur: validation, normalization, repository, service, controller, routes
- **[tests/fixtures/README.md](./tests/fixtures/README.md)** — Catatan fixture data berantakan yang dipakai pengujian
- **[Fastify Docs](https://fastify.dev/docs/latest/)** — Web framework documentation
- **[node-postgres Docs](https://node-postgres.com)** — PostgreSQL client documentation
- **[PostgreSQL Docs](https://www.postgresql.org/docs/16/)** — SQL, indexing, and aggregation reference
- **[Zod Docs](https://zod.dev)** — Schema validation documentation
- **[Vitest Docs](https://vitest.dev)** — Test runner documentation

---

## License

MIT
