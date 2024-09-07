terraform {
  required_providers {
    cosmo = {
      source  = "terraform.local/wundergraph/cosmo"
      version = "0.0.1"
    }
  }
}

resource "cosmo_subgraph" "test" {
  base_subgraph_name = var.base_subgraph_name
  name               = var.name
  namespace          = var.namespace
  routing_url        = var.routing_url
}