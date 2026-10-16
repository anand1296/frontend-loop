package catalog

import (
	"encoding/json"
	"html"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/anand1296/frontend-loop/content"
)

func TestParseRepositoryContent(t *testing.T) {
	sections, err := ParseFS(content.Files)
	if err != nil {
		t.Fatal(err)
	}
	if len(sections) < 10 {
		t.Fatalf("expected the full bank, got %d sections", len(sections))
	}
	compiler := NewCompiler()
	total := 0
	for _, s := range sections {
		for _, q := range s.Questions {
			total++
			compiled, problems := compiler.Check(q)
			if len(problems) > 0 {
				t.Errorf("%s: %v", q.ID, problems)
			}
			if compiled.Summary == "" || compiled.HTML == "" {
				t.Errorf("%s: empty summary or html", q.ID)
			}
		}
	}
	if total < 100 {
		t.Fatalf("expected 100+ questions, got %d", total)
	}
}

func TestExportRoundTrip(t *testing.T) {
	sections, err := ParseFS(content.Files)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range sections {
		again, err := ParseFile("export.md", ExportFile(s))
		if err != nil {
			t.Fatalf("%s: %v", s.ID, err)
		}
		if again.ID != s.ID || again.Title != s.Title || again.Description != s.Description || len(again.Questions) != len(s.Questions) {
			t.Fatalf("%s: section changed in round trip", s.ID)
		}
		for i, q := range s.Questions {
			r := again.Questions[i]
			if r.ID != q.ID || r.Title != q.Title || r.Level != q.Level || r.Minutes != q.Minutes ||
				strings.Join(r.Tags, ",") != strings.Join(q.Tags, ",") || r.Body != q.Body {
				t.Fatalf("%s/%s: question changed in round trip", s.ID, q.ID)
			}
		}
	}
}

func TestParseErrorsPointAtTheProblem(t *testing.T) {
	cases := map[string]string{
		"no front matter":  "# hi",
		"bad meta":         "---\nid: a\ntitle: A\ndescription: d\n---\n\n## Q\nno meta here",
		"bad level":        "---\nid: a\ntitle: A\ndescription: d\n---\n\n## Q\n<!--\nid: q\nlevel: junior\ntags: x\nminutes: 3\n-->\n" + strings.Repeat("x", 300),
		"reserved id":      "---\nid: review\ntitle: A\ndescription: d\n---\n",
		"empty section":    "---\nid: a\ntitle: A\ndescription: d\n---\n",
		"duplicate key":    "---\nid: a\nid: b\ntitle: A\ndescription: d\n---\n",
		"minutes not int":  "---\nid: a\ntitle: A\ndescription: d\n---\n\n## Q\n<!--\nid: q\nlevel: lead\ntags: x\nminutes: lots\n-->\nbody",
		"unclosed comment": "---\nid: a\ntitle: A\ndescription: d\n---\n\n## Q\n<!--\nid: q\n",
	}
	for name, source := range cases {
		if _, err := ParseFile("content/x.md", source); err == nil {
			t.Errorf("%s: expected an error", name)
		} else if !strings.Contains(err.Error(), "content/x.md") {
			t.Errorf("%s: error should name the file: %v", name, err)
		}
	}
}

func TestQuestionValidation(t *testing.T) {
	q := Question{ID: "Bad Id", Title: "", Level: "junior", Minutes: 0, Tags: nil, Body: "short", Published: true}
	q.Normalize()
	fields := map[string]bool{}
	for _, p := range q.Validate() {
		fields[p.Field] = true
	}
	for _, want := range []string{"id", "title", "level", "minutes", "tags", "body"} {
		if !fields[want] {
			t.Errorf("expected a problem for %s", want)
		}
	}

	draft := Question{ID: "my-draft", Title: "A draft", Level: "lead", Minutes: 5, Tags: []string{" React ", "react", "hooks"}, Body: "WIP"}
	draft.Normalize()
	if problems := draft.Validate(); len(problems) > 0 {
		t.Fatalf("drafts may be short: %v", problems)
	}
	if strings.Join(draft.Tags, ",") != "react,hooks" {
		t.Fatalf("tags not normalized: %v", draft.Tags)
	}

	nested := draft
	nested.Body = "intro\n\n## Not allowed\n\n```md\n## fine inside code\n```"
	if problems := nested.Validate(); len(problems) != 1 || problems[0].Field != "body" {
		t.Fatalf("expected one body problem for a ## heading, got %v", problems)
	}
}

