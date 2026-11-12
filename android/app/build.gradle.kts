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
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "G1_URL", "\"$g1Url\"")
    }
    // Same key on every build, so a new APK installs over the old one.
    // Set GitHub secrets G1_KEYSTORE_B64 (base64 .jks) and G1_KEYSTORE_PASS; without them the debug key is used.
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
