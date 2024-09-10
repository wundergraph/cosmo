locals {
  stages = {
    dev  = {},
    stg  = {},
    prod = {}
  }
  subgraphs = {
    "product-api" = {
      routing_url = "http://product-api:3000/graphql"
    },
    "employees-api" = {
      routing_url = "http://employees-api:3000/graphql"
    }
    "family-api" = {
      routing_url = "http://family-api:3000/graphql"
    },
    "hobbies-api" = {
      routing_url = "http://hobbies-api:3000/graphql"
    },
    "availability-api" = {
      routing_url = "http://availability-api:3000/graphql"
    },
  }
  stage_subgrahs = merge(flatten([
    for key, value in local.stages : {
      for subgraph, subgraph_value in local.subgraphs :
      "${key}-${subgraph}" => {
        "stage"       = key
        "subgraph"    = subgraph
        "routing_url" = subgraph_value.routing_url
      }
  }])...)
}

// create a namespace for each stage
// e.g. dev-namespace, stg-namespace, prod-namespace
resource "cosmo_namespace" "namespace" {
  for_each = local.stages

  name = "${each.key}-namespace"
}

// create a federated graph for each stage
// e.g. dev-federated-graph, stg-federated-graph, prod-federated-graph
resource "cosmo_federated_graph" "federated_graph" {
  for_each = local.stages

  name        = "${each.key}-federated-graph"
  routing_url = "http://${each.key}.localhost:3000"
  namespace   = cosmo_namespace.namespace[each.key].name
}

// create each stages subgraph
// e.g. dev-subgraph, stg-subgraph, prod-subgraph
resource "cosmo_subgraph" "subgraph" {
  for_each = local.stage_subgrahs

  name               = "${each.key}-subgraph"
  base_subgraph_name = cosmo_federated_graph.federated_graph[each.value.stage].name
  namespace          = cosmo_namespace.namespace[each.value.stage].name

  routing_url = each.value.routing_url
}