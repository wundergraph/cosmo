module "cosmo-federated-graph" {
  source = "../../modules/cosmo-federated-graph"

  // add your stage
  stage     = "dev"
  namespace = "dev-cosmo-module"

  federated_graph = {
    name        = "dev-federated-graph"
    routing_url = "http://localhost:3000"
  }
  subgraphs = {
    "subgraph-1" = {
      name        = "subgraph-1"
      routing_url = "http://example.com/routing"
    }
  }

  // this will attach the subgraphs to an existing federated graph
  // set this to false to create a new federated graph 
  attach_subgraphs = false
  // will create a new namespace
  // set this to false to add the resources to an existing namespace
  create_namespace = true
}

