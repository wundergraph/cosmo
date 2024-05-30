resource "google_secret_manager_secret" "cosmo-configuration" {
  secret_id = "cosmo-configs-yaml"
  project = var.project
  labels = {
    label = "cosmo-configs-yaml"
  }

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "cosmo-configuration" {
  secret = google_secret_manager_secret.cosmo-configuration.id
  secret_data = file(var.config_file_path)
}

resource "google_cloud_run_v2_service" "cosmo" {
  name     = var.name
  location = var.region
  project = var.project
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    volumes {
      name = "cosmo-config"
      secret {
        secret = google_secret_manager_secret.cosmo-configuration.secret_id
        items {
          version = "latest"
          path = "cosmo-configs-yaml"
        }
      }
    }

    scaling {
      max_instance_count = var.max_instance_count
      min_instance_count = var.min_instance_count
    }
    service_account = google_service_account.cosmo-sa.account_id
    containers {
      image = var.image

      volume_mounts {
        name = "cosmo-config"
        mount_path = "/etc/cosmo/config"
      }

      ports {
        container_port = var.port
      }
      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 1
        period_seconds        = 3
        failure_threshold     = 1
        tcp_socket {
          port = var.port
        }
      }
      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }
      env {
        name  = "CONFIG_PATH"
        value = "etc/cosmo/config/cosmo-configs-yaml"
      }
      env {
        name = "GRAPH_API_TOKEN"
        value_source {
          secret_key_ref {
            secret = var.secret_name
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
      google_project_iam_custom_role.cosmo_role,
      google_project_iam_member.comso-secret-manager-permissions,
      google_project_iam_member.cosmo-service-account-permissions
  ]
}

data "google_iam_policy" "noauth" {
  binding {
    role = "roles/run.invoker"
    members = [
      "allUsers",
    ]
  }
}

resource "google_cloud_run_service_iam_policy" "noauth" {
  count = var.enable_public_acess ? 1 : 0
  location    = google_cloud_run_v2_service.cosmo.location
  project     = google_cloud_run_v2_service.cosmo.project
  service     = google_cloud_run_v2_service.cosmo.name
  policy_data = data.google_iam_policy.noauth.policy_data
}
