import { createLocalNotesService } from '../../../shared/local-backend/localNotesService';
import { tauriDbAdapter } from './localDbAdapter';

const getStoredUserId = () => {
  try {
    if (typeof window === 'undefined') return '';
    const raw = window.localStorage.getItem('blinkoToken');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return parsed?.user?.id ? String(parsed.user.id) : '';
  } catch {
    return '';
  }
};

export const localNotesService = createLocalNotesService({
  getUserId: () => getStoredUserId(),
  db: tauriDbAdapter,
});
