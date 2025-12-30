#!/bin/bash
# 🚀 Build Android AUTOMATIQUE - VERSION CORRIGÉE
# Utilise SSHPASS en variable d'environnement

set -e

# Configuration
export SSHPASS="${SSHPASS:-}"
PROXMOX_IP="192.168.0.235"
PROXMOX_USER="root"
CTID=200

echo "🚀 BUILD ANDROID AUTOMATIQUE - Blinko"
echo "====================================="
echo ""

if [ -z "$SSHPASS" ]; then
    read -r -s -p "Mot de passe Proxmox (SSHPASS): " SSHPASS
    echo ""
    export SSHPASS
fi

# Vérifier sshpass
if ! command -v sshpass &> /dev/null; then
    echo "❌ sshpass n'est pas installé"
    exit 1
fi

SSH_OPTS="-o StrictHostKeyChecking=no"

# =====================================
# ÉTAPE 1: Copier les fichiers
# =====================================
echo "📤 ÉTAPE 1/5: Copie des fichiers vers Proxmox..."

if [ ! -f "blinko.tar.gz" ]; then
    echo "❌ blinko.tar.gz introuvable!"
    exit 1
fi

sshpass -e scp $SSH_OPTS blinko.tar.gz $PROXMOX_USER@$PROXMOX_IP:/root/
sshpass -e scp $SSH_OPTS deploy/ONE_COMMAND_ANDROID.sh $PROXMOX_USER@$PROXMOX_IP:/root/
echo "✅ Fichiers copiés ($(du -h blinko.tar.gz | cut -f1))"

# =====================================
# ÉTAPE 2: Rendre script exécutable
# =====================================
echo ""
echo "🔧 ÉTAPE 2/5: Configuration..."

sshpass -e ssh $SSH_OPTS $PROXMOX_USER@$PROXMOX_IP "chmod +x /root/ONE_COMMAND_ANDROID.sh"
echo "✅ Script configuré"

# =====================================
# ÉTAPE 3: Lancer le build
# =====================================
echo ""
echo "🔨 ÉTAPE 3/5: Lancement du build Android..."
echo "  (Durée estimée: 20-30 minutes)"
echo "  Vous pouvez surveiller la progression dans un autre terminal:"
echo "  ssh root@$PROXMOX_IP 'tail -f /tmp/android-build.log'"
echo ""

sshpass -e ssh $SSH_OPTS $PROXMOX_USER@$PROXMOX_IP \
    "yes | /root/ONE_COMMAND_ANDROID.sh 2>&1 | tee /tmp/android-build.log" &

BUILD_PID=$!

# Attendre avec indicateur de progression
echo -n "  Build en cours"
for i in {1..60}; do
    if ! kill -0 $BUILD_PID 2>/dev/null; then
        echo ""
        break
    fi
    echo -n "."
    sleep 30
done

wait $BUILD_PID || {
    echo ""
    echo "⚠️  Le build semble avoir échoué"
    echo "Vérifiez les logs:"
    echo "  ssh root@$PROXMOX_IP 'cat /tmp/android-build.log'"
    exit 1
}

echo ""
echo "✅ Build terminé"

# =====================================
# ÉTAPE 4: Vérifier APK
# =====================================
echo ""
echo "🔍 ÉTAPE 4/5: Vérification de l'APK..."

APK_CHECK=$(sshpass -e ssh $SSH_OPTS $PROXMOX_USER@$PROXMOX_IP \
    "[ -f /root/blinko-android.apk ] && ls -lh /root/blinko-android.apk || echo 'NOT_FOUND'")

if [[ "$APK_CHECK" == *"NOT_FOUND"* ]]; then
    echo "❌ APK non trouvé!"
    echo ""
    echo "Debug avec:"
    echo "  ssh root@$PROXMOX_IP"
    echo "  pct enter $CTID"
    echo "  find /root -name '*.apk'"
    exit 1
fi

echo "$APK_CHECK"
echo "✅ APK trouvé"

# =====================================
# ÉTAPE 5: Récupérer l'APK
# =====================================
echo ""
echo "📥 ÉTAPE 5/5: Téléchargement de l'APK..."

sshpass -e scp $SSH_OPTS $PROXMOX_USER@$PROXMOX_IP:/root/blinko-android.apk ~/Desktop/blinko-android.apk

echo ""
echo "════════════════════════════════════════"
echo "✅ BUILD ANDROID RÉUSSI!"
echo "════════════════════════════════════════"
echo ""
echo "📱 APK disponible: ~/Desktop/blinko-android.apk"
echo ""
echo "📲 Installation:"
echo "  Option 1 - Via ADB:"
echo "    adb install ~/Desktop/blinko-android.apk"
echo ""
echo "  Option 2 - Manuelle:"
echo "    Copier l'APK sur le téléphone et installer"
echo ""
echo "📊 Conteneur LXC:"
CT_IP=$(sshpass -e ssh $SSH_OPTS $PROXMOX_USER@$PROXMOX_IP "pct exec $CTID -- hostname -I | awk '{print \$1}'")
echo "   ID: $CTID"
echo "   IP: $CT_IP"
echo "   Password: (défini lors de la création)"
echo ""
echo "🔍 Accès au conteneur:"
echo "   ssh root@$PROXMOX_IP"
echo "   pct enter $CTID"
echo ""
echo "⚠️  CHANGEZ le mot de passe Proxmox après!"
echo ""
