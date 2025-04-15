plugins {
    kotlin("jvm") version "2.1.10"
    id("com.apollographql.apollo3") version "3.8.2"
}

group = "org.example"
version = "1.0-SNAPSHOT"

repositories {
    mavenCentral()
}


dependencies {
    testImplementation(kotlin("test"))
    implementation("com.apollographql.apollo3:apollo-runtime:3.8.2")
}

tasks.test {
    useJUnitPlatform()
}
kotlin {
    jvmToolchain(23)
}

apollo {
    service("service") {
        packageName.set("org.example.graphql")
    }
}
