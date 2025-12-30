# 📦 Déploiement Blinko sur Proxmox

## Option 1: Script Automatique (Recommandé)

### Sur le serveur Proxmox

```bash
# Copier le script sur Proxmox
scp deploy/proxmox-setup.sh root@192.168.0.235:/root/

# Se connecter et exécuter
ssh root@192.168.0.235
chmod +x /root/proxmox-setup.sh
./proxmox-setup.sh
```

Le script va créer automatiquement un conteneur LXC avec :
- Ubuntu 22.04
- Node.js 20
- Bun
- Android SDK
- 4GB RAM, 4 cores, 20GB disk

### Copier le projet dans le conteneur

```bash
# Sur Proxmox, copier le projet dans le conteneur
pct push 200 /path/to/blinko-offline /root/blinko-offline -r

# Entrer dans le conteneur
pct enter 200

# Lancer l'installation
cd /root/blinko-offline
chmod +x deploy/install-in-container.sh
./deploy/install-in-container.sh
```

## Option 2: Manuelle

### 1. Créer le conteneur

```bash
pct create 200 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
    --hostname blinko-prod \
    --password <mot-de-passe> \
    --storage local-lvm \
    --rootfs local-lvm:20 \
    --memory 4096 \
    --cores 4 \
    --net0 name=eth0,bridge=vmbr0,ip=dhcp \
    --features nesting=1,keyctl=1 \
    --unprivileged 1

pct start 200
```

### 2. Installer les dépendances

```bash
pct enter 200

# Update
apt-get update && apt-get upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Bun
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# Build tools
apt-get install -y git curl build-essential pkg-config libssl-dev

# Android SDK (pour builds Android)
apt-get install -y openjdk-17-jdk gradle unzip
mkdir -p /opt/android-sdk
cd /opt/android-sdk
wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip
unzip commandlinetools-linux-9477386_latest.zip
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
yes | sdkmanager --licenses
sdkmanager 'platform-tools' 'platforms;android-33' 'build-tools;33.0.0'
```

### 3. Déployer le projet

```bash
cd /root
# Copier ou cloner le projet ici
# pct push 200 /path/to/blinko-offline /root/blinko-offline -r

cd blinko-offline
bun install
bun run prisma:generate
bun run build:web
```

## Builds Plateformes

### 🌐 Web (Linux, dans le conteneur)

```bash
bun run build:web
```

Résultat: `dist/public/`

### 📱 Android (Linux, dans le conteneur)

```bash
# Première fois seulement
bun run tauri:android:init

# Build APK
bun run tauri:android:build
```

Résultat: `app/src-tauri/gen/android/app/build/outputs/apk/`

### 🍎 macOS/iOS (❌ PAS possible sur Linux)

Le build macOS/iOS **nécessite obligatoirement** :
- Un Mac (physique ou VM macOS)
- Xcode installé
- Tauri CLI

**Sur un Mac:**
```bash
# Desktop macOS
bun run tauri:desktop:build

# iOS
bun run tauri:ios:build
```

## 🔍 Vérification

### Tester le build web

```bash
cd blinko-offline
bun run dev
# Ouvrir http://<IP_CONTENEUR>:1111
```

### Tester l'APK Android

```bash
# Trouver l'APK
find app/src-tauri/gen/android -name "*.apk"

# Copier hors du conteneur
pct pull 200 /root/blinko-offline/app/src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk ./blinko.apk

# Installer sur téléphone via adb
adb install blinko.apk
```

## ⚠️ Notes Importantes

1. **macOS/iOS Build**: Impossible sur Linux/Proxmox. Nécessite un Mac.
2. **Sécurité**: Changez les mots de passe par défaut
3. **Firewall**: Ouvrez les ports nécessaires (1111 pour dev)
4. **PostgreSQL**: Installez-le dans le même conteneur ou un conteneur séparé

## 🔧 Troubleshooting

### Android SDK non trouvé

```bash
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

### Permissions Tauri

```bash
# Activer nesting dans le conteneur
pct set 200 -features nesting=1,keyctl=1
pct reboot 200
```

### Build web échoue

```bash
# Vérifier Node version (doit être 20+)
node --version

# Vérifier Bun
bun --version

# Nettoyer et réinstaller
rm -rf node_modules
bun install
```

## 📊 Ressources Conteneur Recommandées

- **Dev**: 2GB RAM, 2 cores
- **Build**: 4GB RAM, 4 cores
- **Production**: 4-8GB RAM, 4-8 cores
- **Disk**: 20GB minimum (plus si beaucoup de données)

---

**Besoin d'aide?** Consultez la doc Tauri: https://tauri.app/
