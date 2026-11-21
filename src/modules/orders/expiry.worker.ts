import { ordersService } from './orders.service';
import { config } from '../../config/env';

let timer: NodeJS.Timeout | null = null;

export function startExpiryWorker(): void {
  if (timer) return;

  console.log(
    `[ExpiryWorker] Started background worker running every ${config.expirySweeperIntervalMs}ms.`
  );

  timer = setInterval(async () => {
    try {
      const sweptCount = await ordersService.sweepExpiredOrders();
      if (sweptCount > 0) {
        console.log(`[ExpiryWorker] Swept and restored quota for ${sweptCount} expired order(s).`);
      }
    } catch (err) {
      console.error('[ExpiryWorker] Error during sweep:', err);
    }
  }, config.expirySweeperIntervalMs);
}

export function stopExpiryWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[ExpiryWorker] Stopped.');
  }
}
