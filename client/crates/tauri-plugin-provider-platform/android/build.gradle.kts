import org.jetbrains.kotlin.gradle.dsl.JvmTarget
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "dev.situate.providers"
    compileSdk = 37
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}
kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_1_8 } }
val generateAuthResources by tasks.registering(Exec::class) {
    val script = project.file("../../../scripts/generate-mobile-permissions.mjs")
    inputs.file(script)
    inputs.files(
        project.file("../../../packages/localization/src/catalogs/en.native.json"),
        project.file("../../../packages/localization/src/catalogs/de.native.json"),
    )
    outputs.files("src/main/res/values/provider-auth.xml", "src/main/res/values-de/provider-auth.xml")
    commandLine("node", script.absolutePath, "--android")
}
tasks.named("preBuild") { dependsOn(generateAuthResources) }

dependencies {
    implementation(project(":tauri-android"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    testImplementation("junit:junit:4.13.2")
}
