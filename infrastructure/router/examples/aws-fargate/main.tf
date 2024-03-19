module "cosmo" {
  source = "../../modules/aws-fargate"

  name             = "cosmo-router"
  config_file_path = "${path.module}/config.yaml"

  enable_tls = true

  subdomain = "cosmo-router"
  hosted_zone_name = "example.com"

  secret_arn = var.secret_arn
}
