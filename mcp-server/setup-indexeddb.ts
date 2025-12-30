import { 
  indexedDB, 
  IDBKeyRange, 
  IDBCursor, 
  IDBCursorWithValue,
  IDBDatabase,
  IDBFactory,
  IDBIndex,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent
} from 'fake-indexeddb';

// Setup all IndexedDB globals
(globalThis as any).indexedDB = indexedDB;
(globalThis as any).IDBKeyRange = IDBKeyRange;
(globalThis as any).IDBCursor = IDBCursor;
(globalThis as any).IDBCursorWithValue = IDBCursorWithValue;
(globalThis as any).IDBDatabase = IDBDatabase;
(globalThis as any).IDBFactory = IDBFactory;
(globalThis as any).IDBIndex = IDBIndex;
(globalThis as any).IDBObjectStore = IDBObjectStore;
(globalThis as any).IDBOpenDBRequest = IDBOpenDBRequest;
(globalThis as any).IDBRequest = IDBRequest;
(globalThis as any).IDBTransaction = IDBTransaction;
(globalThis as any).IDBVersionChangeEvent = IDBVersionChangeEvent;
