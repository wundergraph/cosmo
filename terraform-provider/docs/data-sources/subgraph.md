---
# generated by https://github.com/hashicorp/terraform-plugin-docs
page_title: "cosmo_subgraph Data Source - cosmo"
subcategory: ""
description: |-
  Cosmo Subgraph Data Source
---

# cosmo_subgraph (Data Source)

Cosmo Subgraph Data Source

## Example Usage

```terraform
terraform {
  required_providers {
    cosmo = {
      source  = "terraform.local/wundergraph/cosmo"
      version = "0.0.1"
    }
  }
}

data "cosmo_subgraph" "test" {
  name      = var.name
  namespace = var.namespace
}
```

<!-- schema generated by tfplugindocs -->
## Schema

### Required

- `name` (String) The name of the subgraph.
- `namespace` (String) The namespace in which the subgraph is located.

### Read-Only

- `base_subgraph_name` (String) The base subgraph name.
- `headers` (List of String) Headers for the subgraph.
- `id` (String) The unique identifier of the subgraph resource.
- `is_event_driven_graph` (Boolean) Indicates if the subgraph is event-driven.
- `is_feature_subgraph` (Boolean) Indicates if the subgraph is a feature subgraph.
- `labels` (List of String) Labels for the subgraph.
- `readme` (String) The readme for the subgraph.
- `routing_url` (String) The routing URL of the subgraph.
- `subscription_protocol` (String) The subscription protocol for the subgraph.
- `subscription_url` (String) The subscription URL for the subgraph.
- `websocket_subprotocol` (String) The websocket subprotocol for the subgraph.