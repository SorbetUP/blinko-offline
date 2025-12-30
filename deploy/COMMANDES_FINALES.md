# 🚀 Build Android - Commandes à Copier-Coller

## ✅ Ce que j'ai préparé

- ✅ Archive du projet (9.1MB) : `blinko.tar.gz`
- ✅ Script ONE-COMMAND qui fait tout automatiquement
- ✅ Mode offline complet intégré
- ✅ Prêt pour build Android

---

## 📋 Instructions Étape par Étape

### 1️⃣ Copier l'archive sur Proxmox

```bash
# Depuis votre Mac (dans le terminal)
cd /Users/sorbet/Desktop/Dev/blinko-offline

# Copier archive
scp blinko.tar.gz root@192.168.0.235:/root/

# Copier script
scp deploy/ONE_COMMAND_ANDROID.sh root@192.168.0.235:/root/
```

**Mot de passe**: `<mot-de-passe-proxmox>`

---

### 2️⃣ Exécuter le script sur Proxmox

```bash
# Se connecter à Proxmox
ssh root@192.168.0.235

# Rendre le script exécutable
chmod +x /root/ONE_COMMAND_ANDROID.sh

# LANCER LE BUILD (tout automatique!)
./ONE_COMMAND_ANDROID.sh
```

**Ce que fait le script**:
- ✅ Crée un conteneur LXC Ubuntu 22.04
- ✅ Installe Node.js 20, Bun, Java 17
- ✅ Installe Android SDK avec tous les outils
- ✅ Copie et extrait le projet
- ✅ Build l'APK Android
- ✅ Extrait l'APK vers `/root/blinko-android.apk`

**Durée**: ~15-30 minutes selon la vitesse du serveur

---

### 3️⃣ Récupérer l'APK

```bash
# Depuis votre Mac
scp root@192.168.0.235:/root/blinko-android.apk ~/Desktop/
```

---

### 4️⃣ Installer sur téléphone

#### Option A: Via ADB (si activé sur le téléphone)

```bash
# Activer USB Debugging sur le téléphone:
# Paramètres → À propos → Taper 7x sur "Numéro de build"
# Paramètres → Options développeur → Activer "Débogage USB"

# Connecter téléphone via USB
adb devices  # Vérifier connexion

# Installer
adb install ~/Desktop/blinko-android.apk
```

#### Option B: Installation manuelle

1. Copier `blinko-android.apk` sur le téléphone (email, cloud, etc.)
2. Sur le téléphone, ouvrir le fichier
3. Autoriser "Sources inconnues" si demandé
4. Installer

---

## 🔍 Vérifications & Debug

### Si le build échoue

```bash
# Se connecter au conteneur
ssh root@192.168.0.235
pct enter 200

# Vérifier les logs
cd /root/blinko/app
bunx tauri android build --apk --verbose
```

### Vérifier l'environnement

```bash
# Dans le conteneur
java -version        # Doit afficher Java 17
bun --version        # Doit afficher Bun
node --version       # Doit afficher Node 20.x
echo $ANDROID_HOME   # Doit afficher /opt/android-sdk
```

### Rebuild manuel si nécessaire

```bash
# Dans le conteneur (pct enter 200)
cd /root/blinko
export PATH="$HOME/.bun/bin:$PATH"
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

# Clean build
rm -rf app/src-tauri/gen/android
cd app
bunx tauri android init
bunx tauri android build --apk
```

---

## 📱 Test de l'APK

### Sur émulateur Android (si vous avez Android Studio)

```bash
# Lancer émulateur
emulator -avd <nom_emulateur>

# Installer
adb install ~/Desktop/blinko-android.apk
```

### Sur téléphone physique

1. Installer l'APK
2. Ouvrir Blinko
3. Tester mode offline:
   - Activer mode avion
   - Créer une note
   - Désactiver mode avion
   - Vérifier sync automatique ✅

---

## 🎯 Résumé des Commandes Complètes

```bash
# 1. Sur votre Mac - Copier vers Proxmox
cd /Users/sorbet/Desktop/Dev/blinko-offline
scp blinko.tar.gz deploy/ONE_COMMAND_ANDROID.sh root@192.168.0.235:/root/

# 2. Sur Proxmox - Build Android
ssh root@192.168.0.235
chmod +x /root/ONE_COMMAND_ANDROID.sh
./ONE_COMMAND_ANDROID.sh

# 3. Sur votre Mac - Récupérer APK
scp root@192.168.0.235:/root/blinko-android.apk ~/Desktop/

# 4. Installer sur téléphone
adb install ~/Desktop/blinko-android.apk
```

---

## 📊 Informations Techniques

### Conteneur LXC Créé

- **ID**: 200
- **Nom**: blinko-android
- **OS**: Ubuntu 22.04
- **RAM**: 6GB
- **CPU**: 4 cores
- **Disk**: 30GB
- **Password**: <mot-de-passe-conteneur>

### APK Généré

- **Package**: com.blinko.app
- **Taille**: ~40-60 MB (optimisé)
- **Min Android**: 7.0 (API 24)
- **Target Android**: 13 (API 33)

### Fonctionnalités Incluses

✅ Mode offline complet (CRUD)
✅ Sync bidirectionnelle
✅ Détection de conflits
✅ Cache intelligent d'images
✅ Migration auto localStorage → IndexedDB

---

## ⚠️ Important - Sécurité

1. **Changez le mot de passe Proxmox** après cette session
2. Le conteneur a le mot de passe défini lors de la création (changez-le)
3. Pour production, signez l'APK avec votre keystore

---

## 🆘 Support

Si le script échoue, contactez-moi avec:
- Les logs d'erreur
- Output de `java -version` dans le conteneur
- Output de `echo $ANDROID_HOME` dans le conteneur

**Prêt? Lancez la commande 1 ci-dessus! 🚀**
