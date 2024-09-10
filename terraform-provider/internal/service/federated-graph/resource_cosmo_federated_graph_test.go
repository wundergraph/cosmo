package federated_graph_test

import (
	"fmt"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/acctest"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/acceptance"
)

func TestAccFederatedGraphResource(t *testing.T) {
	rName := acctest.RandomWithPrefix("test-federated-graph")
	namespace := "default"
	routingURL := "https://example.com"

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { acceptance.TestAccPreCheck(t) },
		ProtoV6ProviderFactories: acceptance.TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccFederatedGraphResourceConfig(rName, namespace, routingURL),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "name", rName),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "namespace", namespace),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "routing_url", routingURL),
				),
			},
			{
				Config: testAccFederatedGraphResourceUpdateConfig(rName, namespace, routingURL),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "readme", "Updated readme content"),
				),
			},
		},
	})
}

func testAccFederatedGraphResourceConfig(name, namespace, routingURL string) string {
	return fmt.Sprintf(`
resource "cosmo_federated_graph" "test" {
  name      	= "%s"
  namespace 	= "%s"
  routing_url 	= "%s"
}
`, name, namespace, routingURL)
}

func testAccFederatedGraphResourceUpdateConfig(name, namespace, routingURL string) string {
	return fmt.Sprintf(`
resource "cosmo_federated_graph" "test" {
  name      = "%s"
  namespace = "%s"
  routing_url = "%s"
  readme    = "Updated readme content"
}
`, name, namespace, routingURL)
}
