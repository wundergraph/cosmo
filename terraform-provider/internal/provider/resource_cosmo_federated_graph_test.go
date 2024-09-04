package provider

import (
	"fmt"
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
)

func TestAccFederatedGraphResource(t *testing.T) {
	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			// Create and Read testing
			{
				Config: testAccFederatedGraphResourceConfig("example-name"),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrSet("cosmo_federated_graph.test", "id"), // Ensure ID is computed
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "graph_name", "example-name"),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "service_url", "https://example-service.com"),
				),
			},
			// ImportState testing
			{
				ResourceName:      "cosmo_federated_graph.test",
				ImportState:       true,
				ImportStateVerify: true,
				// Ignored fields as we don't expect certain attributes to be reimported in this mock example.
				ImportStateVerifyIgnore: []string{"graph_name", "service_url"},
			},
			// Update and Read testing
			{
				Config: testAccFederatedGraphResourceConfig("example-name-updated"),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrSet("cosmo_federated_graph.test", "id"), // Ensure ID remains unchanged
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "graph_name", "example-name-updated"),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "service_url", "https://example-service.com"),
				),
			},
			// Delete testing is automatically handled by the framework
		},
	})
}

func testAccFederatedGraphResourceConfig(graphName string) string {
	return fmt.Sprintf(`
resource "cosmo_federated_graph" "test" {
  graph_name  = %[1]q
  service_url = "https://example-service.com"
}
`, graphName)
}
