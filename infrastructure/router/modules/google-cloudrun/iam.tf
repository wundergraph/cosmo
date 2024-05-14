resource "google_project_iam_custom_role" "cosmo_role" {
  role_id     = "cloud_run_access_permissions"
  title       = "Custom role for cosmo"
  description = "Allows for cosmo to deploy and run cloudrun"
  project = var.project

  permissions = [
    "storage.objects.list",
    "storage.objects.get",
    "run.services.create",
    "run.services.delete",
    "run.services.get",
    "run.services.update",
    "run.services.list",
    "run.routes.create",
    "run.routes.delete",
    "run.routes.get",
    "run.routes.update",
    "run.routes.list",
    "run.locations.list",
  ]
}


resource "google_service_account" "cosmo-sa" {
  account_id   = "cloudrun-sa"
  display_name = "Custom service account for use by the cloudrun account"
  project = var.project

}

resource google_project_iam_member "comso-default-permissions" {
    role = google_project_iam_custom_role.cosmo_role.name
    project = var.project
    member = "serviceAccount:${google_service_account.cosmo-sa.email}"
}

resource google_project_iam_member "comso-secret-manager-permissions" {
    role = "roles/secretmanager.secretAccessor"
    project = var.project
    member = "serviceAccount:${google_service_account.cosmo-sa.email}"
}

resource google_project_iam_member "cosmo-service-account-permissions" {
    role = "roles/iam.serviceAccountUser"
    project = var.project
    member = "serviceAccount:${google_service_account.cosmo-sa.email}"
}
