# 📱 Guide Build Android - Blinko

## 🚀 Option Rapide (Script Automatisé)

### Sur Proxmox

```bash
# 1. Copier le projet sur Proxmox
cd /Users/sorbet/Desktop/Dev/blinko-offline
tar czf blinko.tar.gz .
scp blinko.tar.gz root@192.168.0.235:/root/

# 2. Sur Proxmox, créer et configurer le conteneur
ssh root@192.168.0.235

# Créer conteneur Ubuntu
pct create 200 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
    --hostname blinko-android \
    --password <mot-de-passe> \
    --storage local-lvm \
    --rootfs local-lvm:30 \
    --memory 6144 \
    --cores 4 \
    --net0 name=eth0,bridge=vmbr0,ip=dhcp \
    --features nesting=1,keyctl=1 \
    --unprivileged 1

pct start 200
sleep 10

# Entrer dans le conteneur
pct enter 200
```

### Dans le conteneur

```bash
# Installation environnement Android
apt-get update && apt-get upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Bun
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc

# Build tools
apt-get install -y git curl wget build-essential pkg-config libssl-dev unzip

# Java 17 (requis pour Android)
apt-get install -y openjdk-17-jdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
echo 'export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64' >> ~/.bashrc

# Android SDK
mkdir -p /opt/android-sdk/cmdline-tools
cd /opt/android-sdk/cmdline-tools
wget -q https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip
unzip -q commandlinetools-linux-9477386_latest.zip
mkdir -p latest
mv cmdline-tools/* latest/ 2>/dev/null || true
rmdir cmdline-tools 2>/dev/null || true

# Variables d'environnement
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/33.0.0
echo 'export ANDROID_HOME=/opt/android-sdk' >> ~/.bashrc
echo 'export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/33.0.0' >> ~/.bashrc

# Installer Android SDK components
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager \
    "platform-tools" \
    "platforms;android-33" \
    "build-tools;33.0.0" \
    "ndk;25.1.8937393"

# Extraire le projet
cd /root
tar xzf /root/blinko.tar.gz -C /root/blinko-offline

# Build Android
cd /root/blinko-offline
chmod +x deploy/android-build.sh
./deploy/android-build.sh
```

## 📋 Vérifications Prérequis

```bash
# Vérifier Java
java -version
# Devrait afficher: openjdk version "17.x.x"

# Vérifier Android SDK
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --list | grep "build-tools;33"
# Devrait afficher: build-tools;33.0.0

# Vérifier Bun
bun --version

# Vérifier Node
node --version
# Devrait être 20.x
```

## 🔧 Build Manuel

Si le script automatique ne fonctionne pas :

```bash
cd /root/blinko-offline

# 1. Installer dépendances
bun install

# 2. Générer Prisma
bun run prisma:generate

# 3. Initialiser Tauri Android (première fois)
cd app
bunx tauri android init
# Répondre aux questions:
#   App name: Blinko
#   Package ID: com.blinko.app (ou votre choix)
#   Target SDK: 33

# 4. Build APK
bunx tauri android build --apk

# Alternative: Build AAB (pour Play Store)
bunx tauri android build --aab
```

## 📦 Récupérer l'APK

### Depuis le conteneur

```bash
# Trouver l'APK
find /root/blinko-offline/app/src-tauri/gen/android -name "*.apk"

# Copier vers /root pour extraction facile
cp /root/blinko-offline/app/src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk /root/blinko.apk
```

### Depuis Proxmox (host)

```bash
# Extraire du conteneur vers Proxmox
pct pull 200 /root/blinko.apk /root/blinko.apk

# Copier vers votre Mac
scp root@192.168.0.235:/root/blinko.apk ~/Desktop/
```

### Installer sur téléphone

```bash
# Via ADB (Android Debug Bridge)
adb install ~/Desktop/blinko.apk

# Ou copier l'APK sur le téléphone et installer manuellement
```

## 🐛 Troubleshooting

### Erreur: "Android SDK not found"

```bash
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

### Erreur: "JAVA_HOME not set"

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
```

### Erreur: "Gradle build failed"

```bash
# Nettoyer cache Gradle
rm -rf ~/.gradle
cd app/src-tauri/gen/android
./gradlew clean
./gradlew assembleRelease
```

### Erreur: "No space left on device"

```bash
# Sur Proxmox, augmenter taille disque
pct resize 200 rootfs +10G
```

### Build très lent

```bash
# Augmenter RAM/CPU du conteneur
pct set 200 -memory 8192 -cores 6
pct reboot 200
```

## ⚙️ Configuration Build

### Changer version de l'app

Éditer `app/src-tauri/tauri.conf.json` :

```json
{
  "package": {
    "version": "1.0.0"
  }
}
```

### Signature de l'APK (pour release)

```bash
# Générer keystore
keytool -genkey -v \
    -keystore ~/blinko-release.keystore \
    -alias blinko \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000

# Configurer dans build.gradle
# app/src-tauri/gen/android/app/build.gradle
```

## 📊 Tailles Estimées

- **APK Debug**: ~50-80 MB
- **APK Release (optimisé)**: ~30-50 MB
- **AAB (Play Store)**: ~25-40 MB

## 🎯 Commandes Utiles

```bash
# Logs build en temps réel
bunx tauri android build --apk --verbose

# Build en mode debug (plus rapide)
bunx tauri android build --apk --debug

# Lister devices connectés
adb devices

# Installer et lancer directement
bunx tauri android dev
```

## ✅ Checklist Finale

- [ ] Java 17 installé
- [ ] Android SDK installé avec build-tools 33.0.0
- [ ] ANDROID_HOME et JAVA_HOME configurés
- [ ] Bun installé
- [ ] Node.js 20 installé
- [ ] Projet Blinko extrait
- [ ] Dépendances installées (`bun install`)
- [ ] Prisma généré
- [ ] Tauri Android initialisé
- [ ] Build réussi
- [ ] APK récupéré

---

**Temps estimé total**: 30-60 minutes (selon vitesse réseau et CPU)
