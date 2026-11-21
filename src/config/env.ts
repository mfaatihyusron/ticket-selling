import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5432/ticket_db',
  orderExpiryMinutes: parseInt(process.env.ORDER_EXPIRY_MINUTES || '15', 10),
  expirySweeperIntervalMs: parseInt(process.env.EXPIRY_SWEEPER_INTERVAL_MS || '15000', 10),
  webhookSecret: process.env.WEBHOOK_SECRET || 'supersecretwebhookkey123',
};
