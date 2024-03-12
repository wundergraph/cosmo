data "aws_region" "current" {}

data "aws_route53_zone" "zone" {
  count = var.enable_tls ? 1 : 0

  name         = var.hosted_zone_name
  private_zone = false
}

variable "name" {
  default = "cosmo-router"
}

variable "release" {
  description = "The version of the Cosmo Router."
}

variable "config_file_path" {
  description = "The path to the Cosmo Router's configuration file."
  type        = string
}

variable "enable_tls" {
  type    = bool
  default = false
}

variable "subdomain" {
  description = "The subdomain for the Cosmo Router (only required when TLS should be enabled)."
  type        = string
  default     = ""
}

variable "hosted_zone_name" {
  description = "The Route53 hosted zone name. This is required if you want to enable TLS for your Cosmo Router."
  type        = string
  nullable    = true
  default     = ""
}

variable "min_instances" {
  type    = number
  default = 3
}

variable "cpu" {
  description = "The CPU units for the Cosmo Router. 1024 CPU units = 1 vCPU."
  type        = number
  default     = 256
}

variable "memory" {
  description = "The memory for the Cosmo Router."
  type        = number
  default     = 512
}

variable "port" {
  description = "The port the Cosmo Router will listen on."
  type        = number
  default     = 3002
}

variable "secret_arn" {
  description = "The ARN of the secret where the GRAPH_API_TOKEN is stored."
  type        = string
  sensitive   = true
}
