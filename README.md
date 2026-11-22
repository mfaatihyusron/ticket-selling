# API Penjualan Tiket Event dengan Kuota Terbatas

Backend RESTful API untuk platform penjualan tiket event dengan kuota terbatas, perlindungan konkurensi skala tinggi (*anti-overselling*), kedaluwarsa pesanan 15 menit, penegakan batas 4 tiket per pembeli, webhook pembayaran idempoten, *dockerized container*, dan pipeline CI/CD otomatis.

---

## Daftar Isi
1. [Fitur Utama & Pemenuhan Kebutuhan Bisnis](#fitur-utama--pemenuhan-kebutuhan-bisnis)
2. [Fitur Lanjutan & Keandalan Sistem](#fitur-lanjutan--keandalan-sistem)
3. [Bukti Uji Konkurensi 200 Pesanan Bersamaan](#bukti-uji-konkurensi-200-pesanan-bersamaan)
4. [Cara Menjalankan Sistem (Satu Perintah)](#cara-menjalankan-sistem-satu-perintah)
5. [Cara Menjalankan Pengujian Otomatis](#cara-menjalankan-pengujian-otomatis)
6. [Panduan Simulasi Pembayaran & Webhook](#panduan-simulasi-pembayaran--webhook)
7. [Dokumentasi Endpoint REST API](#dokumentasi-endpoint-rest-api)
8. [Pipeline CI/CD](#pipeline-cicd)
9. [Struktur Repositori](#struktur-repositori)

---

## Fitur Utama & Pemenuhan Kebutuhan Bisnis

| No | Kebutuhan Bisnis | Status | Implementasi Teknis |
| :--- | :--- | :---: | :--- |
| 1 | Event dengan kuota terbatas & multi-tipe (Reguler, VIP) | Terpenuhi | Tabel `events` & `ticket_types`, endpoint `POST /api/events` |
| 2 | Pembeli melihat event dan sisa kuota tiap tipe | Terpenuhi | Kalkulasi real-time: `available = total - reserved - sold` |
| 3 | Pesanan 1-4 tiket, status "menunggu bayar", tahan kuota 15 menit | Terpenuhi | Status `PENDING`, `expires_at = NOW() + 15m`, kuota dialokasikan ke `reserved_quota` |
| 4 | Maksimal 4 tiket per pembeli per event (aktif + lunas) | Terpenuhi | Validasi transaksional `SUM(quantity) <= 4` untuk status `PENDING` dan `PAID` |
| 5 | Pembeli bisa membatalkan pesanan sebelum bayar | Terpenuhi | Endpoint `POST /api/orders/:id/cancel`, `reserved_quota` langsung dikembalikan seketika |
| 6 | Simulasi pembayaran (tandai lunas via endpoint/skrip) | Terpenuhi | Endpoint `POST /api/orders/:id/pay` dan `POST /api/payments/simulate` |
| 7 | Pembayaran menerbitkan tiket kode unik (tanpa duplikasi) | Terpenuhi | Kode unik format `TKT-{TYPE}-{ORDER}-{INDEX}-{RANDOM}` dengan DB UNIQUE constraint |
| 8 | Pembeli melihat riwayat pesanan dan tiketnya | Terpenuhi | Endpoint `GET /api/users/:userId/orders` dan `/tickets` |

---

## Fitur Lanjutan & Keandalan Sistem (*Advanced Reliability*)

### 1. Webhook Pembayaran Idempoten (`POST /api/payments/webhook`)
Mendukung skenario payment gateway sungguhan:
- **Idempotensi (Duplicate / Retry Request):** Header/Body menyertakan `payment_reference`. Permintaan yang dikirim ganda akan direspons secara idempoten (`ALREADY_PROCESSED`) dan **tidak akan** menerbitkan tiket duplikat.
- **Webhook Terlambat (Late Delivery):** Notifikasi yang tiba setelah pesanan melewati batas waktu 15 menit (`EXPIRED` atau `CANCELLED`) secara otomatis ditolak (`422 Unprocessable Entity`), kuota tidak terganggu, dan status dicatat untuk *refund reconciliation*.

### 2. Uji 200 Permintaan Pesanan Bersamaan (100 Kuota)
Pengujian konkurensi (*race condition*) menembakkan 200 permintaan HTTP serentak (`Promise.all`) untuk memperebutkan kuota 100 tiket (70 Regular, 30 VIP). Hasil akhir terbukti: **tepat 100 pesanan diterima, tepat 100 pesanan ditolak (409 Out of Quota), dan 0 oversell**.

---

## Bukti Uji Konkurensi 200 Pesanan Bersamaan

Pengujian dieksekusi menggunakan skrip `scripts/concurrency-test.ts` (dapat dijalankan via `npm run test:concurrency`).

```text
================================================================
MEMULAI UJI KONKURENSI 200 PESANAN BERSAMAAN (100 KUOTA)
================================================================

1. Menyiapkan Event dengan kuota terbatas...
   - Event ID: c99814f7-9fa3-43ed-8c32-1d6e6af282c8
   - Kuota REGULAR: 70 tiket
   - Kuota VIP: 30 tiket
   - TOTAL KUOTA TERSEDIA: 100 tiket

2. Menembakkan 200 request pemesanan secara bersamaan...
   - 140 pembeli berebut 70 tiket REGULAR
   - 60 pembeli berebut 30 tiket VIP

3. Hasil Pemesanan 200 Request Bersamaan (2889 ms):
   ----------------------------------------------------------
   Total Permintaan Masuk   : 200
   Pesanan Berhasil (201)   : 100
     - REGULAR Terjual      : 70 / 70
     - VIP Terjual          : 30 / 30
   Pesanan Ditolak Kuota    : 100 / 100
   Error Lainnya            : 0
   ----------------------------------------------------------

4. Melakukan simulasi pembayaran untuk 100 pesanan yang berhasil...

================================================================
LAPORAN AKHIR VERIFIKASI KONKURENSI & INTEGRITAS DATA
================================================================
Total Waktu Pengujian       : 6100 ms
Pesanan Berhasil Dibayar    : 100 / 100
Total Tiket Unik Diterbitkan: 100 / 100
Sisa Kuota REGULAR          : 0 (Sold: 70)
Sisa Kuota VIP              : 0 (Sold: 30)
Total Sisa Kuota            : 0
Total Tiket Terjual         : 100
Reserved Quota Menggantung  : 0
----------------------------------------------------------------
STATUS UJI: LULUS SEMPURNA (100% PASS)
   - Kuota 100 tiket terjual TEPAT 100 tiket.
   - 0 Oversell terjadi.
   - 0 Duplikasi tiket.
   - Database row-level locking & transaksi ACID terbukti tangguh!
================================================================
```

---

## Cara Menjalankan Sistem (Satu Perintah)

Sistem (REST API, Database PostgreSQL, dan Seeder Otomatis) dapat dihidupkan pada mesin bersih yang memiliki Docker dengan **satu perintah**:

```bash
docker compose up --build
```

Setelah container berjalan:
- **API Server** aktif di: `http://localhost:3000`
- **Health Check**: `http://localhost:3000/health`
- Database PostgreSQL secara otomatis membuat tabel schema dan menanamkan data awal (*seed data*).

Untuk menghentikan container:
```bash
docker compose down -v
```

---

## Cara Menjalankan Pengujian Otomatis

Proyek ini dilengkapi dengan *Automated Integration Tests* lengkap menggunakan framework Vitest:

```bash
# 1. Jalankan seluruh unit & integration tests
npm test

# 2. Jalankan uji stres konkurensi (200 permintaan serentak)
npm run test:concurrency
```

### Ringkasan Test Suite:
1. `tests/integration/order-flow.test.ts`: Alur lengkap pesan tiket $\rightarrow$ simulasi bayar $\rightarrow$ tiket unik $\rightarrow$ cek riwayat.
2. `tests/integration/quota-exhausted.test.ts`: Uji kuota habis (HTTP 409), pencegahan oversell, dan pengembalian kuota instan saat pembatalan.
3. `tests/integration/order-expiry.test.ts`: Uji kedaluwarsa 15 menit, pemulihan kuota, dan penolakan pembayaran setelah expired.
4. `tests/integration/user-limit.test.ts`: Penegakan batas maksimal 4 tiket per pembeli per event.
5. `tests/integration/webhook-idempotency.test.ts`: Uji webhook ganda (idempotent), webhook terlambat, dan webhook pada pesanan dibatalkan.

---

## Panduan Simulasi Pembayaran & Webhook

### Cara 1: Menggunakan Endpoint Simulasi Langsung
Setelah pesanan dibuat, pembeli dapat menandai pesanan sebagai lunas:

```bash
curl -X POST http://localhost:3000/api/orders/{ORDER_ID}/pay
```
*Atau:*
```bash
curl -X POST http://localhost:3000/api/payments/simulate \
  -H "Content-Type: application/json" \
  -d '{"order_id": "{ORDER_ID}"}'
```

### Cara 2: Menggunakan Webhook Pembayaran Idempoten (*Enterprise Resilience*)
Mensimulasikan panggilan notifikasi webhook dari payment provider:

```bash
curl -X POST http://localhost:3000/api/payments/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "payment_reference": "TRX-PAY-REF-001",
    "order_id": "{ORDER_ID}",
    "amount": 300000,
    "status": "SUCCESS"
  }'
```
*Jika Anda mengirimkan perintah di atas dua kali dengan `payment_reference` yang sama, server merespons dengan status 200 OK idempoten tanpa menggandakan tiket.*

---

## Dokumentasi Endpoint REST API

### 1. Events
- **Melihat Semua Event & Sisa Kuota**
  ```http
  GET /api/events
  ```
- **Detail Event**
  ```http
  GET /api/events/:id
  ```
- **Membuat Event Baru**
  ```http
  POST /api/events
  Content-Type: application/json

  {
    "title": "Konser Musik Akustik",
    "description": "Pertunjukan intim",
    "ticket_types": [
      { "name": "REGULAR", "price": 100000, "quota": 70 },
      { "name": "VIP", "price": 250000, "quota": 30 }
    ]
  }
  ```

### 2. Orders
- **Memesan Tiket (1-4 Tiket, Hold Kuota 15 Menit)**
  ```http
  POST /api/orders
  Content-Type: application/json

  {
    "user_id": "buyer@example.com",
    "event_id": "{EVENT_ID}",
    "items": [
      { "ticket_type_id": "{TICKET_TYPE_ID}", "quantity": 2 }
    ]
  }
  ```
- **Melihat Detail Pesanan**
  ```http
  GET /api/orders/:id
  ```
- **Membatalkan Pesanan Sebelum Bayar (Kuota Langsung Kembali)**
  ```http
  POST /api/orders/:id/cancel
  Content-Type: application/json

  {
    "user_id": "buyer@example.com"
  }
  ```
- **Trigger Pembersihan Pesanan Expired (Manual Sweeper)**
  ```http
  POST /api/orders/cleanup-expired
  ```

### 3. Users (Riwayat Pembeli)
- **Melihat Riwayat Pesanan Pembeli**
  ```http
  GET /api/users/:userId/orders
  ```
- **Melihat Tiket yang Telah Terbit untuk Pembeli**
  ```http
  GET /api/users/:userId/tickets
  ```

---

## Pipeline CI/CD

Konfigurasi CI/CD terletak pada file `.github/workflows/ci.yml`.

Alur pipeline:
1. **Trigger:** Otomatis berjalan di setiap `push` dan `pull_request` pada branch `main` / `master`.
2. **Automated Testing:** Membuka container PostgreSQL 16 di GitHub Actions, mengompilasi TypeScript, menjalankan seluruh integration tests (`npm test`), dan menjalankan uji stres konkurensi (`npm run test:concurrency`).
3. **Build & Push Docker Image:** Setelah pengujian lolos 100%, image di-build dan di-push ke GitHub Container Registry (`ghcr.io`) dengan dua label:
   - Tag Commit SHA: `ghcr.io/{owner}/{repo}:${{ github.sha }}`
   - Tag Latest: `ghcr.io/{owner}/{repo}:latest`

---

## Struktur Repositori

```text
ticket-selling/
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI/CD pipeline
├── scripts/
│   └── concurrency-test.ts      # Uji stres 200 pesanan serentak (Anti-Oversell Proof)
├── src/
│   ├── config/
│   │   └── env.ts               # Manajemen variabel lingkungan
│   ├── db/
│   │   ├── pool.ts              # Connection pool database PostgreSQL
│   │   ├── schema.ts            # Definisi DDL skema database & constraint
│   │   ├── schema.sql           # File SQL mentah
│   │   ├── migrate.ts           # Runner migrasi otomatis
│   │   └── seed.ts              # Seeder data awal event demo
│   ├── modules/
│   │   ├── events/              # Modul event & kuota tipe tiket
│   │   ├── orders/              # Modul pesanan, alokasi kuota, & sweeper
│   │   ├── payments/            # Modul simulasi bayar & webhook idempoten
│   │   └── users/               # Modul riwayat pesanan & tiket pembeli
│   ├── app.ts                   # Inisialisasi Express & routing
│   └── server.ts                # Entrypoint server & graceful shutdown
├── tests/
│   ├── test-db.ts               # In-memory DB setup untuk pengujian cepat
│   └── integration/             # Integration test cases
│       ├── order-flow.test.ts
│       ├── quota-exhausted.test.ts
│       ├── order-expiry.test.ts
│       ├── user-limit.test.ts
│       └── webhook-idempotency.test.ts
├── DECISIONS.md                 # Analisis keputusan arsitektur & trade-off (Bobot 30%)
├── Dockerfile                   # Multi-stage production container
├── docker-compose.yml           # Satu perintah jalan sistem lengkap
├── package.json
└── README.md
```
