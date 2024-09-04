package provider

import (
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
)

func TestAccCosmoFederatedGraphDataSource(t *testing.T) {
	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			// Read testing
			{
				Config: testAccCosmoFederatedGraphDataSourceConfig,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("data.cosmo_federated_graph.test", "graph_id", "example-graph-id"),
					resource.TestCheckResourceAttr("data.cosmo_federated_graph.test", "graph_name", "example-graph-name"),
					resource.TestCheckResourceAttr("data.cosmo_federated_graph.test", "service_url", "https://example.com/service"),
					resource.TestCheckResourceAttrSet("data.cosmo_federated_graph.test", "id"), // Ensure ID is computed
				),
			},
		},
	})
}

const testAccCosmoFederatedGraphDataSourceConfig = `
data "cosmo_federated_graph" "test" {
  graph_id    = "example-graph-id"
  graph_name  = "example-graph-name"
  service_url = "https://example.com/service"
}
`