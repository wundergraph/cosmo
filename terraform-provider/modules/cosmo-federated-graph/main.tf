resource "cosmo_namespace" "namespace" {
  for_each = var.create_namespace ? { "enabled" : true } : {}
  name     = var.namespace
}

data "cosmo_namespace" "namespace" {
  for_each = !var.create_namespace ? { "enabled" : true } : {}
  name     = var.namespace
}

resource "cosmo_federated_graph" "federated_graph" {
  for_each    = !var.attach_subgraphs ? { "enabled" : true } : {}
  name        = var.federated_graph.name
  routing_url = var.federated_graph.routing_url
  namespace   = var.create_namespace ? cosmo_namespace.namespace["enabled"].name : data.cosmo_namespace.namespace["enabled"].name
}

data "cosmo_federated_graph" "federated_graph" {
  for_each  = var.attach_subgraphs ? { "enabled" : true } : {}
  name      = var.federated_graph.name
  namespace = var.create_namespace ? cosmo_namespace.namespace["enabled"].name : data.cosmo_namespace.namespace["enabled"].name
}

resource "cosmo_subgraph" "subgraph" {
  for_each = var.subgraphs

  name               = each.value.name
  base_subgraph_name = var.attach_subgraphs ? data.cosmo_federated_graph.federated_graph["enabled"].name : cosmo_federated_graph.federated_graph["enabled"].name
  namespace          = var.create_namespace ? cosmo_namespace.namespace["enabled"].name : data.cosmo_namespace.namespace["enabled"].name
  routing_url        = each.value.routing_url
}


