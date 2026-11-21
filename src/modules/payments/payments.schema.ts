import { z } from 'zod';

export const webhookPayloadSchema = z.object({
  payment_reference: z.string().min(1, 'payment_reference is required'),
  order_id: z.string().min(1, 'order_id is required'),
  amount: z.number().positive('amount must be positive').optional(),
  status: z.enum(['SUCCESS', 'FAILED']).default('SUCCESS'),
});

export const simulatePaymentSchema = z.object({
  order_id: z.string().min(1, 'order_id is required'),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type SimulatePaymentInput = z.infer<typeof simulatePaymentSchema>;
