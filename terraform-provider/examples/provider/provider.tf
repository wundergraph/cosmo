terraform {
  required_providers {
    cosmo = {
      source = "terraform.local/wundergraph/cosmo"
      version = "0.0.1"
    }
  }
}

provider "cosmo" {
  cosmo_api_url = "cosmo_669b576aaadc10ee1ae81d9193425705"
  cosmo_api_key = "http://localhost:3001"
}

module "resource_cosmo_federated_graph" {
  source = "../resources/cosmo_federated_graph"
}

module "data_cosmo_federated_graph" {
  source = "../data-sources/cosmo_federated_graph"

  depends_on = [ module.resource_cosmo_federated_graph ]
}