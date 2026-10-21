package stringsx

import "slices"

func RemoveDuplicates(strList []string) []string {
	var list []string
	for _, item := range strList {
		if !slices.Contains(list, item) {
			list = append(list, item)
		}
	}
	return list
}
