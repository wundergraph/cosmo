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

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { acceptance.TestAccPreCheck(t) },
		ProtoV6ProviderFactories: acceptance.TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccFederatedGraphResourceConfig(rName, namespace),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "name", rName),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "namespace", namespace),
				),
			},
			{
				Config: testAccFederatedGraphResourceUpdateConfig(rName, namespace),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "readme", "Updated readme content"),
				),
			},
		},
	})
}

func testAccFederatedGraphResourceConfig(name, namespace string) string {
	return fmt.Sprintf(`
resource "cosmo_federated_graph" "test" {
  name      = "%s"
  namespace = "%s"
  service_url = "https://example.com"
}
`, name, namespace)
}

func testAccFederatedGraphResourceUpdateConfig(name, namespace string) string {
	return fmt.Sprintf(`
resource "cosmo_federated_graph" "test" {
  name      = "%s"
  namespace = "%s"
  service_url = "https://example.com"
  readme    = "Updated readme content"
}
`, name, namespace)
}
