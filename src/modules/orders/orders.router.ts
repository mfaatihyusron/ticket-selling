import { Router, Request, Response } from 'express';
import { createOrderSchema, cancelOrderSchema } from './orders.schema';
import { ordersService } from './orders.service';
import { paymentsService } from '../payments/payments.service';

export const ordersRouter = Router();

// POST /api/orders/:id/pay - Direct simulation endpoint to mark order as paid (Rule 6)
ordersRouter.post('/:id/pay', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await paymentsService.simulatePayment(id);

    if (result.code === 'ORDER_EXPIRED' || result.code === 'ORDER_CANCELLED') {
      return res.status(422).json(result);
    }

    res.json(result);
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// POST /api/orders - Create new order (holds quota for 15 minutes)
ordersRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsed.error.issues,
      });
    }

    const order = await ordersService.createOrder(parsed.data);
    res.status(201).json({ success: true, data: order });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// GET /api/orders/:id - Get order status & items
ordersRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const order = await ordersService.getOrderById(id);
    res.json({ success: true, data: order });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// POST /api/orders/:id/cancel - Cancel order before payment (quota immediately restored)
ordersRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const parsed = cancelOrderSchema.safeParse(req.body);
    const userId = parsed.success ? parsed.data.user_id : undefined;

    const cancelledOrder = await ordersService.cancelOrder(id, userId);
    res.json({
      success: true,
      message: 'Order cancelled successfully and quota restored.',
      data: cancelledOrder,
    });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// POST /api/orders/cleanup-expired - Force immediate sweep of expired orders (for tests & demo)
ordersRouter.post('/cleanup-expired', async (_req: Request, res: Response) => {
  try {
    const count = await ordersService.sweepExpiredOrders();
    res.json({
      success: true,
      message: `Cleaned up ${count} expired order(s).`,
      swept_count: count,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
