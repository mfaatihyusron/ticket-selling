import { createApp } from './app';
import { config } from './config/env';
import { runMigrations } from './db/migrate';
import { seedDatabase } from './db/seed';
import { startExpiryWorker, stopExpiryWorker } from './modules/orders/expiry.worker';
import { getDb } from './db/pool';

async function bootstrap() {
  try {
    console.log('[Bootstrap] Initializing Ticket Selling System...');

    // Run database migrations on startup
    await runMigrations();

    // Auto-seed demo event if none exists
    await seedDatabase();

    // Start background worker for order expiration
    startExpiryWorker();

    const app = createApp();

    const server = app.listen(config.port, () => {
      console.log(`=======================================================`);
      console.log(`🚀 Ticket Selling API Server listening on port ${config.port}`);
      console.log(`📡 Environment: ${config.nodeEnv}`);
      console.log(`🕒 Order Expiration Time: ${config.orderExpiryMinutes} minutes`);
      console.log(`🔍 Health check: http://localhost:${config.port}/health`);
      console.log(`=======================================================`);
    });

    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
      console.log(`\n[Shutdown] Received ${signal}. Gracefully stopping server...`);
      stopExpiryWorker();

      server.close(async () => {
        console.log('[Shutdown] HTTP server closed.');
        try {
          await getDb().end();
          console.log('[Shutdown] Database connection pool closed.');
          process.exit(0);
        } catch (err) {
          console.error('[Shutdown] Error closing database pool:', err);
          process.exit(1);
        }
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[Bootstrap] Failed to start server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  bootstrap();
}
