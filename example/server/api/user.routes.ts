import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { UserController } from '../services/user.service';

const router = Router();

router.post('/login', UserController.login);
router.post('/register', UserController.register);
router.get('/profile', authenticate, UserController.getProfile);
router.put('/profile', authenticate, UserController.updateProfile);

export default router;
