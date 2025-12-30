# Blinko MCP Server - Mode Offline Complet

Serveur MCP (Model Context Protocol) pour Blinko avec toutes les fonctionnalités de l'application utilisateur: mode offline, synchronisation bidirectionnelle, cache local, et résolution de conflits.

## Fonctionnalités

### ✅ Mode Offline Complet
- **IndexedDB local** (via fake-indexeddb) pour stocker les notes
- **Queue de synchronisation** pour toutes les opérations (CREATE, UPDATE, DELETE)
- **Fonctionne sans connexion** - toutes les opérations sont mises en queue

### ✅ Synchronisation Bidirectionnelle
- **PUSH**: Envoie les modifications locales au serveur
- **PULL**: Récupère les changements du serveur
- **Auto-sync**: Toutes les 5 minutes quand online
- **Sync manuelle**: Via l'outil `sync_now`

### ✅ Résolution de Conflits
- Détection automatique des conflits
- **Stratégie**: Dernière modification gagne
- Compatible avec le versioning backend (max 10 versions par note)

### ✅ Outils MCP Disponibles

| Outil | Description | Fonctionne Offline |
|-------|-------------|-------------------|
| `create_note` | Créer une nouvelle note | ✅ Oui |
| `list_notes` | Lister toutes les notes locales | ✅ Oui |
| `search_notes` | Rechercher dans le cache local | ✅ Oui |
| `update_note` | Modifier une note existante | ✅ Oui |
| `delete_note` | Supprimer une note | ✅ Oui |
| `sync_now` | Forcer la synchronisation | ❌ Requiert connexion |
| `get_sync_status` | État de la sync (pending ops, etc.) | ✅ Oui |
| `set_offline_mode` | Basculer online/offline manuellement | ✅ Oui |

## Installation

```bash
cd mcp-server
bun install
bun run build
```

## Configuration

Le serveur est configuré via des variables d'environnement:

```bash
BLINKO_BASE_URL=http://localhost:1111    # URL du serveur Blinko
BLINKO_TOKEN=your-jwt-token-here         # Token d'authentification JWT
```

### Configuration Claude Code

Le serveur est configuré dans `.kilocode/mcp.json`:

```json
{
  "mcpServers": {
    "blinko-offline": {
      "command": "node",
      "args": [
        "/Users/sorbet/Desktop/Dev/blinko-offline/mcp-server/dist/index.js"
      ],
      "env": {
        "BLINKO_BASE_URL": "http://localhost:1111",
        "BLINKO_TOKEN": ""
      }
    }
  }
}
```

## Tests

Un script de test complet est fourni pour valider toutes les fonctionnalités:

```bash
npx tsx test.ts
```

### Résultats des Tests

```
✅ Création de 3 notes en mode offline
✅ Recherche locale fonctionne (3 résultats)
✅ Modification de note fonctionne
✅ Suppression de note fonctionne
✅ Queue de synchronisation: 5 opérations en attente

📊 État final:
   - Total notes: 2
   - Notes synchronisées: 0
   - Notes en attente: 2
   - Opérations en queue: 5
   - Opérations échouées: 0
```

## Architecture

### Structure de la Base de Données (IndexedDB)

```typescript
// Table: notes
interface DBNote {
  id: number;                    // ID (négatif pour les notes offline)
  content: string;               // Contenu markdown
  type: number;                  // Type de note
  isArchived: boolean;           // Archivée
  isTop: boolean;                // Épinglée
  createdAt: string;             // Date de création
  updatedAt: string;             // Date de modification serveur
  localUpdatedAt: number;        // Timestamp local (pour conflits)
  syncStatus: 'synced' | 'pending' | 'conflict';
}

// Table: syncQueue
interface SyncOperation {
  id?: number;
  entityType: 'note' | 'attachment';
  entityId: number;
  operationType: 'create' | 'update' | 'delete';
  data: any;                     // Données de l'entité
  timestamp: number;             // Timestamp de l'opération
  status: 'pending' | 'in_progress' | 'failed';
  retryCount?: number;           // Nombre de tentatives (max 5)
}
```

### Flux de Synchronisation

