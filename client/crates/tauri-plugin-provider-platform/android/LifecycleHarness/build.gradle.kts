plugins {
    id("com.android.application") version "8.11.1"
    id("org.jetbrains.kotlin.android") version "2.2.20"
}
android {
    namespace = "dev.situate.providers"
    sourceSets.named("main") { res.srcDir("../src/main/res") }
    compileSdk = 37
    signingConfigs.named("debug") {
        storeFile = file(requireNotNull(System.getenv("SITUATE_TEST_KEYSTORE")))
    }
    defaultConfig {
        applicationId = "dev.situate.tests.providerplatform"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}
kotlin {
    compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8 }
    sourceSets.named("main") {
        kotlin.srcDir("../src/main/java")
        kotlin.exclude("**/ProviderPlatformPlugin.kt")
    }
}
