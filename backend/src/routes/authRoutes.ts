import { Router } from 'express';
import { z } from 'zod';
import { AuthError, loginWithUsername } from '../services/authService.js';
import {
  type AuthenticatedRequest,
  requireAuth,
} from '../utils/authMiddleware.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Usuario y contrasena son requeridos.' });
    return;
  }

  try {
    const result = await loginWithUsername(parsed.data.username, parsed.data.password);
    res.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }

    console.error('Login error:', error);
    res.status(500).json({ message: 'Error interno.' });
  }
});

router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

export { router as authRoutes };
