#!/bin/bash
# 🚀 ONE-COMMAND Android Build pour Blinko
# Copier ce fichier sur Proxmox et exécuter
# Usage: ./ONE_COMMAND_ANDROID.sh

set -e

CTID=200
PASSWORD="${PASSWORD:-}"
PROJECT_TAR="/root/blinko.tar.gz"

echo "🚀 ONE-COMMAND Android Build - Blinko"
echo "======================================"
echo ""
echo "Ce script va:"
echo "  1. Créer un conteneur LXC sur Proxmox"
echo "  2. Installer tout l'environnement Android"
echo "  3. Builder l'APK Android"
echo "  4. Extraire l'APK vers /root/"
echo ""
read -p "Continuer? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

if [ -z "$PASSWORD" ]; then
    read -r -s -p "Mot de passe root du conteneur: " PASSWORD
    echo ""
fi

# =====================================
# PARTIE 1: Créer conteneur
# =====================================
echo ""
echo "📦 ÉTAPE 1/4: Création du conteneur LXC..."

if pct status $CTID &>/dev/null; then
    echo "⚠️  Conteneur $CTID existe. Suppression..."
    pct stop $CTID || true
    sleep 2
    pct destroy $CTID
fi

pct create $CTID local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
    --hostname blinko-android \
    --password "$PASSWORD" \
    --storage local-lvm \
    --rootfs local-lvm:30 \
    --memory 6144 \
    --cores 4 \
    --net0 name=eth0,bridge=vmbr0,ip=dhcp \
    --features nesting=1,keyctl=1 \
    --unprivileged 1

pct start $CTID
echo "✅ Conteneur créé. Attente démarrage..."
sleep 15

# =====================================
# PARTIE 2: Installation environnement
# =====================================
echo ""
echo "📥 ÉTAPE 2/4: Installation environnement Android..."

pct exec $CTID -- bash -c '
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget git build-essential pkg-config libssl-dev unzip openjdk-17-jdk > /dev/null 2>&1
echo "  ✓ Paquets de base installés"

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
apt-get install -y -qq nodejs > /dev/null 2>&1
echo "  ✓ Node.js 20 installé"

# Bun
curl -fsSL https://bun.sh/install | bash > /dev/null 2>&1
export PATH="$HOME/.bun/bin:$PATH"
echo "export PATH=\"\$HOME/.bun/bin:\$PATH\"" >> ~/.bashrc
echo "  ✓ Bun installé"

# Rust (requis pour Tauri)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y > /dev/null 2>&1
export PATH="$HOME/.cargo/bin:$PATH"
echo "export PATH=\"\$HOME/.cargo/bin:\$PATH\"" >> ~/.bashrc
echo "  ✓ Rust installé"

# Java environment
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
echo "export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64" >> ~/.bashrc
echo "  ✓ Java 17 configuré"

# Android SDK
mkdir -p /opt/android-sdk/cmdline-tools
cd /opt/android-sdk/cmdline-tools
wget -q https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip
unzip -q commandlinetools-linux-9477386_latest.zip
mkdir -p latest
mv cmdline-tools/* latest/ 2>/dev/null || true
echo "  ✓ Android SDK téléchargé"

export ANDROID_HOME=/opt/android-sdk
export PATH=\$PATH:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/build-tools/33.0.0
echo "export ANDROID_HOME=/opt/android-sdk" >> ~/.bashrc
echo "export PATH=\$PATH:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/build-tools/33.0.0" >> ~/.bashrc

yes | \$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses > /dev/null 2>&1
\$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-33" "build-tools;33.0.0" "ndk;25.1.8937393" > /dev/null 2>&1
echo "  ✓ Android SDK components installés"

echo "✅ Environnement prêt!"
'

# =====================================
# PARTIE 3: Copier et extraire projet
# =====================================
echo ""
echo "📂 ÉTAPE 3/4: Copie du projet..."

if [ ! -f "$PROJECT_TAR" ]; then
    echo "❌ Erreur: $PROJECT_TAR n'existe pas!"
    echo ""
    echo "Créez d'abord l'archive:"
    echo "  cd /Users/sorbet/Desktop/Dev/blinko-offline"
    echo "  tar czf blinko.tar.gz ."
    echo "  scp blinko.tar.gz root@192.168.0.235:/root/"
    exit 1
fi

pct push $CTID "$PROJECT_TAR" /root/blinko.tar.gz
pct exec $CTID -- bash -c '
mkdir -p /root/blinko
cd /root/blinko
tar xzf /root/blinko.tar.gz
echo "✅ Projet extrait"
'

# =====================================
# PARTIE 4: Build Android
# =====================================
echo ""
echo "🔨 ÉTAPE 4/4: Build APK Android..."
echo "  (Cela peut prendre 10-20 minutes...)"
echo ""

pct exec $CTID -- bash -c '
export PATH="$HOME/.bun/bin:$PATH"
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/33.0.0

cd /root/blinko

echo "  📦 Installation dépendances..."
bun install > /dev/null 2>&1
echo "  ✓ Dépendances installées"

echo "  🔧 Génération Prisma..."
bun run prisma:generate > /dev/null 2>&1
echo "  ✓ Prisma généré"

echo "  🚀 Initialisation Tauri Android..."
cd app
echo -e "Blinko\ncom.blinko.app\n33\n" | bunx tauri android init > /dev/null 2>&1 || true
echo "  ✓ Tauri Android initialisé"

echo "  📱 Build APK (cela peut prendre du temps)..."
bunx tauri android build --apk 2>&1 | grep -E "BUILD|SUCCESSFUL|FAILED|Error" || true

# Trouver et copier APK
APK=$(find src-tauri/gen/android -name "*.apk" -type f | head -1)
if [ -n "$APK" ]; then
    cp "$APK" /root/blinko-android.apk
    echo ""
    echo "✅ APK généré avec succès!"
    ls -lh /root/blinko-android.apk
else
    echo "❌ APK non trouvé"
    exit 1
fi
'

# =====================================
# PARTIE 5: Extraire APK
# =====================================
echo ""
echo "📥 Extraction de l'APK..."

pct pull $CTID /root/blinko-android.apk /root/blinko-android.apk

CT_IP=$(pct exec $CTID -- hostname -I | awk '{print $1}')

echo ""
echo "════════════════════════════════════════"
echo "✅ BUILD ANDROID TERMINÉ!"
echo "════════════════════════════════════════"
echo ""
echo "📦 APK disponible:"
echo "   Sur Proxmox: /root/blinko-android.apk"
echo ""
echo "📱 Pour installer sur téléphone:"
echo "   1. Copier sur votre Mac:"
echo "      scp root@192.168.0.235:/root/blinko-android.apk ~/Desktop/"
echo ""
echo "   2. Installer via ADB:"
echo "      adb install ~/Desktop/blinko-android.apk"
echo ""
echo "   3. Ou copier sur téléphone et installer manuellement"
echo ""
echo "🖥️  Conteneur LXC:"
echo "   ID: $CTID"
echo "   IP: $CT_IP"
echo ""
echo "🔍 Pour entrer dans le conteneur:"
echo "   pct enter $CTID"
echo ""
