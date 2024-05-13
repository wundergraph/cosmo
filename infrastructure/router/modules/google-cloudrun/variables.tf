variable "cpu" {
  description = "The CPU units for the Cosmo Router."
  type        = number
  default     = 1.0
}

variable "region" {
  description = "The Region we want the cosmo router to run on    "
  type = string
}

variable "memory" {
  description = "The memory reseved for the Cosmo Router."
  type        = string
  default     = "512Mi"
}

variable "port" {
  description = "The port the Cosmo Router will listen on."
  type        = number
  default     = 3002
}

variable "name" {
  default = "cosmo-router"
  type    = string
}

variable "max_instance_count" {
  default = 2
  type    = number
}

variable "min_instance_count" {
  default = 1
  type    = number
}


variable "image" {
  description = "The image of the Cosmo Router."
  type        = string
  default     = "docker.io/kigsmtua/wundergraph:latest"
}

variable "config_file_path" {
  description = "The path to the Cosmo Router's configuration file."
  type        = string
}


variable "enable_public_acess" {
  description = "Whether the API is publicly accessible or not"
  type =  bool
  default = true
}

variable "secret_name" {
  description = "The secret name to access the GRAPHQL_API_TOKEN"
  type = string
}

variable "project" {
  description = "Project id of the google cloud project you want to setup this for"
  type = string
}
