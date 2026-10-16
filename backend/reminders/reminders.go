// Package reminders turns a learner's progress into a reminder email: where
// they stand, what's due, the next question to open, a link back, and a
// motivational line that fits their situation.
//
// It is pure (no I/O): the server gathers the inputs, this package decides
// what to say, and tests can check every branch.
package reminders

import (
	"bytes"
	"fmt"
	htmltemplate "html/template"
	"math"
	"sort"
	"strings"
	texttemplate "text/template"
	"time"

	"github.com/anand1296/frontend-loop/backend/mail"
	"github.com/anand1296/frontend-loop/backend/progress"
)

// Frequencies a user can choose, in display order.
var Frequencies = []string{"daily", "every3days", "weekly"}

// ValidFrequency reports whether f is a known frequency.
func ValidFrequency(f string) bool {
	for _, x := range Frequencies {
		if x == f {
			return true
		}
	}
	return false
}

// Question and Round describe the published content, in learning order.
type Question struct {
	ID    string
	Title string
}

type Round struct {
	ID        string
	Title     string
	Questions []Question
}

// Input is everything needed to write one reminder.
type Input struct {
	UserID         int64
	Name           string
	Email          string
	SiteName       string
	AppURL         string // e.g. https://frontend-loop.vercel.app (no trailing slash)
	UnsubscribeURL string
	Frequency      string
	Doc            progress.Doc
	Rounds         []Round
	Now            time.Time
}

// RoundProgress is one line of the per-round summary.
type RoundProgress struct {
	Title   string
	Done    int
	Total   int
	Percent int
}

// Next is the question "Continue" would open.
type Next struct {
	ID         string
	Title      string
	RoundTitle string
	URL        string
}

// Snapshot is the computed progress picture.
type Snapshot struct {
	Done, Total, Percent, Due, RoundsFinished int
	DaysAway                                  int // -1 when never active
	Next                                      *Next
	InProgress                                []RoundProgress
}

func pct(done, total int) int {
	if total == 0 {
		return 0
	}
	return int(math.Round(float64(done) * 100 / float64(total)))
}

// Summarize computes the snapshot. "Next" follows the app's Continue rule: the
// last visited question if not done, else the next not-done one after it.
func Summarize(in Input) Snapshot {
	s := Snapshot{DaysAway: -1}
	nowMs := float64(in.Now.UnixMilli())
	type flat struct {
		q     Question
		round string
	}
	var ordered []flat
	for _, r := range in.Rounds {
		done := 0
		for _, q := range r.Questions {
			ordered = append(ordered, flat{q, r.Title})
			entry, ok := in.Doc.Questions[q.ID]
			if ok && entry.Done {
				done++
				if entry.DueAt != nil && *entry.DueAt <= nowMs {
					s.Due++
				}
			}
		}
		s.Done += done
		s.Total += len(r.Questions)
		if len(r.Questions) > 0 && done == len(r.Questions) {
			s.RoundsFinished++
		} else if done > 0 {
			s.InProgress = append(s.InProgress, RoundProgress{r.Title, done, len(r.Questions), pct(done, len(r.Questions))})
		}
	}
	s.Percent = pct(s.Done, s.Total)
	sort.SliceStable(s.InProgress, func(i, j int) bool { return s.InProgress[i].Percent > s.InProgress[j].Percent })
	if len(s.InProgress) > 3 {
		s.InProgress = s.InProgress[:3]
	}

	var last float64
	if in.Doc.LastVisit != nil {
		last = in.Doc.LastVisit.At
	}
	for _, q := range in.Doc.Questions {
		last = math.Max(last, q.UpdatedAt)
	}
	if last > 0 {
		s.DaysAway = int((nowMs - last) / float64(24*time.Hour/time.Millisecond))
	}

	isDone := func(id string) bool { e, ok := in.Doc.Questions[id]; return ok && e.Done }
	start := 0
	if lv := in.Doc.LastVisit; lv != nil && lv.QuestionID != nil {
		for i, f := range ordered {
			if f.q.ID == *lv.QuestionID {
				start = i
				break
			}
		}
	}
	for k := 0; k < len(ordered); k++ {
		f := ordered[(start+k)%len(ordered)]
		if !isDone(f.q.ID) {
			s.Next = &Next{ID: f.q.ID, Title: strings.ReplaceAll(f.q.Title, "`", ""), RoundTitle: f.round, URL: in.AppURL + "/#" + f.q.ID}
			break
		}
	}
	return s
}

