import { Router, Request, Response } from 'express';
import { usersService } from './users.service';

export const usersRouter = Router();

// GET /api/users/:userId/orders - Order history for buyer (Rule 8)
usersRouter.get('/:userId/orders', async (req: Request, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const orders = await usersService.getUserOrders(userId);
    res.json({ success: true, data: orders });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/users/:userId/tickets - Issued tickets for buyer (Rule 8)
usersRouter.get('/:userId/tickets', async (req: Request, res: Response) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const tickets = await usersService.getUserTickets(userId);
    res.json({ success: true, data: tickets });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
