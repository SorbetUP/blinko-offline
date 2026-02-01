import { createRemoteClient, createSmartClient } from './trpcSmartClient';

export let api = createSmartClient();
export let remoteApi = createRemoteClient({ useStream: false });
export let streamApi = createRemoteClient({ useStream: true });

export const reinitializeTrpcApi = () => {
  api = createSmartClient();
  remoteApi = createRemoteClient({ useStream: false });
  streamApi = createRemoteClient({ useStream: true });
  return { api, remoteApi, streamApi };
};
