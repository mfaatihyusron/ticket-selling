import { Router, Request, Response } from 'express';
import { createEventSchema } from './events.schema';
import { eventsService } from './events.service';

export const eventsRouter = Router();

// GET /api/events - List all events with real-time remaining quota
eventsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const events = await eventsService.getAllEvents();
    res.json({ success: true, data: events });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/events/:id - Get event details with ticket types & quotas
eventsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const event = await eventsService.getEventById(id);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }
    res.json({ success: true, data: event });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/events - Create new event with ticket types
eventsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsed.error.issues,
      });
    }

    const newEvent = await eventsService.createEvent(parsed.data);
    res.status(201).json({ success: true, data: newEvent });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