```
┌─────────────────┐
│  Création Note  │
│   (offline)     │
└────────┬────────┘
         │
         ├─► Notes Table (syncStatus: pending)
         │
         └─► SyncQueue (operationType: create)
                    │
                    ▼
            ┌───────────────┐
            │  Mode Online  │
            └───────┬───────┘
                    │
         ┌──────────┴──────────┐
         │                     │
         ▼                     ▼
    PUSH Changes         PULL Changes
    (Local → Server)     (Server → Local)
         │                     │
         └──────────┬──────────┘
                    │
                    ▼
            Conflict Resolution
            (Dernière modif gagne)
```

### Logique de Conflit

```
SI note locale.syncStatus == 'pending' ET note serveur existe:
    localTimestamp = note locale.localUpdatedAt
    serverTimestamp = note serveur.updatedAt

    SI localTimestamp > serverTimestamp:
        ➜ Garder version locale
        ➜ La PUSH va écraser le serveur
    SINON:
        ➜ Utiliser version serveur
        ➜ Supprimer l'opération de la queue
```

## Comparaison avec l'App Utilisateur

| Fonctionnalité | App Web/Mobile | MCP Server |
|---------------|---------------|------------|
| IndexedDB local | ✅ Dexie | ✅ Dexie + fake-indexeddb |
| Mode offline | ✅ | ✅ |
| Sync bidirectionnelle | ✅ | ✅ |
| Cache d'images | ✅ LRU (100MB) | ⏳ À implémenter |
| Résolution conflits | ✅ Auto | ✅ Auto (même logique) |
| Sync périodique | ✅ 5 min | ✅ 5 min |
| Indicateur UI | ✅ SyncStatusIndicator | ❌ Logs seulement |

## Utilisation

### 1. Créer une note offline

```typescript
// Via MCP
create_note({
  content: "Ma première note offline!",
  isTop: false
})
// ➜ Note créée avec ID temporaire négatif
// ➜ Ajoutée à la queue de sync
// ➜ Sera synchronisée automatiquement quand online
```

### 2. Lister les notes

```typescript
// Via MCP
list_notes({ limit: 20 })
// ➜ Retourne toutes les notes du cache local
// ➜ Fonctionne même offline
```

### 3. Rechercher

```typescript
// Via MCP
search_notes({ query: "important" })
// ➜ Recherche dans le cache local
// ➜ Pas besoin de connexion
```

### 4. Forcer la synchronisation

```typescript
// Via MCP
sync_now()
// ➜ PUSH: Envoie toutes les opérations en queue
// ➜ PULL: Récupère les changements du serveur
// ➜ Résout les conflits automatiquement
```

### 5. Vérifier l'état

```typescript
// Via MCP
get_sync_status()
// ➜ {
//     online: true,
//     syncing: false,
//     lastSyncTime: "2025-12-30T11:45:00.000Z",
//     pendingOperations: 3,
//     failedOperations: 0,
//     totalNotes: 42,
//     pendingNotes: 3
//   }
```

## Limitations Actuelles

1. **Cache d'images**: Pas encore implémenté (prévu)
2. **Authentification**: Requiert un token JWT valide pour la sync
3. **Attachments**: Sync des fichiers pas encore implémentée
4. **UI**: Pas d'interface visuelle (logs seulement)

## Prochaines Étapes

- [ ] Implémenter le cache d'images (ImageCacheStore)
- [ ] Ajouter support des attachments dans la sync
- [ ] Améliorer les logs avec niveaux (debug, info, error)
- [ ] Ajouter métriques de performance
- [ ] Persister la base IndexedDB sur disque (SQLite?)
- [ ] Ajouter tests unitaires

## Développement

### Structure des fichiers

```
mcp-server/
├── index.ts              # Serveur MCP principal
├── test.ts               # Tests complets
├── setup-indexeddb.ts    # Configuration IndexedDB pour Node.js
├── package.json          # Dépendances
├── tsconfig.json         # Config TypeScript
└── README.md             # Cette documentation
```

### Debugging

Le serveur écrit sur stderr (console.error) pour ne pas interférer avec le protocole MCP stdio:

```typescript
console.error('[Sync] Starting bidirectional sync...');
console.error('[Sync] Pushing 3 operations...');
console.error('[Sync] Sync completed successfully');
```

## Licence

Même licence que Blinko principal.
