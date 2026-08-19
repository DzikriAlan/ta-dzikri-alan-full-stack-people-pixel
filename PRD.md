# PRD — Technical Assessment

## 1. Technical Assessment

**Batas waktu submission:** Jumat, 21 Agustus 2026, pukul 18:00 MYT (Malaysia) / 17:00 WIB (Indonesia).

Anda dapat mengerjakan assessment sesuai dengan kecepatan Anda sendiri. Kami mengevaluasi hasil yang Anda berikan dan bagaimana Anda melakukan reasoning terhadap solusi tersebut, bukan seberapa cepat Anda menyelesaikannya.

---

## 2. Konteks

Kami mengoperasikan sebuah **media monitoring platform**.

Platform ini mengambil artikel dan postingan media sosial ("mentions") dari berbagai sumber, membersihkan data tersebut, menyimpannya, kemudian memungkinkan seorang **PR analyst** untuk melakukan pencarian dan membuat chart dari data tersebut.

Dalam assessment ini, Anda akan membangun sebagian kecil dari sistem tersebut, yaitu:

* Ingestion endpoint
* Search endpoint
* Stats endpoint
* Database yang nyata sebagai backend penyimpanan

---

## 3. Yang Harus Dibangun

Bangun sebuah **backend service** yang menyediakan tiga HTTP endpoint.

### 3.1 Bulk Ingest

**Endpoint:**

`POST /internal/mentions/bulk`

Endpoint harus:

* Menerima array records dari `seed_mentions.json` yang telah disediakan.
* Melakukan normalisasi terhadap data.
* Menyimpan data ke database.
* Bersifat **idempotent**.

Posting file yang sama sebanyak dua kali **tidak boleh membuat duplicate rows**.

Pipeline sebenarnya melakukan retry ketika terjadi kegagalan, sehingga kemampuan idempotency ini penting.

---

### 3.2 Search

**Endpoint:**

`GET /mentions`

Endpoint minimal harus mendukung:

* `q` — keyword search pada `title` dan `content`
* `source` — filter berdasarkan source
* `from` — batas awal published date
* `to` — batas akhir published date
* Pagination
* Stable sort order yang terdokumentasi

---

### 3.3 Stats

**Endpoint:**

`GET /mentions/stats?group_by=source`

dan

`GET /mentions/stats?group_by=day`

Endpoint harus mengembalikan jumlah data yang dapat digunakan untuk kebutuhan chart pada dashboard.

---

## 4. Kondisi Data

Data pada `seed_mentions.json` sengaja dibuat berantakan karena merepresentasikan output ingestion di dunia nyata.

Setidaknya terdapat:

* Artikel yang sama muncul lebih dari satu kali.
* Penamaan source yang tidak konsisten.
* Beberapa format tanggal yang berbeda.
* Beberapa data tanggal yang hilang.
* Raw HTML di dalam field content.
* Angka yang disimpan sebagai string.

### Duplicate Definition

Anda bebas menentukan bagaimana mendefinisikan **duplicate**.

Definisi tersebut sengaja tidak ditentukan di dalam assessment.

Anda harus:

1. Menentukan aturan yang digunakan untuk mendeteksi duplicate.
2. Mengimplementasikan aturan tersebut.
3. Menjelaskan reasoning di balik keputusan tersebut di dalam `README.md`.

**Tidak ada satu jawaban yang dianggap benar.**

Kami ingin melihat bagaimana Anda melakukan reasoning terhadap masalah tersebut.

---

## 5. Constraints

### 5.1 Language / Framework

Gunakan salah satu:

* Node.js + TypeScript
* Python

Framework web bebas dipilih.

### 5.2 Database

**PostgreSQL lebih disukai.**

SQLite diperbolehkan apabila Anda menjelaskan trade-off yang dipilih.

### 5.3 Database Schema

Schema harus dibuat melalui:

* Migration yang di-commit ke repository; atau
* SQL file yang di-commit ke repository.

Schema **tidak boleh dibuat secara manual melalui GUI database**.

Jangan menggunakan ORM auto-magic yang menyembunyikan schema.

Kami ingin dapat melihat tabel yang Anda desain secara eksplisit.

---

## 6. Hal yang Secara Eksplisit Tidak Diperlukan

Jangan membangun fitur-fitur berikut.

Membangun fitur tersebut **tidak akan memberikan tambahan poin**:

* Authentication atau user accounts
* CI pipelines
* Kubernetes
* Sentiment analysis atau ML
* Exhaustive test coverage

Beberapa meaningful tests lebih baik daripada coverage 90% untuk getter.

---

## 7. Docker Compose

**Docker Compose bersifat opsional.**

Docker Compose hanya disarankan apabila benar-benar membuat proses setup menjadi lebih mudah.

---

## 8. Frontend

Frontend juga **opsional**.

Frontend tidak diwajibkan dan tidak dinilai.

---

## 9. Deployment — Opsional

Deployment tidak diwajibkan dan tidak dinilai.

Apabila Anda ingin menghindari kebutuhan untuk menjelaskan local setup, Anda diperbolehkan melakukan deployment terhadap service sehingga dapat diakses secara online.

Anda dapat mencantumkan URL deployment tersebut di dalam `README.md`.

**Render** merupakan salah satu pilihan free yang masuk akal.

Render tidak membutuhkan kartu kredit dan dapat digunakan untuk menjalankan:

* Service
* PostgreSQL database

