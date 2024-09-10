module "resource_cosmo_namespace" {
  source = "../resources/cosmo_namespace"

  name = "terraform-namespace-demo"
}

module "resource_cosmo_federated_graph" {
  source = "../resources/cosmo_federated_graph"

  name        = "terraform-federated-graph-demo"
  service_url = "http://localhost:3000"
  namespace   = module.resource_cosmo_namespace.name
}

module "resource_cosmo_subgraph" {
  source = "../resources/cosmo_subgraph"

  name               = "subgraph-1"
  base_subgraph_name = module.resource_cosmo_federated_graph.name
  namespace          = module.resource_cosmo_namespace.name
  routing_url        = "http://example.com/routing"
}

module "data_cosmo_federated_graph" {
  source = "../data-sources/cosmo_federated_graph"

  name      = module.resource_cosmo_federated_graph.name
  namespace = module.resource_cosmo_namespace.name

  // This is necessary, as ID is computed, but the datasource depends on the not computed name. 
  // Only needed when creation and reading happen in the same apply.
  depends_on = [module.resource_cosmo_federated_graph]
}