// general lines rotate day by day so frequent emails don't repeat themselves.
var general = []string{
	"Senior interviews reward people who can explain trade-offs out loud. Every answer you practice is a sentence you won't have to invent under pressure.",
	"Small, steady reps beat weekend marathons. One question today keeps the whole loop warm.",
	"You don't need to know everything. You need to reason clearly about what you do know, and that is exactly what practice builds.",
	"The candidates who stand out aren't the ones who memorized the most. They're the ones who've said it out loud before.",
	"Fifteen focused minutes is enough for one good answer. That's one fewer thing to worry about in the room.",
	"Depth is built one question at a time. Today's one is waiting for you.",
	"Confidence in an interview is mostly rehearsal. Rehearse one answer today.",
	"Principal-level answers come from connecting ideas. Every question you revisit adds a connection.",
	"Progress compounds: the rounds you've finished make the next ones easier to explain.",
	"Future you, sitting across from the interviewer, will thank present you for this session.",
}

// Motivation picks a line that fits the learner's situation.
func Motivation(s Snapshot, in Input) string {
	switch {
	case s.Total > 0 && s.Done == s.Total:
		return "You've ticked every question in the loop. Now keep it sharp: a few refreshers a week keeps every answer ready for the room."
	case s.Done == 0:
		return "The hardest question is the first one. Open the app, pick one, and try answering it out loud before you read."
	case s.DaysAway >= 7:
		return fmt.Sprintf("It's been %d days since your last session. Interviews reward consistency more than cramming: one question today restarts the habit.", s.DaysAway)
	case s.Due > 0:
		return fmt.Sprintf("%d %s due for a refresher. Ten minutes of recall now saves an hour of re-reading later.", s.Due, plural(s.Due, "answer is", "answers are"))
	case s.Percent >= 75:
		return fmt.Sprintf("You're %d%% of the way through. The finish line is close; keep the momentum.", s.Percent)
	}
	return general[(in.Now.YearDay()+int(in.UserID))%len(general)]
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func firstName(name, fallback string) string {
	if f := strings.Fields(name); len(f) > 0 {
		return f[0]
	}
	return fallback
}

var frequencyLabel = map[string]string{"daily": "daily", "every3days": "every-3-days", "weekly": "weekly"}

type view struct {
	Input
	Snapshot
	FirstName  string
	Motivation string
	Subject    string
	FreqLabel  string
	ReviewURL  string
}

// Compose builds the email.
func Compose(in Input) (mail.Message, error) {
	s := Summarize(in)
	v := view{
		Input:      in,
		Snapshot:   s,
		FirstName:  firstName(in.Name, "there"),
		Motivation: Motivation(s, in),
		FreqLabel:  frequencyLabel[in.Frequency],
		ReviewURL:  in.AppURL + "/#review",
	}
	switch {
	case s.Done == 0:
		v.Subject = fmt.Sprintf("%s: your first question is waiting", in.SiteName)
	case s.Due > 0:
		v.Subject = fmt.Sprintf("%s: %d/%d done · %d due for review", in.SiteName, s.Done, s.Total, s.Due)
	default:
		v.Subject = fmt.Sprintf("%s: %d/%d done (%d%%)", in.SiteName, s.Done, s.Total, s.Percent)
	}
	var text, html bytes.Buffer
	if err := textTemplate.Execute(&text, v); err != nil {
		return mail.Message{}, err
	}
	if err := htmlTemplate.Execute(&html, v); err != nil {
		return mail.Message{}, err
	}
	return mail.Message{
		To:      in.Email,
		Subject: v.Subject,
		Text:    text.String(),
		HTML:    html.String(),
		Headers: map[string]string{
			// RFC 8058 one-click unsubscribe, which Gmail and Yahoo expect from regular senders.
			"List-Unsubscribe":      "<" + in.UnsubscribeURL + ">",
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	}, nil
}

var textTemplate = texttemplate.Must(texttemplate.New("text").Parse(`Hi {{.FirstName}},

{{.Motivation}}

Your progress: {{.Done}} of {{.Total}} questions ({{.Percent}}%){{if .RoundsFinished}}, {{.RoundsFinished}} rounds finished{{end}}.
{{- if .Due}}
Due for review: {{.Due}} ({{.ReviewURL}})
{{- end}}
{{- range .InProgress}}
- {{.Title}}: {{.Done}}/{{.Total}}
{{- end}}
{{if .Next}}
Up next: {{.Next.Title}} ({{.Next.RoundTitle}})
{{.Next.URL}}
{{else}}
Open the app: {{.AppURL}}
{{end}}
--
You get this {{.FreqLabel}} reminder because you switched on email reminders in {{.SiteName}} Settings.
Change how often, or switch them off, in Settings. Unsubscribe: {{.UnsubscribeURL}}
`))

var htmlTemplate = htmltemplate.Must(htmltemplate.New("html").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{.Subject}}</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#161b2e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dde1ea;border-radius:14px;">
<tr><td style="padding:28px 28px 8px;">
  <p style="margin:0 0 18px;font-size:15px;font-weight:700;color:#3346d3;">{{.SiteName}}</p>
  <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">Hi {{.FirstName}},</h1>
  <p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:#464e66;">{{.Motivation}}</p>
</td></tr>
<tr><td style="padding:0 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eceff5;border-radius:10px;">
  <tr><td style="padding:16px 18px;">
    <p style="margin:0 0 4px;font-size:13px;color:#6f7690;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Your progress</p>
    <p style="margin:0 0 10px;font-size:26px;font-weight:800;">{{.Done}} / {{.Total}} <span style="font-size:15px;font-weight:600;color:#464e66;">questions · {{.Percent}}%</span></p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="height:8px;background:#dde1ea;border-radius:4px;"><tr>
      {{if .Percent}}<td width="{{.Percent}}%" style="background:#1d7f55;border-radius:4px;height:8px;font-size:0;line-height:0;">&nbsp;</td>{{end}}
      <td style="font-size:0;line-height:0;">&nbsp;</td>
    </tr></table>
    <p style="margin:12px 0 0;font-size:14px;color:#464e66;">
      {{if .RoundsFinished}}{{.RoundsFinished}} rounds finished · {{end}}{{if .Due}}<a href="{{.ReviewURL}}" style="color:#a35f00;font-weight:700;">{{.Due}} due for review</a>{{else}}Nothing due for review{{end}}
    </p>
    {{if .InProgress}}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;font-size:14px;color:#464e66;">
      {{range .InProgress}}<tr><td style="padding:3px 0;">{{.Title}}</td><td align="right" style="padding:3px 0;font-weight:700;">{{.Done}}/{{.Total}}</td></tr>{{end}}
    </table>{{end}}
  </td></tr></table>
</td></tr>
<tr><td style="padding:22px 28px 8px;">
  {{if .Next}}<p style="margin:0 0 6px;font-size:13px;color:#6f7690;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Up next</p>
  <p style="margin:0 0 4px;font-size:17px;font-weight:700;line-height:1.4;">{{.Next.Title}}</p>
  <p style="margin:0 0 18px;font-size:14px;color:#6f7690;">{{.Next.RoundTitle}}</p>
  <a href="{{.Next.URL}}" style="display:inline-block;background:#3346d3;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;">Continue studying</a>
  {{else}}<a href="{{.AppURL}}" style="display:inline-block;background:#3346d3;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;">Open {{.SiteName}}</a>{{end}}
</td></tr>
<tr><td style="padding:22px 28px 26px;font-size:12px;line-height:1.5;color:#6f7690;">
  You get this {{.FreqLabel}} reminder because you switched on email reminders in {{.SiteName}} Settings.
  Change how often in Settings, or <a href="{{.UnsubscribeURL}}" style="color:#6f7690;">unsubscribe</a>.
</td></tr>
</table>
</td></tr></table>
</body></html>
`))
