package stringsx

func Contains(s []string, e string) bool {
	for _, a := range s {
		if a == e {
			return true
		}
	}
	return false
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
