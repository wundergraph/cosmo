module "cosmo" {
  source = "../../modules/aws-fargate"

  name             = "cosmo-router"
  config_file_path = "${path.module}/config.yaml"

  enable_tls = true

  # Please adjust accordingly
  subdomain        = "router"
  hosted_zone_name = "your-domain.com"

  secret_arn = var.secret_arn
}
