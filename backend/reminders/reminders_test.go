package reminders

import (
	"strings"
	"testing"
	"time"

	"github.com/anand1296/frontend-loop/backend/progress"
)

var now = time.Date(2026, 10, 17, 3, 30, 0, 0, time.UTC)

func ms(t time.Time) float64 { return float64(t.UnixMilli()) }
func ptr(f float64) *float64 { return &f }

func rounds() []Round {
	return []Round{
		{ID: "js", Title: "JavaScript", Questions: []Question{{"q1", "Event loop?"}, {"q2", "Closures?"}}},
		{ID: "react", Title: "React <Internals>", Questions: []Question{{"q3", "What is `useMemo` for?"}, {"q4", "Fiber?"}}},
	}
}

func input(doc progress.Doc) Input {
	return Input{UserID: 7, Name: "Anand Khandalekar", Email: "anand@example.com", SiteName: "Whetstone",
		AppURL: "https://loop.example", UnsubscribeURL: "https://loop.example/api/reminders/unsubscribe?token=abc",
		Frequency: "weekly", Doc: doc, Rounds: rounds(), Now: now}
}

func TestSummarizeAndNext(t *testing.T) {
	doc := progress.Empty()
	doc.Questions["q1"] = progress.Question{Done: true, DueAt: ptr(ms(now.Add(-time.Hour))), UpdatedAt: ms(now.Add(-48 * time.Hour))}
	doc.Questions["q2"] = progress.Question{Done: true, DueAt: ptr(ms(now.Add(time.Hour))), UpdatedAt: ms(now.Add(-48 * time.Hour))}
	q2 := "q2"
	doc.LastVisit = &progress.LastVisit{SectionID: "js", QuestionID: &q2, At: ms(now.Add(-48 * time.Hour))}
	s := Summarize(input(doc))
	if s.Done != 2 || s.Total != 4 || s.Percent != 50 || s.Due != 1 || s.RoundsFinished != 1 || s.DaysAway != 2 {
		t.Fatalf("unexpected snapshot %+v", s)
	}
	if s.Next == nil || s.Next.ID != "q3" || s.Next.Title != "What is useMemo for?" || s.Next.URL != "https://loop.example/#q3" {
		t.Fatalf("next should continue after the last visited question: %+v", s.Next)
	}
}

func TestMotivationFitsTheSituation(t *testing.T) {
	cases := []struct {
		name string
		doc  func() progress.Doc
		want string
	}{
		{"never started", progress.Empty, "first one"},
		{"all done", func() progress.Doc {
			d := progress.Empty()
			for _, id := range []string{"q1", "q2", "q3", "q4"} {
				d.Questions[id] = progress.Question{Done: true, UpdatedAt: ms(now)}
			}
			return d
		}, "every question"},
		{"away for a while", func() progress.Doc {
			d := progress.Empty()
			d.Questions["q1"] = progress.Question{Done: true, UpdatedAt: ms(now.Add(-10 * 24 * time.Hour))}
			return d
		}, "10 days"},
		{"reviews due", func() progress.Doc {
			d := progress.Empty()
			d.Questions["q1"] = progress.Question{Done: true, DueAt: ptr(ms(now.Add(-time.Hour))), UpdatedAt: ms(now)}
			return d
		}, "1 answer is due"},
	}
	for _, c := range cases {
		in := input(c.doc())
		if got := Motivation(Summarize(in), in); !strings.Contains(got, c.want) {
			t.Errorf("%s: %q should mention %q", c.name, got, c.want)
		}
	}
}

func TestComposeEmail(t *testing.T) {
	doc := progress.Empty()
	doc.Questions["q1"] = progress.Question{Done: true, DueAt: ptr(ms(now.Add(-time.Hour))), UpdatedAt: ms(now)}
	msg, err := Compose(input(doc))
	if err != nil {
		t.Fatal(err)
	}
	if msg.To != "anand@example.com" || msg.Subject != "Whetstone: 1/4 done · 1 due for review" {
		t.Fatalf("unexpected envelope %q / %q", msg.To, msg.Subject)
	}
	for _, want := range []string{"Hi Anand,", "1 / 4", "https://loop.example/#q2", "https://loop.example/#review", "unsubscribe?token=abc", "Continue studying"} {
		if !strings.Contains(msg.HTML, want) {
			t.Errorf("HTML missing %q", want)
		}
	}
	for _, want := range []string{"Hi Anand,", "1 of 4 questions (25%)", "Up next: Closures? (JavaScript)", "Unsubscribe: https://loop.example/api/reminders/unsubscribe?token=abc"} {
		if !strings.Contains(msg.Text, want) {
			t.Errorf("text missing %q:\n%s", want, msg.Text)
		}
	}
	if !strings.Contains(msg.Headers["List-Unsubscribe"], "token=abc") || msg.Headers["List-Unsubscribe-Post"] != "List-Unsubscribe=One-Click" {
		t.Errorf("one-click unsubscribe headers missing: %v", msg.Headers)
	}
}

func TestComposeEscapesContent(t *testing.T) {
	doc := progress.Empty()
	doc.Questions["q3"] = progress.Question{Done: true, UpdatedAt: ms(now)}
	in := input(doc)
	in.Name = "<script>alert(1)</script>"
	msg, err := Compose(in)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(msg.HTML, "<script>") || strings.Contains(msg.HTML, "React <Internals>") {
		t.Fatal("names and titles must be HTML-escaped")
	}
}
