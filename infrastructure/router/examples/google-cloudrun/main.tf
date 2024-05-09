module "cosmo" {
  source           = "../../modules/google-cloudrun"
  name             = "cosmo-on-cloudrun"
  config_file_path = "${path.module}/config.yaml"
  region           = "europe-west1"
  secret_name      = "subaruboys"
  project          = var.google-cloud-project
}