func TestCompileRequiresTLDRWhenPublished(t *testing.T) {
	c := NewCompiler()
	q := Question{Body: strings.Repeat("Plain words. ", 30), Published: true}
	if _, problems := c.Compile(q); len(problems) == 0 {
		t.Fatal("expected a TL;DR problem")
	}
	q.Published = false
	if _, problems := c.Compile(q); len(problems) > 0 {
		t.Fatalf("drafts compile without TL;DR: %v", problems)
	}
	q.Body = "```cobol\nMOVE 1 TO X\n```"
	if _, problems := c.Compile(q); len(problems) == 0 || !strings.Contains(problems[0].Message, "cobol") {
		t.Fatalf("expected an unsupported-language problem, got %v", problems)
	}
}

func TestCompiledHTMLIsSafe(t *testing.T) {
	c := NewCompiler()
	body := "> [!TLDR]\n> Safe.\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror=alert(1)> ![a](https://e/x.png)"
	compiled, problems := c.Compile(Question{Body: body, Published: true})
	if len(problems) > 0 {
		t.Fatal(problems)
	}
	for _, bad := range []string{"<script", "javascript:", "<img", "onerror=\""} {
		if strings.Contains(compiled.HTML, bad) {
			t.Errorf("unsafe output contains %q:\n%s", bad, compiled.HTML)
		}
	}
}

// TestParityWithStaticBuild compares the Go renderer with the TypeScript one
// (marked + highlight.js) on every answer in the repository. Highlighting is
// allowed to differ (different tokenizers); the document must not.
//
// CI produces the fixture with: node scripts/check-content.ts --emit static.json
// and runs: PARITY_FIXTURE=static.json go test ./backend/catalog -run Parity
func TestParityWithStaticBuild(t *testing.T) {
	path := os.Getenv("PARITY_FIXTURE")
	if path == "" {
		t.Skip("PARITY_FIXTURE not set")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Sections []struct {
			ID        string `json:"id"`
			Questions []struct {
				ID      string `json:"id"`
				Summary string `json:"summary"`
			} `json:"questions"`
		} `json:"sections"`
		Answers map[string]map[string]string `json:"answers"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	sections, err := ParseFS(content.Files)
	if err != nil {
		t.Fatal(err)
	}
	c := NewCompiler()
	checked := 0
	for _, s := range sections {
		for _, q := range s.Questions {
			want, ok := fixture.Answers[s.ID][q.ID]
			if !ok {
				t.Errorf("%s missing from fixture", q.ID)
				continue
			}
			got, problems := c.Compile(q)
			if len(problems) > 0 {
				t.Fatalf("%s: %v", q.ID, problems)
			}
			if a, b := normalizeHTML(got.HTML), normalizeHTML(want); a != b {
				i := firstDiff(a, b)
				t.Errorf("%s differs at %d:\n go: %s\n ts: %s", q.ID, i, excerpt(a, i), excerpt(b, i))
			}
			checked++
		}
	}
	for _, s := range fixture.Sections {
		for _, q := range s.Questions {
			for _, gs := range sections {
				for _, gq := range gs.Questions {
					if gq.ID == q.ID {
						got, _ := c.Compile(gq)
						// The TS toPlainText strips every "*" (even inside code spans, e.g. "base * 2"); Go keeps them.
						if stripStars(got.Summary) != stripStars(q.Summary) {
							t.Errorf("%s summary differs:\n go: %s\n ts: %s", q.ID, got.Summary, q.Summary)
						}
					}
				}
			}
		}
	}
	t.Logf("compared %d answers", checked)
}

var (
	spanTag    = regexp.MustCompile(`</?span[^>]*>`)
	betweenTag = regexp.MustCompile(`>\s+<`)
	anySpace   = regexp.MustCompile(`\s+`)
)

func normalizeHTML(s string) string {
	s = spanTag.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	s = betweenTag.ReplaceAllString(s, "><")
	return strings.TrimSpace(anySpace.ReplaceAllString(s, " "))
}

func stripStars(s string) string {
	return strings.TrimSpace(anySpace.ReplaceAllString(strings.ReplaceAll(s, "*", ""), " "))
}

func firstDiff(a, b string) int {
	n := min(len(a), len(b))
	for i := 0; i < n; i++ {
		if a[i] != b[i] {
			return i
		}
	}
	return n
}

func excerpt(s string, i int) string {
	start := max(0, i-80)
	end := min(len(s), i+80)
	return s[start:end]
}
