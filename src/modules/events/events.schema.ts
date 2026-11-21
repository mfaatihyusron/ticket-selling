import { z } from 'zod';

export const createEventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().optional(),
  ticket_types: z
    .array(
      z.object({
        name: z.string().min(1).max(50),
        price: z.number().positive('Price must be greater than 0'),
        quota: z.number().int().positive('Quota must be at least 1'),
      })
    )
    .min(1, 'At least one ticket type is required'),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
