package stringsx

import "slices"

func Contains(s []string, e string) bool {
	return slices.Contains(s, e)
}

func RemoveDuplicates(strList []string) []string {
	var list []string
	for _, item := range strList {
		if !Contains(list, item) {
			list = append(list, item)
		}
	}
	return list
}
