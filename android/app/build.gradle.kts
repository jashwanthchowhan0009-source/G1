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
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
