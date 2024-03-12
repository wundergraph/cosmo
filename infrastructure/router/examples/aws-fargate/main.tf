module "cosmo" {
  source = "../../modules/aws-fargate"

  name             = "cosmo-router"
  release          = "0.72.0"
  config_file_path = "${path.module}/config.yaml"

  enable_tls       = true
  subdomain        = "..."
  hosted_zone_name = "..."

  secret_arn = "..."
}
