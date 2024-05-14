terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source = "hashicorp/google"
      version = ">= 5.20"
    }
    google-beta = {
      source = "hashicorp/google-beta"
      version = ">= 5.20"
    }
  }
}
