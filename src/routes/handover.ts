import { Hono } from 'hono';
import { handleHandover } from '../handlers/handover.js';

const handoverRouter = new Hono();

// POST /handover — primary endpoint (spec)
handoverRouter.post('/', handleHandover);

// GET /handover — convenience for browser / curl demo (no body required)
handoverRouter.get('/', handleHandover);

export default handoverRouter;
