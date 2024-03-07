variable "name" {
  default = "cosmo-router"
}

variable "release" {
  description = "The version of the Cosmo Router."
}

variable "cluster" {
  description = "The name of the ECS cluster you want to deploy the Cosmo Router to."
  type = string
}

variable "subnets" {
  description = "The subnets you want to deploy the Cosmo Router (Fargate instances) to."
  type = list(string)
}

variable "cpu" {
  description = "The CPU units for the Cosmo Router. 1024 CPU units = 1 vCPU."
  type = number
  default = 256
}

variable "memory" {
  description = "The memory for the Cosmo Router."
  type = number
  default = 512
}

variable "port" {
  description = "The port the Cosmo Router will listen on."
  type = number
  default = 3002
}

variable "secret_arn" {
  description = "The ARN of the secret where the GRAPH_API_TOKEN is stored."
  type = string
}
