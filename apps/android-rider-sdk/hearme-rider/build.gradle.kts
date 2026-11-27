plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.hearme.rider"
    compileSdk = 34
    defaultConfig { minSdk = 26 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    // unit tests read the shared vectors from the repo root (protocol/test_vectors.json)
    testOptions { unitTests.all { it.systemProperty("hearme.repo", rootProject.projectDir.parentFile.parentFile.absolutePath) } }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.google.code.gson:gson:2.11.0")
}
