package federated_graph_test

import (
	"fmt"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/acceptance"
)

func TestAccFederatedGraphDataSource(t *testing.T) {
	rName := "test-monograph"

	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { acceptance.TestAccPreCheck(t) },
		ProtoV6ProviderFactories: acceptance.TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccFederatedGraphDataSourceConfig(rName),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("data.cosmo_federated_graph.test", "name", rName),
					resource.TestCheckResourceAttr("data.cosmo_federated_graph.test", "namespace", "default"),
				),
			},
			{
				ResourceName: "data.cosmo_federated_graph.test",
				RefreshState: true,
			},
		},
	})
}

func testAccFederatedGraphDataSourceConfig(name string) string {
	return fmt.Sprintf(`
resource "cosmo_federated_graph" "test" {
  name      = "%s"
  namespace = "default"
  service_url = "https://example.com"
}

data "cosmo_federated_graph" "test" {
  name      = cosmo_federated_graph.test.name
  namespace = cosmo_federated_graph.test.namespace
}
`, name)
}
