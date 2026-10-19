package markdown

import (
	"fmt"
	"regexp"
	"strings"
)

// Frameworks lists the framework containers an answer may use, in display order.
// It mirrors FRAMEWORKS in build/content/frameworks.ts.
var Frameworks = []string{"react", "angular", "vue"}

var (
	fwOpen   = regexp.MustCompile(`^:::([a-z]+)\s*$`)
	fwClose  = regexp.MustCompile(`^:::\s*$`)
	fwFence  = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})")
	fwMarker = regexp.MustCompile(`^<!--fw:(react|angular|vue)-->$`)
)

const fwMarkerClose = "<!--/fw-->"

func isFramework(name string) bool {
	for _, f := range Frameworks {
		if f == name {
			return true
		}
	}
	return false
}

// expandFrameworkBlocks rewrites ":::framework" containers into marker comments,
// the twin of expandFrameworkBlocks in build/content/frameworks.ts.
func expandFrameworkBlocks(source string) (string, error) {
	var out []string
	fence := ""
	open, openLine := "", 0
	for i, line := range strings.Split(source, "\n") {
		if m := fwFence.FindStringSubmatch(line); m != nil {
			marker := m[1]
			switch {
			case fence == "":
				fence = marker
			case marker[0] == fence[0] && len(marker) >= len(fence) && strings.TrimSpace(line) == marker:
				fence = ""
			}
			out = append(out, line)
			continue
		}
		if fence != "" {
			out = append(out, line)
			continue
		}
		if m := fwOpen.FindStringSubmatch(line); m != nil {
			name := m[1]
			if !isFramework(name) {
				return "", &Error{Message: fmt.Sprintf("line %d: unknown framework \":::%s\". Known: %s", i+1, name, strings.Join(Frameworks, ", "))}
			}
			if open != "" {
				return "", &Error{Message: fmt.Sprintf("line %d: \":::%s\" inside \":::%s\" (opened on line %d); containers cannot nest", i+1, name, open, openLine)}
			}
			open, openLine = name, i+1
			out = append(out, "", "<!--fw:"+name+"-->", "")
			continue
		}
		if fwClose.MatchString(line) {
			if open == "" {
				return "", &Error{Message: fmt.Sprintf("line %d: \":::\" closes nothing", i+1)}
			}
			open = ""
			out = append(out, "", fwMarkerClose, "")
			continue
		}
		out = append(out, line)
	}
	if open != "" {
		return "", &Error{Message: fmt.Sprintf("\":::%s\" opened on line %d is never closed with \":::\"", open, openLine)}
	}
	return strings.Join(out, "\n"), nil
}
