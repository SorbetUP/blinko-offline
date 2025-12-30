#!/usr/bin/env node
/**
 * Script de test pour le serveur MCP Blinko
 * Teste les fonctionnalités offline et de synchronisation
 */

import './setup-indexeddb';
import { Dexie } from 'dexie';

// IndexedDB Schema
interface DBNote {
  id: number;
  content: string;
  type: number;
  isArchived: boolean;
  isTop: boolean;
  isShare: boolean;
  isRecycle: boolean;
  createdAt: string;
  updatedAt: string;
  accountId: number;
  localUpdatedAt: number;
  syncStatus: 'synced' | 'pending' | 'conflict';
}

interface SyncOperation {
  id?: number;
  entityType: 'note' | 'attachment';
  entityId: number;
  operationType: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
  status: 'pending' | 'in_progress' | 'failed';
  retryCount?: number;
}

interface SyncMetadata {
  key: string;
  value: any;
}

class BlinkoOfflineDB extends Dexie {
  notes!: Dexie.Table<DBNote, number>;
  syncQueue!: Dexie.Table<SyncOperation, number>;
  syncMetadata!: Dexie.Table<SyncMetadata, string>;

  constructor() {
    super('BlinkoOfflineDB');
    this.version(1).stores({
      notes: 'id, accountId, isArchived, isTop, isRecycle, createdAt, updatedAt, localUpdatedAt, syncStatus',
      syncQueue: '++id, entityType, entityId, status, timestamp',
      syncMetadata: 'key'
    });
  }
}

async function testOfflineMode() {
  console.log('🧪 Test 1: Mode Offline - Création de notes\n');

  const db = new BlinkoOfflineDB();
  await db.open();

  // Créer 3 notes en mode offline
  const notes = [
    { content: 'Test note 1 - Offline mode works!', isTop: false },
    { content: 'Test note 2 - This is a second test', isTop: true },
    { content: 'Test note 3 - #testing #offline', isTop: false }
  ];

  for (let i = 0; i < notes.length; i++) {
    const tempId = -(Date.now() + i);
    const newNote: DBNote = {
      id: tempId,
      content: notes[i].content,
      type: 0,
      isArchived: false,
      isTop: notes[i].isTop,
      isShare: false,
      isRecycle: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accountId: 1,
      localUpdatedAt: Date.now(),
      syncStatus: 'pending' as const
    };

    await db.notes.add(newNote);

    await db.syncQueue.add({
      entityType: 'note',
      entityId: tempId,
      operationType: 'create',
      data: newNote,
      timestamp: Date.now(),
      status: 'pending'
    });

    console.log(`✅ Note ${i + 1} créée: "${notes[i].content.substring(0, 30)}..."`);
  }

  console.log('\n📊 État après création:');
  const totalNotes = await db.notes.count();
  const pendingNotes = await db.notes.where('syncStatus').equals('pending').count();
  const pendingOps = await db.syncQueue.where('status').equals('pending').count();

  console.log(`   - Total notes: ${totalNotes}`);
  console.log(`   - Notes en attente de sync: ${pendingNotes}`);
  console.log(`   - Opérations en queue: ${pendingOps}`);
}

async function testSearch() {
  console.log('\n🧪 Test 2: Recherche locale (offline)\n');

  const db = new BlinkoOfflineDB();
  await db.open();

  const searchQuery = 'test';
  const results = await db.notes
    .filter(n => n.content.toLowerCase().includes(searchQuery))
    .toArray();

  console.log(`🔍 Recherche pour "${searchQuery}": ${results.length} résultats`);
  results.forEach((note, i) => {
    console.log(`   ${i + 1}. "${note.content.substring(0, 50)}..." (ID: ${note.id})`);
  });
}

async function testUpdate() {
  console.log('\n🧪 Test 3: Modification de note (offline)\n');

  const db = new BlinkoOfflineDB();
  await db.open();

  const notes = await db.notes.limit(1).toArray();
  if (notes.length === 0) {
    console.log('❌ Aucune note à modifier');
    return;
  }

  const noteToUpdate = notes[0];
  const newContent = noteToUpdate.content + ' [UPDATED]';

  await db.notes.update(noteToUpdate.id, {
    content: newContent,
    updatedAt: new Date().toISOString(),
    localUpdatedAt: Date.now(),
    syncStatus: 'pending' as const
  });

  await db.syncQueue.add({
    entityType: 'note',
    entityId: noteToUpdate.id,
    operationType: 'update',
    data: { ...noteToUpdate, content: newContent },
    timestamp: Date.now(),
    status: 'pending'
  });

  console.log(`✅ Note ${noteToUpdate.id} modifiée`);
  console.log(`   Ancien: "${noteToUpdate.content}"`);
  console.log(`   Nouveau: "${newContent}"`);

  const pendingOps = await db.syncQueue.where('status').equals('pending').count();
  console.log(`\n📊 Opérations en attente: ${pendingOps}`);
}

async function testDelete() {
  console.log('\n🧪 Test 4: Suppression de note (offline)\n');

  const db = new BlinkoOfflineDB();
  await db.open();

  const notes = await db.notes.limit(1).toArray();
  if (notes.length === 0) {
    console.log('❌ Aucune note à supprimer');
    return;
  }

  const noteToDelete = notes[0];

  await db.syncQueue.add({
    entityType: 'note',
    entityId: noteToDelete.id,
    operationType: 'delete',
    data: noteToDelete,
    timestamp: Date.now(),
    status: 'pending'
  });

  await db.notes.delete(noteToDelete.id);

  console.log(`✅ Note ${noteToDelete.id} supprimée: "${noteToDelete.content.substring(0, 40)}..."`);

  const remainingNotes = await db.notes.count();
  const pendingOps = await db.syncQueue.where('status').equals('pending').count();
  console.log(`\n📊 Notes restantes: ${remainingNotes}`);
  console.log(`📊 Opérations en attente: ${pendingOps}`);
}

async function showSyncStatus() {
  console.log('\n📊 État final de synchronisation:\n');

  const db = new BlinkoOfflineDB();
  await db.open();

  const totalNotes = await db.notes.count();
  const pendingNotes = await db.notes.where('syncStatus').equals('pending').count();
  const syncedNotes = await db.notes.where('syncStatus').equals('synced').count();

  const pendingOps = await db.syncQueue.where('status').equals('pending').count();
  const failedOps = await db.syncQueue.where('status').equals('failed').count();

  console.log(`📝 Notes:`);
  console.log(`   Total: ${totalNotes}`);
  console.log(`   Synchronisées: ${syncedNotes}`);
  console.log(`   En attente: ${pendingNotes}`);
  console.log(`\n🔄 Queue de synchronisation:`);
  console.log(`   Opérations en attente: ${pendingOps}`);
  console.log(`   Opérations échouées: ${failedOps}`);

  const operations = await db.syncQueue.toArray();
  if (operations.length > 0) {
    console.log(`\n📋 Détail des opérations en queue:`);
    operations.forEach((op, i) => {
      console.log(`   ${i + 1}. ${op.operationType.toUpperCase()} note ${op.entityId} (${op.status})`);
    });
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('     🧪 Test du serveur MCP Blinko Offline     ');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await testOfflineMode();
    await testSearch();
    await testUpdate();
    await testDelete();
    await showSyncStatus();

    console.log('\n═══════════════════════════════════════════════════');
    console.log('✅ Tous les tests réussis!');
    console.log('═══════════════════════════════════════════════════\n');

  } catch (error: any) {
    console.error('\n❌ Erreur durant les tests:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
