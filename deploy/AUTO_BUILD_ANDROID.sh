#!/bin/bash
# 🚀 Build Android COMPLÈTEMENT AUTOMATIQUE avec sshpass
# Exécuter depuis votre Mac, tout se fait automatiquement!

set -e

# Configuration
PROXMOX_IP="192.168.0.235"
PROXMOX_USER="root"
PROXMOX_PASS="${PROXMOX_PASS:-}"
CTID=200

echo "🚀 BUILD ANDROID AUTOMATIQUE - Blinko"
echo "====================================="
echo ""
echo "⚠️  IMPORTANT: Changez le mot de passe Proxmox après!"
echo ""

if [ -z "$PROXMOX_PASS" ]; then
    read -r -s -p "Mot de passe Proxmox: " PROXMOX_PASS
    echo ""
fi

# Vérifier sshpass
if ! command -v sshpass &> /dev/null; then
    echo "❌ sshpass n'est pas installé"
    echo ""
    echo "Installation:"
    echo "  brew install sshpass"
    exit 1
fi

SSH="sshpass -p \"$PROXMOX_PASS\" ssh -o StrictHostKeyChecking=no $PROXMOX_USER@$PROXMOX_IP"
SCP="sshpass -p \"$PROXMOX_PASS\" scp -o StrictHostKeyChecking=no"

# =====================================
# ÉTAPE 1: Copier les fichiers
# =====================================
echo "📤 ÉTAPE 1/5: Copie des fichiers vers Proxmox..."

if [ ! -f "blinko.tar.gz" ]; then
    echo "❌ blinko.tar.gz introuvable!"
    echo "Créez-le d'abord: tar czf blinko.tar.gz --exclude='node_modules' --exclude='.git' ."
    exit 1
fi

$SCP blinko.tar.gz $PROXMOX_USER@$PROXMOX_IP:/root/
$SCP deploy/ONE_COMMAND_ANDROID.sh $PROXMOX_USER@$PROXMOX_IP:/root/
echo "✅ Fichiers copiés"

# =====================================
# ÉTAPE 2: Rendre script exécutable
# =====================================
echo ""
echo "🔧 ÉTAPE 2/5: Configuration du script..."

$SSH "chmod +x /root/ONE_COMMAND_ANDROID.sh"
echo "✅ Script configuré"

# =====================================
# ÉTAPE 3: Lancer le build
# =====================================
echo ""
echo "🔨 ÉTAPE 3/5: Lancement du build Android..."
echo "  (Cela peut prendre 20-30 minutes...)"
echo ""

$SSH "yes | /root/ONE_COMMAND_ANDROID.sh" || {
    echo ""
    echo "⚠️  Le script a peut-être échoué ou demandé confirmation"
    echo "Vérifiez les logs ci-dessus"
}

# =====================================
# ÉTAPE 4: Vérifier si APK existe
# =====================================
echo ""
echo "🔍 ÉTAPE 4/5: Vérification de l'APK..."

APK_EXISTS=$($SSH "[ -f /root/blinko-android.apk ] && echo 'yes' || echo 'no'")

if [ "$APK_EXISTS" = "yes" ]; then
    APK_SIZE=$($SSH "ls -lh /root/blinko-android.apk | awk '{print \$5}'")
    echo "✅ APK trouvé (taille: $APK_SIZE)"
else
    echo "❌ APK non trouvé!"
    echo ""
    echo "Debug: Connexion au conteneur"
    echo "  ssh root@$PROXMOX_IP"
    echo "  pct enter $CTID"
    echo "  cd /root/blinko/app"
    echo "  find . -name '*.apk'"
    exit 1
fi

# =====================================
# ÉTAPE 5: Récupérer l'APK
# =====================================
echo ""
echo "📥 ÉTAPE 5/5: Téléchargement de l'APK..."

$SCP $PROXMOX_USER@$PROXMOX_IP:/root/blinko-android.apk ~/Desktop/blinko-android.apk

echo ""
echo "════════════════════════════════════════"
echo "✅ BUILD ANDROID TERMINÉ AVEC SUCCÈS!"
echo "════════════════════════════════════════"
echo ""
echo "📱 APK disponible:"
echo "   ~/Desktop/blinko-android.apk"
echo ""
echo "🔌 Installation sur téléphone:"
echo ""
echo "  Méthode 1 - Via ADB:"
echo "    1. Activer 'Débogage USB' sur le téléphone"
echo "    2. Connecter via USB"
echo "    3. Exécuter: adb install ~/Desktop/blinko-android.apk"
echo ""
echo "  Méthode 2 - Manuelle:"
echo "    1. Copier APK sur le téléphone"
echo "    2. Ouvrir le fichier et installer"
echo ""
echo "📊 Informations conteneur:"
CT_IP=$($SSH "pct exec $CTID -- hostname -I | awk '{print \$1}'")
echo "   ID: $CTID"
echo "   IP: $CT_IP"
echo "   Accès: pct enter $CTID (depuis Proxmox)"
echo ""
echo "⚠️  N'OUBLIEZ PAS:"
echo "   - Changer le mot de passe Proxmox!"
echo "   - Le conteneur utilise le mot de passe défini lors de la création"
echo ""
