variable "stage" {
  type        = string
  default     = "dev"
  description = "The stage of the federated graph"
}

variable "namespace" {
  type        = string
  description = "The name of the namespace to be used for the federated graph"
}

variable "create_namespace" {
  type        = bool
  description = "Either bring your own namespace or have this module create it"
}

variable "federated_graph" {
  type = object({
    name        = string
    routing_url = string
  })
  description = "The parameters of the federated graph"
}

variable "subgraphs" {
  type = map(object({
    name        = string
    routing_url = string
  }))
  description = "The subgraphs to be added to the federated graph"
}

variable "attach_subgraphs" {
  type        = bool
  description = "Whether to attach subgraphs to an existing federated graph"
}
