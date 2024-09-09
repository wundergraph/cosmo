package acceptance

import (
	"fmt"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
)

func TestAccFederatedGraphResource(t *testing.T) {
	rName := "test-graph"

	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { TestAccPreCheck(t) },
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccFederatedGraphResourceConfig(rName),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "name", rName),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "readme", "Initial readme content"),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "service_url", "https://example.com"),
					resource.TestCheckResourceAttr("cosmo_federated_graph.test", "label_matchers.#", "2"),
				),
			},
			{
				ResourceName:  "cosmo_federated_graph.test",
				ImportStateId: rName,
				RefreshState:  true,
			},
		},
	})
}

func testAccFederatedGraphResourceConfig(name string) string {
	return fmt.Sprintf(`
resource "cosmo_federated_graph" "test" {
  name                   = "%s"
  namespace              = "default"
  service_url            = "https://example.com"
  readme                 = "Initial readme content"
  label_matchers         = ["team=backend", "stage=dev"]
}
`, name)
}
