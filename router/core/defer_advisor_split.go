package core

import (
	"fmt"
	"slices"
)

func maxSplitLabel(fetch *advisorFetch, field string) string {
	return fmt.Sprintf("adv_%d_%s", fetch.fetchID, field)
}

// maxSplitGroups builds one single-field defer group per field of every
// dependent fetch. Root fields stay inline to form the initial response
// skeleton that deferred entity fetches hang from.
func maxSplitGroups(fetches []*advisorFetch) []deferGroup {
	var groups []deferGroup
	for _, fetch := range fetches {
		if len(fetch.dependsOn) == 0 {
			continue
		}
		for _, field := range fetch.fields {
			groups = append(groups, deferGroup{
				ParentPath: slices.Clone(fetch.clientParentPath),
				Fields:     []string{field},
				Label:      maxSplitLabel(fetch, field),
			})
		}
	}
	return groups
}
