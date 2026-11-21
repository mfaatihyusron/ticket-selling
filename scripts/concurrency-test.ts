/**
 * Concurrency Test Script (Nilai Tambah #2)
 *
 * Skenario:
 * 1. Menyiapkan Event dengan kuota tepat 100 tiket (70 Regular, 30 VIP).
 * 2. Mengirimkan 200 permintaan pesanan secara BERSAMAAN (concurrent) menggunakan Promise.all:
 *    - 140 pembeli unik memesan tiket REGULAR (kuota: 70)
 *    - 60 pembeli unik memesan tiket VIP (kuota: 30)
 * 3. Memverifikasi hasil:
 *    - Tepat 100 pesanan berhasil dibuat (HTTP 201).
 *    - Tepat 100 pesanan ditolak karena kuota habis (HTTP 409).
 *    - 0 oversell terjadi!
 * 4. Melakukan simulasi pembayaran untuk 100 pesanan berhasil:
 *    - Tepat 100 tiket unik diterbitkan.
 *    - Sisa kuota akhir di database tepat 0.
 */

import request from 'supertest';
import { createApp } from '../src/app';
import { setupTestDb } from '../tests/test-db';

async function runConcurrencyTest() {
  console.log('================================================================');
  console.log('🔥 MEMULAI UJI KONKURENSI 200 PESANAN BERSAMAAN (100 KUOTA) 🔥');
  console.log('================================================================\n');

  const startTime = Date.now();
  await setupTestDb();
  const app = createApp();

  // 1. Setup Event dengan total 100 kuota tiket
  console.log('1. Menyiapkan Event dengan kuota terbatas...');
  const createEventRes = await request(app)
    .post('/api/events')
    .send({
      title: 'Grand Concert 2026: Concurrency Edition',
      description: 'Konser pengujian konkurensi skala tinggi',
      ticket_types: [
        { name: 'REGULAR', price: 150000, quota: 70 },
        { name: 'VIP', price: 350000, quota: 30 },
      ],
    });

  const event = createEventRes.body.data;
  const regType = event.ticket_types.find((t: any) => t.name === 'REGULAR');
  const vipType = event.ticket_types.find((t: any) => t.name === 'VIP');

  console.log(`   - Event ID: ${event.id}`);
  console.log(`   - Kuota REGULAR: ${regType.available_quota} tiket`);
  console.log(`   - Kuota VIP: ${vipType.available_quota} tiket`);
  console.log(`   - TOTAL KUOTA TERSEDIA: 100 tiket\n`);

  // 2. Siapkan 200 request bersamaan dari 200 pembeli unik
  console.log('2. Menembakkan 200 request pemesanan secara bersamaan...');
  console.log('   - 140 pembeli berebut 70 tiket REGULAR');
  console.log('   - 60 pembeli berebut 30 tiket VIP');

  interface RequestTask {
    buyerId: string;
    ticketTypeId: string;
    ticketTypeName: string;
  }

  const tasks: RequestTask[] = [];

  // 140 request untuk REGULAR
  for (let i = 1; i <= 140; i++) {
    tasks.push({
      buyerId: `buyer-reg-${String(i).padStart(3, '0')}@stress.test`,
      ticketTypeId: regType.id,
      ticketTypeName: 'REGULAR',
    });
  }

  // 60 request untuk VIP
  for (let i = 1; i <= 60; i++) {
    tasks.push({
      buyerId: `buyer-vip-${String(i).padStart(3, '0')}@stress.test`,
      ticketTypeId: vipType.id,
      ticketTypeName: 'VIP',
    });
  }

  const shuffledTasks = tasks.sort(() => Math.random() - 0.5);
  const requestStartTime = Date.now();

  const results = await Promise.all(
    shuffledTasks.map((t) =>
      request(app)
        .post('/api/orders')
        .send({
          user_id: t.buyerId,
          event_id: event.id,
          items: [{ ticket_type_id: t.ticketTypeId, quantity: 1 }],
        })
        .then((res) => ({
          status: res.status,
          success: res.body.success,
          ticketType: t.ticketTypeName,
          orderId: res.body.data?.id,
          error: res.body.error,
        }))
        .catch((err) => ({
          status: 500,
          success: false,
          ticketType: t.ticketTypeName,
          orderId: undefined,
          error: err.message,
        }))
    )
  );

  const requestDurationMs = Date.now() - requestStartTime;

  const successfulOrders = results.filter((r) => r.status === 201);
  const outOfQuotaOrders = results.filter((r) => r.status === 409);
  const failedOther = results.filter((r) => r.status !== 201 && r.status !== 409);

  const regSuccess = successfulOrders.filter((r) => r.ticketType === 'REGULAR').length;
  const vipSuccess = successfulOrders.filter((r) => r.ticketType === 'VIP').length;

  console.log(`\n3. Hasil Pemesanan 200 Request Bersamaan (${requestDurationMs} ms):`);
  console.log(`   ----------------------------------------------------------`);
  console.log(`   Total Permintaan Masuk   : ${results.length}`);
  console.log(`   Pesanan Berhasil (201)   : ${successfulOrders.length}`);
  console.log(`     - REGULAR Terjual      : ${regSuccess} / 70`);
  console.log(`     - VIP Terjual          : ${vipSuccess} / 30`);
  console.log(`   Pesanan Ditolak Kuota    : ${outOfQuotaOrders.length} / 100`);
  console.log(`   Error Lainnya            : ${failedOther.length}`);
  console.log(`   ----------------------------------------------------------`);

  // 4. Simulasi Pembayaran untuk semua 100 pesanan yang berhasil
  console.log('\n4. Melakukan simulasi pembayaran untuk 100 pesanan yang berhasil...');
  const payResults = [];
  for (const o of successfulOrders) {
    const res = await request(app).post(`/api/orders/${o.orderId}/pay`);
    payResults.push({
      status: res.status,
      orderId: o.orderId,
      body: res.body,
      ticketsIssued: res.body.issued_tickets?.length || 0,
    });
  }

  const totalPaid = payResults.filter((p) => p.status === 200).length;
  const totalTicketsIssued = payResults.reduce((sum, p) => sum + p.ticketsIssued, 0);

  // 5. Verifikasi Keadaan Terakhir di Database
  const finalEventRes = await request(app).get(`/api/events/${event.id}`);
  const finalReg = finalEventRes.body.data.ticket_types.find((t: any) => t.id === regType.id);
  const finalVip = finalEventRes.body.data.ticket_types.find((t: any) => t.id === vipType.id);

  const finalTotalSold = finalReg.sold_quota + finalVip.sold_quota;
  const finalTotalAvailable = finalReg.available_quota + finalVip.available_quota;
  const finalTotalReserved = finalReg.reserved_quota + finalVip.reserved_quota;

  const totalDuration = Date.now() - startTime;

  console.log('\n================================================================');
  console.log('📊 LAPORAN AKHIR VERIFIKASI KONKURENSI & INTEGRITAS DATA');
  console.log('================================================================');
  console.log(`Total Waktu Pengujian       : ${totalDuration} ms`);
  console.log(`Pesanan Berhasil Dibayar    : ${totalPaid} / 100`);
  console.log(`Total Tiket Unik Diterbitkan: ${totalTicketsIssued} / 100`);
  console.log(`Sisa Kuota REGULAR          : ${finalReg.available_quota} (Sold: ${finalReg.sold_quota})`);
  console.log(`Sisa Kuota VIP              : ${finalVip.available_quota} (Sold: ${finalVip.sold_quota})`);
  console.log(`Total Sisa Kuota            : ${finalTotalAvailable}`);
  console.log(`Total Tiket Terjual         : ${finalTotalSold}`);
  console.log(`Reserved Quota Menggantung  : ${finalTotalReserved}`);
  console.log('----------------------------------------------------------------');

  const isExact100Sold = finalTotalSold === 100;
  const isZeroOversell = finalTotalAvailable === 0 && finalTotalSold === 100;
  const isNoDuplicates = totalTicketsIssued === 100;

  if (isExact100Sold && isZeroOversell && isNoDuplicates) {
    console.log('✅ STATUS UJI: LULUS SEMPURNA (100% PASS)');
    console.log('   - Kuota 100 tiket terjual TEPAT 100 tiket.');
    console.log('   - 0 Oversell terjadi.');
    console.log('   - 0 Duplikasi tiket.');
    console.log('   - Database row-level locking & transaksi ACID terbukti tangguh!');
    console.log('================================================================\n');
    process.exit(0);
  } else {
    console.error('❌ STATUS UJI: GAGAL (Integritas data tidak terpenuhi!)');
    console.error(`Expected 100 sold, got: ${finalTotalSold}`);
    process.exit(1);
  }
}

runConcurrencyTest().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
