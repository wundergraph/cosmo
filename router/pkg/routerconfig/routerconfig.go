package routerconfig

import "fmt"

func VersionPath(version int) string {
	switch version {
	case 1:
		return ""
	default:
		return fmt.Sprintf("v%d/", version)
	}
}
