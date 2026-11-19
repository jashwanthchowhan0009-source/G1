plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The G1 screen and brain are the web app; this shell gives it the phone's powers.
// Build against another server with:  gradle assembleDebug -Pg1Url=https://your-g1.example
val g1Url = (project.findProperty("g1Url") as String?) ?: "https://g-one-two.vercel.app"

android {
    namespace = "com.sherrbyte.g1"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.sherrbyte.g1"
        minSdk = 26
        targetSdk = 34
        // Every GitHub build is newer than the last, so the app can update itself (see Updater.kt)
        val run = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull()
        versionCode = if (run != null) run + 100 else 4
        versionName = if (run != null) "0.3.$run" else "0.3.0-dev"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") } // phones only: keeps the APK small
        buildConfigField("String", "G1_URL", "\"$g1Url\"")
    }
    // Same key on every build, so a new APK installs over the old one.
    // Set the GitHub secret G1_KEYSTORE_PASS (12+ characters): the build makes a key once and keeps it encrypted.
    // Without it the debug key is used and every build needs an uninstall.
    val ks = System.getenv("G1_KEYSTORE_FILE")
    if (!ks.isNullOrBlank()) {
        signingConfigs.create("g1") {
            storeFile = file(ks)
            storePassword = System.getenv("G1_KEYSTORE_PASS")
            keyAlias = "g1"
            keyPassword = System.getenv("G1_KEYSTORE_PASS")
        }
        buildTypes.getByName("debug").signingConfig = signingConfigs.getByName("g1")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // Offline "Hey G1" listener; the speech model is added to assets by the build (see .github/workflows/android.yml)
    implementation("com.alphacephei:vosk-android:0.3.47@aar")
    implementation("net.java.dev.jna:jna:5.13.0@aar")
}
