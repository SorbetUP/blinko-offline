#!/bin/bash
# Script de déploiement Blinko sur Proxmox LXC
# À exécuter directement sur le serveur Proxmox

set -e

echo "🚀 Déploiement Blinko sur Proxmox LXC"
echo "======================================"

# Configuration
CTID=200  # ID du conteneur (ajustez si nécessaire)
HOSTNAME="blinko-prod"
STORAGE="local-lvm"  # Ajustez selon votre storage
TEMPLATE="ubuntu-22.04-standard_22.04-1_amd64.tar.zst"  # Template Ubuntu 22.04
PASSWORD="${PASSWORD:-}"  # Mot de passe root du conteneur (à fournir)
DISK_SIZE="20"  # GB
RAM="4096"  # MB
CORES="4"

if [ -z "$PASSWORD" ]; then
    read -r -s -p "Mot de passe root du conteneur: " PASSWORD
    echo ""
fi

echo "📦 Création du conteneur LXC..."

# Vérifier si le conteneur existe déjà
if pct status $CTID &>/dev/null; then
    echo "⚠️  Conteneur $CTID existe déjà. Suppression..."
    pct stop $CTID || true
    pct destroy $CTID
fi

# Créer le conteneur
pct create $CTID $STORAGE:vztmpl/$TEMPLATE \
    --hostname $HOSTNAME \
    --password $PASSWORD \
    --storage $STORAGE \
    --rootfs $STORAGE:$DISK_SIZE \
    --memory $RAM \
    --cores $CORES \
    --net0 name=eth0,bridge=vmbr0,ip=dhcp \
    --features nesting=1,keyctl=1 \
    --unprivileged 1 \
    --onboot 1

echo "✅ Conteneur créé avec ID: $CTID"

# Démarrer le conteneur
echo "🔄 Démarrage du conteneur..."
pct start $CTID
sleep 5

# Attendre que le réseau soit prêt
echo "⏳ Attente du réseau..."
for i in {1..30}; do
    if pct exec $CTID -- ping -c 1 8.8.8.8 &>/dev/null; then
        echo "✅ Réseau prêt"
        break
    fi
    sleep 2
done

# Installation des dépendances dans le conteneur
echo "📥 Installation des dépendances..."

pct exec $CTID -- bash -c "
set -e

# Update system
apt-get update
apt-get upgrade -y

# Install Node.js 20 (required by Blinko)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Bun
curl -fsSL https://bun.sh/install | bash
export PATH=\"\$HOME/.bun/bin:\$PATH\"
echo 'export PATH=\"\$HOME/.bun/bin:\$PATH\"' >> ~/.bashrc

# Install build dependencies
apt-get install -y \
    git \
    curl \
    wget \
    build-essential \
    pkg-config \
    libssl-dev \
    postgresql-client

# Install Android SDK for Android builds
apt-get install -y \
    openjdk-17-jdk \
    gradle \
    unzip

# Install Android SDK
mkdir -p /opt/android-sdk
cd /opt/android-sdk
wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip
unzip commandlinetools-linux-9477386_latest.zip
mkdir -p cmdline-tools/latest
mv cmdline-tools/* cmdline-tools/latest/ 2>/dev/null || true

# Set environment variables
echo 'export ANDROID_HOME=/opt/android-sdk' >> ~/.bashrc
echo 'export PATH=\$PATH:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools' >> ~/.bashrc
export ANDROID_HOME=/opt/android-sdk
export PATH=\$PATH:\$ANDROID_HOME/cmdline-tools/latest/bin

# Accept licenses
yes | sdkmanager --licenses || true
sdkmanager 'platform-tools' 'platforms;android-33' 'build-tools;33.0.0'

echo '✅ Dépendances installées'
"

# Récupérer l'IP du conteneur
CT_IP=$(pct exec $CTID -- hostname -I | awk '{print $1}')

echo ""
echo "✅ Conteneur créé avec succès!"
echo "======================================"
echo "ID: $CTID"
echo "Hostname: $HOSTNAME"
echo "IP: $CT_IP"
echo ""
echo "📋 Prochaines étapes:"
echo "1. Connectez-vous au conteneur: pct enter $CTID"
echo "2. Clonez le projet Blinko"
echo "3. Lancez: bun install && bun run build:web"
echo "4. Pour Android: bun run tauri:android:build"
echo ""
echo "⚠️  Note: Le build macOS/iOS nécessite un Mac avec Xcode"
