package monograph_test

import (
	"fmt"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/acceptance"
)

func TestAccMonographResource(t *testing.T) {
	rName := "test-monograph"
	rNamespace := "default"
	rGraphUrl := "http://example.com/graphql"
	rRoutingURL := "http://example.com/routing"

	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { acceptance.TestAccPreCheck(t) },
		ProtoV6ProviderFactories: acceptance.TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccMonographResourceConfig(rName, rNamespace, rGraphUrl, rRoutingURL),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_monograph.test", "name", rName),
					resource.TestCheckResourceAttr("cosmo_monograph.test", "namespace", rNamespace),
					resource.TestCheckResourceAttr("cosmo_monograph.test", "graph_url", rGraphUrl),
					resource.TestCheckResourceAttr("cosmo_monograph.test", "routing_url", rRoutingURL),
					resource.TestCheckResourceAttrSet("cosmo_monograph.test", "id"),
				),
			},
			{
				ResourceName: "cosmo_monograph.test",
				RefreshState: true,
			},
		},
	})
}

func testAccMonographResourceConfig(name, namespace, graphUrl, routingURL string) string {
	return fmt.Sprintf(`
resource "cosmo_monograph" "test" {
	name = "%s"
	namespace = "%s"
	graph_url = "%s"
	routing_url = "%s"
}
	`, name, namespace, graphUrl, routingURL)
}
