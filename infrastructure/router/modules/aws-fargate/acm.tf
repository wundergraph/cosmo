resource "aws_acm_certificate" "cosmo_router" {
  count = var.enable_tls ? 1 : 0

  domain_name               = "${var.subdomain}.${var.hosted_zone_name}"
  validation_method         = "DNS"
  subject_alternative_names = []

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cosmo_router_dns" {
  count = var.enable_tls ? 1 : 0

  allow_overwrite = true
  name            = tolist(aws_acm_certificate.cosmo_router[0].domain_validation_options)[0].resource_record_name
  records         = [tolist(aws_acm_certificate.cosmo_router[0].domain_validation_options)[0].resource_record_value]
  type            = tolist(aws_acm_certificate.cosmo_router[0].domain_validation_options)[0].resource_record_type
  zone_id         = data.aws_route53_zone.zone[0].zone_id
  ttl             = 60
}

resource "aws_acm_certificate_validation" "validation" {
  count = var.enable_tls ? 1 : 0

  certificate_arn         = aws_acm_certificate.cosmo_router[0].arn
  validation_record_fqdns = [aws_route53_record.cosmo_router_dns[0].fqdn]
}
