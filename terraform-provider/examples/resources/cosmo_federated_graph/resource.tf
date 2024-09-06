terraform {
  required_providers {
    cosmo = {
      source = "terraform.local/wundergraph/cosmo"
      version = "0.0.1"
    }
  }
}

resource "cosmo_federated_graph" "test" {
  name  = "terraform-federated-graph-demo"
  service_url = "http://localhost:3000"
}