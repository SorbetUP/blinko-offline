# 📴 Mode Offline - Blinko

## Vue d'ensemble

Blinko dispose désormais d'un **mode offline complet** permettant de continuer à travailler sans connexion internet. Toutes les données sont synchronisées automatiquement lors du retour en ligne.

## ✨ Fonctionnalités

### 🔄 CRUD Complet Offline

- ✅ **Créer** des notes offline
- ✅ **Lire** les notes précédemment synchronisées
- ✅ **Modifier** des notes existantes
- ✅ **Supprimer** et archiver des notes
- ✅ Toutes les modifications sont mises en file d'attente pour synchronisation

### 📦 Stockage Local Intelligent

- **IndexedDB** via Dexie.js (capacité: 50MB+)
- Cache intelligent LRU pour images fréquemment consultées
- Gestion automatique de l'espace de stockage
- Migration automatique depuis localStorage

### 🔀 Synchronisation Bidirectionnelle

- **Auto-sync** au retour de connexion
- Synchronisation delta (uniquement les changements depuis dernière sync)
- Gestion des conflits avec 3 stratégies de résolution
- File d'attente persistante avec retry automatique

### ⚔️ Détection et Résolution de Conflits

Lorsque le même contenu est modifié sur plusieurs appareils offline:

1. **Détection automatique** lors de la synchronisation
2. **Trois stratégies de résolution**:
   - Garder la version locale
   - Garder la version serveur
   - Fusionner les deux versions
3. **Interface utilisateur** pour résolution manuelle
4. **Historique** des conflits résolus

### 🖼️ Cache d'Images Intelligent

- **LRU (Least Recently Used)** éviction
- Taille configurable (50MB - 500MB)
- Auto-download des images fréquemment consultées
- Placeholder pour images non cachées en mode offline

## 🏗️ Architecture Technique

### Structure de Données (IndexedDB)

```typescript
// 5 tables principales
notes          // Cache complet des notes avec syncStatus
attachments    // Métadonnées + blobs images
syncQueue      // File d'attente des opérations offline
syncMetadata   // Timestamps de dernière sync
conflicts      // Conflits non résolus
```

### Nouveaux Stores MobX

```
app/src/store/
├── sync/
│   ├── syncStore.ts          // Orchestration sync bidirectionnelle
│   ├── syncQueueStore.ts     // Gestion queue + retry
│   └── conflictStore.ts      // Détection et résolution conflits
└── cache/
    └── imageCacheStore.ts    // Cache LRU images
```

### Flux de Synchronisation

```
OFFLINE → ONLINE:
1. Détection event 'online'
2. PULL: Récupération changements serveur
3. MERGE: Détection conflits (compare timestamps)
4. PUSH: Envoi opérations en attente
5. CLEANUP: Nettoyage queue
```

## 🎯 Utilisation

### Créer une Note Offline

```typescript
// Automatique! Fonctionne exactement comme online
await blinkoStore.upsertNote({
  content: "Ma note offline",
  type: NoteType.BLINKO
});
// ✅ Sauvegardée dans IndexedDB
// ✅ Ajoutée à la sync queue
// ✅ UI mise à jour instantanément
```

### Modifier une Note Offline

```typescript
await blinkoStore.upsertNote({
  id: 123,
  content: "Contenu modifié",
  // Autres champs...
});
// ✅ Marquée comme 'pending'
// ✅ Sera synchronisée au retour online
```

### Synchronisation Manuelle

```typescript
import { SyncStore } from '@/store/sync/syncStore';
import { RootStore } from '@/store';

const syncStore = RootStore.Get(SyncStore);
await syncStore.sync();
```

### Configuration du Cache d'Images

```typescript
import { ImageCacheStore } from '@/store/cache/imageCacheStore';

const imageCache = RootStore.Get(ImageCacheStore);

// Changer taille max (en bytes)
imageCache.setMaxSize(200 * 1024 * 1024); // 200MB

// Vider le cache
await imageCache.clearCache();

// Obtenir statistiques
console.log(imageCache.usagePercentage); // 45.2%
console.log(imageCache.formatSize(imageCache.currentSize)); // "45.2 MB"
```

### Résoudre un Conflit

