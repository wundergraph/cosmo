resource "aws_cloudwatch_log_group" "cosmo_router" {
  name              = "/ecs/${var.name}"
  retention_in_days = 90
}