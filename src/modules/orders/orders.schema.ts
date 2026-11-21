import { z } from 'zod';

export const createOrderSchema = z.object({
  user_id: z.string().min(1, 'user_id is required').max(100),
  event_id: z.string().min(1, 'event_id is required'),
  items: z
    .array(
      z.object({
        ticket_type_id: z.string().min(1, 'ticket_type_id is required'),
        quantity: z.number().int().positive('Quantity must be at least 1'),
      })
    )
    .min(1, 'Order must contain at least 1 item'),
});

export const cancelOrderSchema = z.object({
  user_id: z.string().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
