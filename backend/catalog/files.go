package catalog

import (
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// ParseError locates a problem in a repository content file.
type ParseError struct {
	File    string
	Line    int
	Message string
}

func (e *ParseError) Error() string {
	if e.Line > 0 {
		return fmt.Sprintf("%s:%d: %s", e.File, e.Line, e.Message)
	}
	return fmt.Sprintf("%s: %s", e.File, e.Message)
}

// parseKeyValues is the Go port of build/content/frontmatter.ts parseKeyValueBlock.
func parseKeyValues(block, file string, firstLine int) (map[string]string, error) {
	out := map[string]string{}
	for i, raw := range strings.Split(block, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		colon := strings.Index(line, ":")
		if colon <= 0 {
			return nil, &ParseError{file, firstLine + i, fmt.Sprintf("line is not \"key: value\" -> %q", raw)}
		}
		key := strings.TrimSpace(line[:colon])
		if _, dup := out[key]; dup {
			return nil, &ParseError{file, firstLine + i, fmt.Sprintf("duplicate key %q", key)}
		}
		out[key] = strings.TrimSpace(line[colon+1:])
	}
	return out, nil
}

var fencePattern = regexp.MustCompile("^\\s*(```|~~~)")
var headingPattern = regexp.MustCompile(`^##\s+(.+?)\s*$`)

type rawQuestion struct {
	title string
	body  string
	line  int
}

// splitQuestions splits a body on "## " headings, ignoring headings inside fenced code.
func splitQuestions(body string, offset int) []rawQuestion {
	var out []rawQuestion
	fence := ""
	var current *rawQuestion
	for i, line := range strings.Split(body, "\n") {
		if m := fencePattern.FindStringSubmatch(line); m != nil {
			if fence == "" {
				fence = m[1]
			} else if fence == m[1] {
				fence = ""
			}
		}
		if fence == "" {
			if m := headingPattern.FindStringSubmatch(line); m != nil {
				out = append(out, rawQuestion{title: m[1], line: offset + i + 1})
				current = &out[len(out)-1]
				continue
			}
		}
		if current != nil {
			current.body += line + "\n"
		}
	}
	return out
}

// ParseFile parses one repository round file. Questions are published.
func ParseFile(file, source string) (Section, error) {
	source = strings.ReplaceAll(source, "\r\n", "\n")
	if !strings.HasPrefix(source, "---\n") {
		return Section{}, &ParseError{File: file, Message: "file must start with a --- front matter block"}
	}
	end := strings.Index(source[4:], "\n---")
	if end == -1 {
		return Section{}, &ParseError{File: file, Message: "front matter block is not closed with ---"}
	}
	end += 4
	data, err := parseKeyValues(source[4:end], file, 2)
	if err != nil {
		return Section{}, err
	}
	rest := source[end+1:]
	bodyStart := strings.Index(rest, "\n")
	body := ""
	if bodyStart != -1 {
		body = rest[bodyStart+1:]
	}
	headerLines := strings.Count(source[:len(source)-len(body)], "\n")

	section := Section{ID: data["id"], Title: data["title"], Description: data["description"], Published: true}
	section.Normalize()
	if problems := section.Validate(); len(problems) > 0 {
		return Section{}, &ParseError{File: file, Line: 1, Message: problems.Error()}
	}

	for _, raw := range splitQuestions(body, headerLines) {
		q, err := parseQuestion(raw, section.ID, file)
		if err != nil {
			return Section{}, err
		}
		section.Questions = append(section.Questions, q)
	}
	if len(section.Questions) == 0 {
		return Section{}, &ParseError{File: file, Message: "section has no questions"}
	}
	return section, nil
}

func parseQuestion(raw rawQuestion, sectionID, file string) (Question, error) {
	where := func(msg string) error {
		return &ParseError{File: file, Line: raw.line, Message: fmt.Sprintf("%q: %s", raw.title, msg)}
	}
	trimmed := strings.TrimLeft(raw.body, " \t\n")
	if !strings.HasPrefix(trimmed, "<!--") {
		return Question{}, where("question must start with a <!-- meta --> comment (id, level, tags, minutes)")
	}
	closeAt := strings.Index(trimmed, "-->")
	if closeAt == -1 {
		return Question{}, where("meta comment is not closed with -->")
	}
	meta, err := parseKeyValues(trimmed[4:closeAt], file, raw.line+1)
	if err != nil {
		return Question{}, err
	}
	for _, key := range []string{"id", "level", "tags", "minutes"} {
		if meta[key] == "" {
			return Question{}, where(fmt.Sprintf("missing required field %q", key))
		}
	}
	minutes, err := strconv.Atoi(meta["minutes"])
	if err != nil {
		return Question{}, where("minutes must be an integer")
	}
	q := Question{
		ID:        meta["id"],
		SectionID: sectionID,
		Title:     raw.title,
		Level:     meta["level"],
		Tags:      strings.Split(meta["tags"], ","),
		Minutes:   minutes,
		Body:      trimmed[closeAt+3:],
		Published: true,
	}
	q.Normalize()
	if problems := q.Validate(); len(problems) > 0 {
		return Question{}, where(problems.Error())
	}
	return q, nil
}

// ParseFS parses every *.md file at the root of fsys, in file-name order,
// and checks that section and question ids are unique across all of them.
func ParseFS(fsys fs.FS) ([]Section, error) {
	names, err := fs.Glob(fsys, "*.md")
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	var sections []Section
	seen := map[string]string{}
	claim := func(id, owner string) error {
		if previous, dup := seen[id]; dup {
			return fmt.Errorf("duplicate id %q used by %s and %s", id, previous, owner)
		}
		seen[id] = owner
		return nil
	}
	for _, name := range names {
		data, err := fs.ReadFile(fsys, name)
		if err != nil {
			return nil, err
		}
		path := "content/" + name
		section, err := ParseFile(path, string(data))
		if err != nil {
			return nil, err
		}
		if err := claim(section.ID, path); err != nil {
			return nil, err
		}
		for _, q := range section.Questions {
			if err := claim(q.ID, fmt.Sprintf("%s %q", path, q.Title)); err != nil {
				return nil, err
			}
		}
		sections = append(sections, section)
	}
	return sections, nil
}

// ExportFile renders a section in the repository file format. Parsing the
// output with ParseFile yields the same section (round-trip tested).
func ExportFile(s Section) string {
	var b strings.Builder
	fmt.Fprintf(&b, "---\nid: %s\ntitle: %s\ndescription: %s\n---\n", s.ID, oneLine(s.Title), oneLine(s.Description))
	for _, q := range s.Questions {
		fmt.Fprintf(&b, "\n## %s\n<!--\nid: %s\nlevel: %s\ntags: %s\nminutes: %d\n-->\n\n%s\n",
			oneLine(q.Title), q.ID, q.Level, strings.Join(q.Tags, ", "), q.Minutes, strings.TrimSpace(q.Body))
	}
	return b.String()
}

// ExportFileName is the conventional file name for a section at a 0-based position.
func ExportFileName(position int, id string) string { return fmt.Sprintf("%02d-%s.md", position+1, id) }

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }
