package progress

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func ptr(f float64) *float64 { return &f }

func TestParseDropsInvalidEntries(t *testing.T) {
	raw := `{"version":1,"questions":{
		"ok":{"done":true,"doneAt":1,"stage":2.7,"dueAt":5,"notes":"n","updatedAt":10},
		"no-clock":{"done":true},
		"bad-type":"yes",
		"neg-stage":{"done":false,"stage":-3,"updatedAt":4,"dueAt":"soon"}
	},"lastVisit":{"sectionId":"js","questionId":"ok","at":11}}`
	doc, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Questions) != 2 {
		t.Fatalf("expected 2 valid entries, got %v", doc.Questions)
	}
	if q := doc.Questions["ok"]; q.Stage != 2 || *q.DueAt != 5 || q.Notes != "n" {
		t.Fatalf("unexpected entry %+v", q)
	}
	if q := doc.Questions["neg-stage"]; q.Stage != 0 || q.DueAt != nil {
		t.Fatalf("unexpected clamp %+v", q)
	}
	if doc.LastVisit == nil || *doc.LastVisit.QuestionID != "ok" {
		t.Fatalf("lastVisit lost: %+v", doc.LastVisit)
	}
	for _, bad := range []string{`[]`, `{"version":2,"questions":{}}`, `{"version":1}`, `nope`} {
		if _, err := Parse([]byte(bad)); err == nil {
			t.Errorf("%s: expected ErrInvalid", bad)
		}
	}
}

func TestParseClipsNotes(t *testing.T) {
	long := strings.Repeat("é", NotesLimit+50)
	raw, _ := json.Marshal(map[string]any{"version": 1, "questions": map[string]any{"q": map[string]any{"done": false, "notes": long, "updatedAt": 1}}})
	doc, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if n := len([]rune(doc.Questions["q"].Notes)); n != NotesLimit {
		t.Fatalf("notes not clipped: %d", n)
	}
}

func TestMergeIsLastWriterWinsAndConverges(t *testing.T) {
	a := Empty()
	a.Questions["x"] = Question{Done: true, UpdatedAt: 5}
	a.Questions["y"] = Question{Done: false, UpdatedAt: 9}
	a.LastVisit = &LastVisit{SectionID: "s1", At: 3}
	b := Empty()
	b.Questions["x"] = Question{Done: false, UpdatedAt: 7}
	b.Questions["y"] = Question{Done: true, UpdatedAt: 2}
	b.Questions["z"] = Question{Done: true, UpdatedAt: 1}
	b.LastVisit = &LastVisit{SectionID: "s2", At: 4}

	ab, ba := Merge(a, b), Merge(b, a)
	if !reflect.DeepEqual(ab, ba) {
		t.Fatalf("merge must be commutative:\n%+v\n%+v", ab, ba)
	}
	if !reflect.DeepEqual(Merge(ab, b), ab) {
		t.Fatal("merge must be idempotent")
	}
	if ab.Questions["x"].Done || !ab.Questions["z"].Done || ab.Questions["y"].Done || ab.LastVisit.SectionID != "s2" {
		t.Fatalf("wrong winners: %+v", ab)
	}
}

func TestSummarizeCountsOnlyCurrentContent(t *testing.T) {
	doc := Empty()
	doc.Questions["a"] = Question{Done: true, DueAt: ptr(100), UpdatedAt: 50}
	doc.Questions["b"] = Question{Done: true, DueAt: ptr(500), UpdatedAt: 60}
	doc.Questions["deleted"] = Question{Done: true, UpdatedAt: 70}
	outline := []SectionOutline{{ID: "one", QuestionIDs: []string{"a", "b"}}, {ID: "two", QuestionIDs: []string{"c"}}}
	s := Summarize(doc, outline, 200)
	if s.DoneCount != 2 || s.Total != 3 || s.DueCount != 1 || s.ByRound["one"] != 2 || s.ByRound["two"] != 0 || s.LastActiveAt != 70 {
		t.Fatalf("unexpected summary %+v", s)
	}
}
