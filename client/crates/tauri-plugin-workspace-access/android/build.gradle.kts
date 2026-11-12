import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "dev.situate.access"
    val testSourceSet: com.android.build.api.dsl.AndroidSourceSet = sourceSets.getByName("androidTest")
    testSourceSet.assets.srcDir("../../../contracts")
    compileSdk = 37
    ndkVersion = "28.2.13676358"
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            buildStagingDirectory = file(".gradle/cxx")
            version = "3.22.1"
        }
    }
    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
        testInstrumentationRunnerArguments["class"] = "dev.situate.access.WorkspaceAccessTest"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}
kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_1_8 } }
dependencies {
    implementation(project(":tauri-android"))
    compileOnly("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    androidTestImplementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
    for (library in listOf("android.test.runner", "android.test.base", "android.test.mock")) {
        androidTestCompileOnly(
            files(
                providers.provider {
                    android.bootClasspath
                        .first()
                        .parentFile
                        .resolve("optional/$library.jar")
                },
            ),
        )
    }
}
