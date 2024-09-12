package federated_graph_test

import (
	"fmt"
	"regexp"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/acctest"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/acceptance"
)

func TestAccFederatedGraphResource(t *testing.T) {
	rName := acctest.RandomWithPrefix("test-federated-graph")
	namespace := "default"

	routingURL := "https://example.com"
	updatedRoutingURL := "https://updated-example.com"

	readme := "Initial readme content"
	newReadme := "Updated readme content"

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { acceptance.TestAccPreCheck(t) },
		ProtoV6ProviderFactories: acceptance.TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccFederatedGraphResourceConfig(rName, namespace, routingURL, readme),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "name", rName),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "namespace", namespace),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "routing_url", routingURL),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "readme", readme),
				),
			},
			{
				Config: testAccFederatedGraphResourceConfig(rName, namespace, routingURL, newReadme),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "readme", newReadme),
				),
			},
			{
				Config: testAccFederatedGraphResourceConfig(rName, namespace, updatedRoutingURL, newReadme),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "routing_url", updatedRoutingURL),
				),
			},
		},
	})
}

func TestAccFederatedGraphResourceInvalidConfig(t *testing.T) {
	rName := acctest.RandomWithPrefix("test-federated-graph")
	namespace := "default"

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { acceptance.TestAccPreCheck(t) },
		ProtoV6ProviderFactories: acceptance.TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config:      testAccFederatedGraphResourceConfig(rName, namespace, "invalid-url", ""),
				ExpectError: regexp.MustCompile(`.*Could not create.*`),
			},
		},
	})
}

func testAccFederatedGraphResourceConfig(name, namespace, routingURL, readme string) string {
	return fmt.Sprintf(`
resource "cosmo_federated_graph" "test" {
  name      	= "%s"
  namespace 	= "%s"
  routing_url 	= "%s"
  readme    	= "%s"
}
`, name, namespace, routingURL, readme)
}