```typescript
import { ConflictStore } from '@/store/sync/conflictStore';

const conflictStore = RootStore.Get(ConflictStore);

// Stratégie: garder local
await conflictStore.resolveConflict(conflictId, 'local');

// Stratégie: garder serveur
await conflictStore.resolveConflict(conflictId, 'server');

// Stratégie: fusionner
await conflictStore.resolveConflict(conflictId, 'merge', mergedData);
```

## 🎨 Composants UI

### SyncIndicator

Affiche le statut de connexion et synchronisation:

```tsx
import { SyncIndicator } from '@/components/Sync/SyncIndicator';

// Dans votre Layout:
<SyncIndicator />
```

**États:**
- 🟢 Online (vert)
- 🔴 Offline (rouge)
- 🟡 Syncing... (jaune)
- 🟠 Sync Error (orange)

## 📡 API Backend

### Nouveau Endpoint: Delta Sync

```typescript
// GET /api/trpc/notes.listSince
api.notes.listSince.query({
  since: new Date('2024-01-01'),
  limit: 100
});
```

Retourne toutes les notes modifiées depuis `since`.

## 🔧 Configuration

### Variables d'Environnement

Aucune variable supplémentaire requise! Le mode offline fonctionne out-of-the-box.

### Settings Utilisateur (à venir)

Dans les paramètres de l'application:

- **Taille max cache**: 50MB - 500MB
- **Auto-download images**: ON/OFF
- **Fréquence sync**: 1 min - 30 min
- **Sync en arrière-plan** (Tauri): ON/OFF

## 🐛 Résolution de Problèmes

### La synchronisation ne se déclenche pas

1. Vérifier que `baseStore.isOnline === true`
2. Ouvrir DevTools → Application → IndexedDB → BlinkoDatabase
3. Vérifier la table `syncQueue` pour opérations pending

### Quota IndexedDB dépassé

```typescript
// L'app évictera automatiquement les images LRU
// Ou manuellement:
const imageCache = RootStore.Get(ImageCacheStore);
await imageCache.pruneCache();
```

### Conflit non résolu

1. Ouvrir la liste des conflits
2. Comparer les versions
3. Choisir stratégie de résolution
4. Appliquer

### Migration depuis ancienne version

La migration localStorage → IndexedDB est **automatique** au premier chargement.

Pour forcer une migration:
```typescript
import { migrateOfflineNotes } from '@/lib/db/migrate';
await migrateOfflineNotes();
```

## 📊 Métriques et Monitoring

### Obtenir les statistiques

```typescript
const syncQueue = RootStore.Get(SyncQueueStore);
console.log('Pending:', syncQueue.queueLength);
console.log('Failed:', syncQueue.failedCount);

const syncStore = RootStore.Get(SyncStore);
console.log('Last sync:', new Date(syncStore.lastSyncTime));
console.log('Is syncing:', syncStore.isSyncing);

const conflictStore = RootStore.Get(ConflictStore);
console.log('Unresolved conflicts:', conflictStore.unresolvedCount);
```

## 🚀 Performance

### Benchmarks (approximatifs)

- **Sync 100 notes**: ~2-3 secondes
- **Query IndexedDB**: <50ms
- **Cache LRU eviction**: <100ms
- **Conflict detection**: <10ms par note

### Optimisations

- Batch operations dans IndexedDB
- Lazy loading des images
- Delta sync (pas full sync)
- Indexes optimisés pour queries fréquentes

## 🔐 Sécurité

- ✅ Données offline **NON chiffrées** (IndexedDB)
- ✅ Tokens/secrets **JAMAIS** stockés dans IndexedDB
- ✅ Validation côté serveur de toutes les sync operations
- ⚠️ En environnement partagé, considérer le chiffrement (à implémenter)

## 📚 Pour Aller Plus Loin

### Ressources

- [Dexie.js Documentation](https://dexie.org/)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) (pour PWA)

### Roadmap Futures Améliorations

- [ ] Chiffrement des données offline
- [ ] Service Worker pour PWA complète
- [ ] Sync en background (Tauri)
- [ ] Compression des données
- [ ] Merge automatique intelligent (diff-match-patch)
- [ ] Export/import du cache offline
- [ ] Analytics détaillées de sync

---

**Dernière mise à jour**: 2025-12-30
**Version**: 1.0.0
