# Replace with necessary variables
module "cosmo" {
  source           = "../../modules/google-cloudrun"
  name             = ""
  config_file_path = "${path.module}/config.yaml"
  region           = ""
  secret_name      = ""
  project          = var.google-cloud-project
}
