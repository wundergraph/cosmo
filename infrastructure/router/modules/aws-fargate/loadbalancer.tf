resource "aws_alb" "cosmo_router" {
  name               = var.name
  load_balancer_type = "application"
  subnets = length(var.network_configuration_load_balancer_subnet_ids) > 0 ? var.network_configuration_load_balancer_subnet_ids : [
    aws_default_subnet.default_subnet_a[0].id,
    aws_default_subnet.default_subnet_b[0].id,
    aws_default_subnet.default_subnet_c[0].id,
  ]

  security_groups = [
    var.enable_tls ? aws_security_group.cosmo_router_load_balancer_https[0].id : aws_security_group.cosmo_router_load_balancer_http[0].id
  ]
}

# HTTPS Listener (when subdomain is set)
resource "aws_lb_listener" "listener_https" {
  count             = var.enable_tls ? 1 : 0
  load_balancer_arn = aws_alb.cosmo_router.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = aws_acm_certificate.cosmo_router[0].arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.cosmo_router.arn
  }

}

# HTTP Listener (when subdomain is not set)
resource "aws_lb_listener" "listener_http" {
  count = var.enable_tls ? 0 : 1

  load_balancer_arn = aws_alb.cosmo_router.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.cosmo_router.arn
  }
}

resource "aws_lb_target_group" "cosmo_router" {
  name        = var.name
  port        = var.port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.network_configuration_vpc_id != "" ? var.network_configuration_vpc_id : aws_default_vpc.default_vpc[0].id
}

resource "aws_security_group" "cosmo_router_load_balancer_https" {
  count = var.enable_tls ? 1 : 0

  vpc_id = var.network_configuration_vpc_id != "" ? var.network_configuration_vpc_id : aws_default_vpc.default_vpc[0].id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "cosmo_router_load_balancer_http" {
  count = var.enable_tls ? 0 : 1

  vpc_id = var.network_configuration_vpc_id != "" ? var.network_configuration_vpc_id : aws_default_vpc.default_vpc[0].id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_route53_record" "cosmo_router_alias_record" {
  count = var.enable_tls ? 1 : 0

  zone_id = data.aws_route53_zone.zone[0].zone_id
  name    = var.subdomain
  type    = "A"

  alias {
    name                   = aws_alb.cosmo_router.dns_name
    zone_id                = aws_alb.cosmo_router.zone_id
    evaluate_target_health = true
  }
}
