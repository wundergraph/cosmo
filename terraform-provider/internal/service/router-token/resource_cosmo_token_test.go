package router_token_test

import (
	"fmt"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/acctest"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/acceptance"
)

func TestAccTokenResource(t *testing.T) {
	name := acctest.RandomWithPrefix("test-token")
	namespace := acctest.RandomWithPrefix("test-namespace")

	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { acceptance.TestAccPreCheck(t) },
		ProtoV6ProviderFactories: acceptance.TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccTokenResourceConfig(namespace, name),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_router_token.test", "name", name),
					resource.TestCheckResourceAttr("cosmo_router_token.test", "namespace", namespace),
					resource.TestCheckResourceAttr("cosmo_router_token.test", "graph_name", "federated-graph"),
				),
			},
			{
				Config: testAccTokenResourceConfig(namespace, name),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_router_token.test", "graph_name", "federated-graph"),
				),
			},
			{
				ResourceName: "cosmo_router_token.test",
				RefreshState: true,
			},
		},
	})
}

func testAccTokenResourceConfig(namespace, name string) string {
	return fmt.Sprintf(`
resource "cosmo_namespace" "test" {
  name = "%s"
}

resource "cosmo_federated_graph" "test" {
  name      	= "federated-graph"
  namespace 	= cosmo_namespace.test.name
  routing_url 	= "https://example.com"
  readme    	= "This is a test federated graph"
}

resource "cosmo_router_token" "test" {
  name       = "%s"
  namespace  = cosmo_namespace.test.name
  graph_name = cosmo_federated_graph.test.name
}
`, namespace, name)
}
