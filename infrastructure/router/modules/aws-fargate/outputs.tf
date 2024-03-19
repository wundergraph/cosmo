output "cosmo_router_url" {
  value = var.enable_tls ? "https://${var.subdomain}.${var.hosted_zone_name}" : "http://${aws_alb.cosmo_router.dns_name}"
}