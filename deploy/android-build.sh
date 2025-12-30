#!/bin/bash
# Build Android APK - Script complet
# À exécuter dans le conteneur ou sur une machine Linux

set -e

echo "📱 Build Blinko pour Android"
echo "============================"

# Vérifier les prérequis
command -v bun >/dev/null 2>&1 || { echo "❌ Bun non installé"; exit 1; }
command -v java >/dev/null 2>&1 || { echo "❌ Java non installé"; exit 1; }

# Variables d'environnement Android
export ANDROID_HOME=${ANDROID_HOME:-/opt/android-sdk}
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/33.0.0

echo "🔍 Vérification environnement..."
echo "  ANDROID_HOME: $ANDROID_HOME"
echo "  Java: $(java -version 2>&1 | head -1)"
echo "  Bun: $(bun --version)"

# Installer les dépendances
if [ ! -d "node_modules" ]; then
    echo "📦 Installation dépendances..."
    bun install
fi

# Générer Prisma
echo "🔧 Génération Prisma..."
bun run prisma:generate

# Initialiser Tauri Android (si première fois)
if [ ! -d "app/src-tauri/gen/android" ]; then
    echo "🚀 Initialisation Tauri Android..."
    cd app
    bunx tauri android init
    cd ..
fi

# Build Android APK
echo "📱 Build APK Android..."
cd app
bunx tauri android build --apk

# Trouver l'APK
echo ""
echo "✅ Build terminé!"
echo ""
APK_PATH=$(find src-tauri/gen/android -name "*.apk" -type f | head -1)

if [ -n "$APK_PATH" ]; then
    APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
    echo "📦 APK généré:"
    echo "   Chemin: $APK_PATH"
    echo "   Taille: $APK_SIZE"
    echo ""
    echo "📥 Pour installer sur téléphone:"
    echo "   adb install \"$APK_PATH\""
    echo ""
    echo "📤 Pour copier hors du conteneur (depuis Proxmox):"
    echo "   pct pull <CTID> \"/root/blinko-offline/$APK_PATH\" ./blinko.apk"
else
    echo "❌ APK non trouvé"
    exit 1
fi
