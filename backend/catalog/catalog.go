// Package catalog is the content model shared by the database, the admin
// editor and the repository files: rounds ("sections") that hold questions.
//
// It parses the repository's Markdown format (front matter + one "## " heading
// and <!-- meta --> comment per question), validates fields with messages an
// editor can act on, compiles answers to HTML, and exports a section back to
// the exact file format, so content can round-trip between the admin console
// and git.
package catalog

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/anand1296/whetstone/backend/markdown"
)

// Levels a question can target, in order.
var Levels = []string{"senior", "lead", "principal"}

// Limits shared by validation and the editor UI.
const (
	MaxTitle       = 200
	MaxDescription = 300
	MaxTags        = 12
	MaxTag         = 40
	MinMinutes     = 1
	MaxMinutes     = 120
	MinBody        = 200
	MaxBody        = 100_000
	searchLimit    = 700
)

// ReservedIDs are route tokens the app uses itself; content may not claim them.
var ReservedIDs = map[string]bool{"review": true, "admin": true, "console": true, "invite": true, "api": true, "how-its-built": true, "contribute": true}

var idPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// Section is a round, as stored and edited.
type Section struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Published   bool       `json:"published"`
	Questions   []Question `json:"questions,omitempty"`
}

// Question is one interview question with its Markdown answer.
type Question struct {
	ID        string   `json:"id"`
	SectionID string   `json:"sectionId"`
	Title     string   `json:"title"`
	Level     string   `json:"level"`
	Tags      []string `json:"tags"`
	Minutes   int      `json:"minutes"`
	Body      string   `json:"body"`
	Published bool     `json:"published"`
}

// Compiled is what the reader-facing API serves for a question.
type Compiled struct {
	HTML       string
	Summary    string
	SearchText string
}

// FieldError points an editor at the field to fix.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Problems is a list of field errors; it is an error when non-empty.
type Problems []FieldError

func (p Problems) Error() string {
	parts := make([]string, len(p))
	for i, problem := range p {
		parts[i] = problem.Field + ": " + problem.Message
	}
	return strings.Join(parts, "; ")
}

func (p *Problems) add(field, format string, args ...any) {
	*p = append(*p, FieldError{Field: field, Message: fmt.Sprintf(format, args...)})
}

// ValidID reports whether id is kebab-case and not reserved.
func ValidID(id string) bool { return idPattern.MatchString(id) && !ReservedIDs[id] && len(id) <= 80 }

func isLevel(level string) bool {
	for _, l := range Levels {
		if l == level {
			return true
		}
	}
	return false
}

// NormalizeTags trims, lower-cases and de-duplicates tags, keeping order.
func NormalizeTags(tags []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	return out
}

// Normalize trims text fields in place.
func (s *Section) Normalize() {
	s.ID = strings.TrimSpace(s.ID)
	s.Title = strings.TrimSpace(s.Title)
	s.Description = strings.TrimSpace(s.Description)
}

// Validate checks a section's own fields (not its questions).
func (s Section) Validate() Problems {
	var p Problems
	if !ValidID(s.ID) {
		p.add("id", "must be kebab-case (a-z, 0-9, single hyphens), at most 80 characters, and not one of: review, admin, console, invite, api, how-its-built, contribute")
	}
	if s.Title == "" {
		p.add("title", "is required")
	} else if utf8.RuneCountInString(s.Title) > MaxTitle {
		p.add("title", "must be at most %d characters", MaxTitle)
	}
	if s.Description == "" {
		p.add("description", "is required")
	} else if utf8.RuneCountInString(s.Description) > MaxDescription {
		p.add("description", "must be at most %d characters", MaxDescription)
	}
	return p
}

// Normalize trims text fields and normalizes tags in place.
func (q *Question) Normalize() {
	q.ID = strings.TrimSpace(q.ID)
	q.Title = strings.TrimSpace(q.Title)
	q.Level = strings.ToLower(strings.TrimSpace(q.Level))
	q.Tags = NormalizeTags(q.Tags)
	q.Body = strings.TrimSpace(strings.ReplaceAll(q.Body, "\r\n", "\n"))
}

// Validate checks a question. Drafts may be incomplete (short body, no TL;DR);
// published questions must meet the full bar the static build enforces.
func (q Question) Validate() Problems {
	var p Problems
	if !ValidID(q.ID) {
		p.add("id", "must be kebab-case (a-z, 0-9, single hyphens), at most 80 characters, and not reserved")
	}
	if q.Title == "" {
		p.add("title", "is required")
	} else if utf8.RuneCountInString(q.Title) > MaxTitle {
		p.add("title", "must be at most %d characters", MaxTitle)
	} else if strings.ContainsAny(q.Title, "\n\r") {
		p.add("title", "must be a single line")
	}
	if !isLevel(q.Level) {
		p.add("level", "must be one of %s", strings.Join(Levels, ", "))
	}
	if q.Minutes < MinMinutes || q.Minutes > MaxMinutes {
		p.add("minutes", "must be a whole number from %d to %d", MinMinutes, MaxMinutes)
	}
	if len(q.Tags) == 0 {
		p.add("tags", "add at least one tag")
	} else if len(q.Tags) > MaxTags {
		p.add("tags", "use at most %d tags", MaxTags)
	}
	for _, tag := range q.Tags {
		if utf8.RuneCountInString(tag) > MaxTag || strings.ContainsAny(tag, ",\n") {
			p.add("tags", "tag %q must be at most %d characters with no commas", tag, MaxTag)
			break
		}
	}
	if len(q.Body) > MaxBody {
		p.add("body", "must be at most %d characters", MaxBody)
	}
	if len(splitQuestions(q.Body, 0)) > 0 {
		p.add("body", "use ### or deeper for headings inside an answer: a ## heading starts a new question in the repository format")
	}
	if q.Published && len(q.Body) < MinBody {
		p.add("body", "a published answer needs at least %d characters", MinBody)
	}
	return p
}

// Compiler renders and checks answers. Safe for concurrent use.
type Compiler struct {
	renderer *markdown.Renderer
}

// NewCompiler builds a compiler with its own Markdown renderer.
func NewCompiler() *Compiler { return &Compiler{renderer: markdown.New()} }

// Compile renders a question's body. Published questions must contain a [!TLDR] callout.
func (c *Compiler) Compile(q Question) (Compiled, Problems) {
	result, err := c.renderer.Render(q.Body)
	if err != nil {
		if markdown.IsContentError(err) {
			return Compiled{}, Problems{{Field: "body", Message: err.Error()}}
		}
		return Compiled{}, Problems{{Field: "body", Message: "could not render: " + err.Error()}}
	}
	if q.Published && result.Summary == "" {
		return Compiled{}, Problems{{Field: "body", Message: "a published answer must include a > [!TLDR] callout (the 60-second answer)"}}
	}
	search := strings.ToLower(result.Text)
	if len(search) > searchLimit {
		search = truncateUTF8(search, searchLimit)
	}
	return Compiled{HTML: result.HTML, Summary: result.Summary, SearchText: search}, nil
}

// Check validates and compiles in one step, returning every problem found.
func (c *Compiler) Check(q Question) (Compiled, Problems) {
	problems := q.Validate()
	compiled, renderProblems := c.Compile(q)
	return compiled, append(problems, renderProblems...)
}

func truncateUTF8(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
