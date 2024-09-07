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
  service_url = var.service_url
  namespace   = var.namespace
}

