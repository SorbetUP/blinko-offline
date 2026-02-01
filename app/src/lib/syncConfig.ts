import { getSavedEndpoint, saveBlinkoEndpoint } from './blinkoEndpoint';

const SYNC_ENABLED_KEY = 'blinkoSyncEnabled';
const SYNC_TOKEN_KEY = 'blinkoRemoteToken';

export const getSyncEnabled = () => {
  try {
    return window.localStorage.getItem(SYNC_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
};

export const setSyncEnabled = (enabled: boolean) => {
  try {
    window.localStorage.setItem(SYNC_ENABLED_KEY, String(enabled));
  } catch {
    // ignore
  }
};

export const getSyncEndpoint = () => {
  try {
    return getSavedEndpoint() || '';
  } catch {
    return '';
  }
};

export const setSyncEndpoint = (endpoint: string) => {
  try {
    saveBlinkoEndpoint(endpoint);
  } catch {
    // ignore
  }
};

export const getSyncToken = () => {
  try {
    return window.localStorage.getItem(SYNC_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

export const setSyncToken = (token: string) => {
  try {
    if (!token) {
      window.localStorage.removeItem(SYNC_TOKEN_KEY);
      return;
    }
    window.localStorage.setItem(SYNC_TOKEN_KEY, token);
  } catch {
    // ignore
  }
};

