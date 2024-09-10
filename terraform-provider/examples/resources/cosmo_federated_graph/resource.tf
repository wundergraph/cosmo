terraform {
  required_providers {
    cosmo = {
      source  = "terraform.local/wundergraph/cosmo"
      version = "0.0.1"
    }
  }
}

resource "cosmo_federated_graph" "test" {
  name        = var.name
  routing_url = var.routing_url
  namespace   = var.namespace
}


