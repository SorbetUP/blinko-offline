#!/bin/bash
# Script à exécuter DANS le conteneur LXC
# Déploie et build Blinko

set -e

echo "🚀 Installation de Blinko dans le conteneur"
echo "==========================================="

# Configuration
PROJECT_DIR="/root/blinko-offline"
REPO_URL="https://github.com/blinkospace/blinko.git"  # Ajustez si vous avez un fork

# Créer répertoire de travail
mkdir -p /root
cd /root

# Cloner le projet (ou copier depuis l'hôte)
if [ ! -d "$PROJECT_DIR" ]; then
    echo "📥 Clonage du projet..."
    # Option 1: Clone depuis GitHub
    # git clone $REPO_URL blinko-offline

    # Option 2: Copier depuis l'hôte Proxmox
    echo "⚠️  Copiez manuellement le projet avec:"
    echo "    pct push <CTID> /path/to/blinko-offline /root/blinko-offline -r"
    exit 1
fi

cd "$PROJECT_DIR"

# Charger les variables d'environnement
export PATH="$HOME/.bun/bin:$PATH"
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# Installer les dépendances
echo "📦 Installation des dépendances..."
bun install

# Générer Prisma client
echo "🔧 Génération Prisma..."
bun run prisma:generate

# Build version web
echo "🌐 Build version web..."
bun run build:web

echo "✅ Build web terminé!"
echo ""
echo "📱 Pour builder Android:"
echo "   bun run tauri:android:init  (première fois seulement)"
echo "   bun run tauri:android:build"
echo ""
echo "🍎 Pour macOS/iOS:"
echo "   ⚠️  Nécessite un Mac avec Xcode"
echo "   Sur Mac: bun run tauri:desktop:build"
echo ""
echo "🚀 Pour lancer en dev:"
echo "   bun run dev"
