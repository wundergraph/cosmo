terraform {
  required_providers {
    cosmo = {
      source = "terraform.local/wundergraph/cosmo"
      version = "0.0.1"
    }
  }
}

resource "cosmo_subgraph" "test" {
  base_subgraph_name = "terraform-federated-graph-demo"
  name      = "subgraph-1"
  namespace = "test-namespace"
  routing_url = "http://example.com/routing"
}