Free tier Render akan sleep setelah tidak ada aktivitas.

Request pertama setelah tidak aktif dapat membutuhkan waktu **30–60 detik**. Hal tersebut dianggap normal dan tidak akan memengaruhi penilaian.

---

## 10. Dashboard — Opsional

Dashboard kecil juga bersifat **opsional** dan tidak dinilai berdasarkan apakah Anda membuatnya atau tidak.

Apabila ingin membuatnya, Anda dapat menambahkan satu halaman read-only yang memanggil endpoint milik sendiri:

* `/mentions`
* `/mentions/stats`

Dashboard cukup menampilkan:

* List data
* Breakdown jumlah data sederhana

Tidak diperlukan:

* Authentication
* Design system
* Framework tertentu
* Visual polish

Dashboard hanya ditujukan untuk membantu menunjukkan API bekerja tanpa evaluator harus membuka `curl` atau Postman.

---

# 11. Deliverables

## 11.1 Repository

Berikan salah satu:

* Public GitHub repository; atau
* ZIP apabila repository ingin tetap private.

---

## 11.2 README.md

`README.md` wajib berisi:

### How to Run

Jelaskan cara menjalankan aplikasi mulai dari:

**clone repository → setup → menjalankan aplikasi → endpoint dapat digunakan.**

Kami akan mengikuti instruksi tersebut secara literal.

### Schema

Jelaskan:

* Schema yang digunakan.
* Alasan Anda memodelkan schema tersebut seperti itu.

### Duplicate Detection

Jelaskan:

* Aturan yang digunakan untuk menentukan duplicate.
* Alasan memilih aturan tersebut.

### Assumptions

Jelaskan asumsi yang Anda buat terhadap bagian-bagian yang tidak dijelaskan secara spesifik di dalam brief.

### Trade-offs

Jelaskan trade-off yang secara sadar Anda terima dan alasan Anda memilihnya.

### Time Spent

Cantumkan:

* Perkiraan jumlah jam yang digunakan.
* Jumlah sesi yang digunakan.

### With Another Week, I Would...

Jelaskan:

**"Dengan satu minggu tambahan, saya akan..."**

Berisi hal pertama yang ingin Anda perbaiki atau tambahkan.

---

## 11.3 Commit History

Repository harus memiliki **commit history**.

Jangan mengumpulkan project sebagai satu commit seperti:

`initial commit`

Kami ingin melihat proses perkembangan project melalui history commit.

---

## 11.4 Tests

Buat beberapa test yang mencakup logic yang menurut Anda paling berisiko.

Tidak diperlukan exhaustive test coverage.

Beberapa test yang meaningful lebih baik daripada coverage tinggi yang mencakup logic sederhana.

---

# 12. Penggunaan AI Tools

Gunakan AI tools.

Kami juga menggunakannya.

Tidak ada penalti untuk penggunaan AI dan Anda tidak diwajibkan mengungkapkan bagian mana yang dibuat dengan bantuan AI.

Namun, kandidat yang masuk tahap shortlist akan mengikuti **25-minute call**.

Dalam sesi tersebut, kami akan membahas:

* Code yang Anda buat.
* Alasan Anda mengambil keputusan tertentu.
* Bagaimana Anda akan mengubah implementasi apabila terdapat requirement baru.

**Hanya submit code yang dapat Anda pertanggungjawabkan dan jelaskan.**

---

# 13. Questions

Mengajukan pertanyaan klarifikasi yang baik merupakan **positive signal**, bukan sesuatu yang dianggap negatif.

Apabila terdapat bagian dari brief yang tidak jelas, Anda diperbolehkan mengajukan pertanyaan untuk mendapatkan klarifikasi.

---

# 14. Ringkasan Requirement

| Area                | Requirement                             |
| ------------------- | --------------------------------------- |
| Language            | Node.js + TypeScript atau Python        |
| Database            | PostgreSQL preferred, SQLite acceptable |
| Ingestion           | `POST /internal/mentions/bulk`          |
| Search              | `GET /mentions`                         |
| Stats               | `GET /mentions/stats?group_by=source`   |
| Stats               | `GET /mentions/stats?group_by=day`      |
| Idempotency         | Wajib                                   |
| Duplicate detection | Bebas ditentukan, wajib dijelaskan      |
| Pagination          | Wajib pada search                       |
| Stable sort         | Wajib dan harus didokumentasikan        |
| Schema              | Migration atau SQL file yang di-commit  |
| ORM                 | Tidak boleh menyembunyikan schema       |
| Authentication      | Tidak diperlukan                        |
| CI                  | Tidak diperlukan                        |
| Kubernetes          | Tidak diperlukan                        |
| ML / Sentiment      | Tidak diperlukan                        |
| Exhaustive tests    | Tidak diperlukan                        |
| Docker Compose      | Opsional                                |
| Frontend            | Opsional                                |
| Deployment          | Opsional                                |
| Dashboard           | Opsional                                |
| README              | Wajib                                   |
| Commit history      | Wajib                                   |
| Tests               | Beberapa meaningful tests wajib         |
| AI Tools            | Diperbolehkan                           |

# 15. Kesimpulan

Deliverable utama yang harus diselesaikan adalah **backend service dengan tiga endpoint, PostgreSQL/database nyata, idempotent bulk ingestion, search, stats, migration/schema yang jelas, README lengkap, commit history, dan beberapa meaningful tests**.
