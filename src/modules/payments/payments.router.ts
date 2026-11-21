import { Router, Request, Response } from 'express';
import { webhookPayloadSchema, simulatePaymentSchema } from './payments.schema';
import { paymentsService } from './payments.service';

export const paymentsRouter = Router();

// POST /api/payments/webhook - Webhook endpoint supporting idempotency & late delivery
paymentsRouter.post('/webhook', async (req: Request, res: Response) => {
  try {
    const parsed = webhookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsed.error.issues,
      });
    }

    const result = await paymentsService.processPaymentWebhook(parsed.data, req.body);

    if (result.code === 'ORDER_EXPIRED' || result.code === 'ORDER_CANCELLED') {
      return res.status(422).json(result);
    }

    return res.status(200).json(result);
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// POST /api/payments/simulate - Direct endpoint to mark order as paid (Rule 6)
paymentsRouter.post('/simulate', async (req: Request, res: Response) => {
  try {
    const parsed = simulatePaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsed.error.issues,
      });
    }

    const result = await paymentsService.simulatePayment(parsed.data.order_id);

    if (result.code === 'ORDER_EXPIRED' || result.code === 'ORDER_CANCELLED') {
      return res.status(422).json(result);
    }

    res.json(result);
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// POST /api/orders/:id/pay - Alternative direct endpoint to pay by order ID
paymentsRouter.post('/orders/:id/pay', async (req: Request, res: Response) => {
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
