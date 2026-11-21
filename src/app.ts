import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { eventsRouter } from './modules/events/events.router';
import { ordersRouter } from './modules/orders/orders.router';
import { paymentsRouter } from './modules/payments/payments.router';
import { usersRouter } from './modules/users/users.router';

export function createApp(): Application {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Serve static UI frontend
  const publicDir = path.join(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      service: 'ticket-selling-api',
    });
  });

  // Mount API routers
  app.use('/api/events', eventsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/users', usersRouter);

  // 404 Handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: 'Route not found' });
  });

  // Global Error Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled API Error:', err);
    const status = err.statusCode || 500;
    res.status(status).json({
      success: false,
      error: err.message || 'Internal server error',
    });
  });

  return app;
}
