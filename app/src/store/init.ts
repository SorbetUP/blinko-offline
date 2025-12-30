import { enableStaticRendering } from 'mobx-react-lite';
import { useEffect } from 'react';
import { ToastPlugin } from './module/Toast/Toast';
import { SyncStore } from './sync/syncStore';
import { ImageCacheStore } from './cache/imageCacheStore';
import { rootStore } from '.';
enableStaticRendering(typeof window === 'undefined');

export const initStore = () => {
  useEffect(() => {
    rootStore.addStores([
      new ToastPlugin(),
      new SyncStore(),
      new ImageCacheStore()
    ]);
  }, []);
};
