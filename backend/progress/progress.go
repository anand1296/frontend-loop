// Package progress is the Go port of src/state/progress.ts: the learner's
// progress document, validated on the way in and merged with the same
// per-question last-writer-wins rule the browser uses. Because the merge is
// commutative and idempotent, client and server can apply it in any order and
// converge on the same document.
package progress

import (
	"encoding/json"
	"errors"
	"math"
	"unicode/utf8"
)

// Limits keep one learner's document bounded (a few hundred KB at most).
const (
	NotesLimit   = 2000
	MaxQuestions = 5000
	MaxIDLength  = 120
)

// Question is one question's progress. Field names match the TypeScript model.
type Question struct {
	Done      bool     `json:"done"`
	DoneAt    *float64 `json:"doneAt"`
	Stage     int      `json:"stage"`
	DueAt     *float64 `json:"dueAt"`
	Notes     string   `json:"notes"`
	UpdatedAt float64  `json:"updatedAt"`
}

// LastVisit is where the learner was last.
type LastVisit struct {
	SectionID  string  `json:"sectionId"`
	QuestionID *string `json:"questionId"`
	At         float64 `json:"at"`
}

// Doc is a whole progress document.
type Doc struct {
	Version   int                 `json:"version"`
	Questions map[string]Question `json:"questions"`
	LastVisit *LastVisit          `json:"lastVisit"`
}

// Empty returns a document with no progress.
func Empty() Doc { return Doc{Version: 1, Questions: map[string]Question{}} }

// ErrInvalid means the input is not a progress document at all.
var ErrInvalid = errors.New("progress: not a version 1 progress document")

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func finitePtr(v any) *float64 {
	f, ok := v.(float64)
	if !ok || !finite(f) {
		return nil
	}
	return &f
}

func clipNotes(s string) string {
	if utf8.RuneCountInString(s) <= NotesLimit {
		return s
	}
	runes := []rune(s)
	return string(runes[:NotesLimit])
}

// Parse validates untrusted JSON the way parseProgress does in the browser:
// a wrong envelope is an error, invalid entries are dropped, values are clamped.
func Parse(raw []byte) (Doc, error) {
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return Doc{}, ErrInvalid
	}
	return FromMap(envelope)
}

// FromMap validates an already-decoded document.
func FromMap(envelope map[string]any) (Doc, error) {
	if version, _ := envelope["version"].(float64); version != 1 {
		return Doc{}, ErrInvalid
	}
	questions, ok := envelope["questions"].(map[string]any)
	if !ok {
		return Doc{}, ErrInvalid
	}
	doc := Empty()
	for id, value := range questions {
		if len(doc.Questions) >= MaxQuestions {
			break
		}
		if id == "" || len(id) > MaxIDLength {
			continue
		}
		entry, ok := value.(map[string]any)
		if !ok {
			continue
		}
		done, okDone := entry["done"].(bool)
		updatedAt, okUpdated := entry["updatedAt"].(float64)
		if !okDone || !okUpdated || !finite(updatedAt) {
			continue
		}
		stage := 0
		if s, ok := entry["stage"].(float64); ok && s >= 0 && s < 1000 {
			stage = int(math.Floor(s))
		}
		notes, _ := entry["notes"].(string)
		doc.Questions[id] = Question{
			Done:      done,
			DoneAt:    finitePtr(entry["doneAt"]),
			Stage:     stage,
			DueAt:     finitePtr(entry["dueAt"]),
			Notes:     clipNotes(notes),
			UpdatedAt: updatedAt,
		}
	}
	if visit, ok := envelope["lastVisit"].(map[string]any); ok {
		section, okSection := visit["sectionId"].(string)
		at, okAt := visit["at"].(float64)
		if okSection && okAt && finite(at) && len(section) <= MaxIDLength {
			lv := &LastVisit{SectionID: section, At: at}
			if q, ok := visit["questionId"].(string); ok && len(q) <= MaxIDLength {
				lv.QuestionID = &q
			}
			doc.LastVisit = lv
		}
	}
	return doc, nil
}

// Merge combines two replicas: per question the newest updatedAt wins, ties keep a.
func Merge(a, b Doc) Doc {
	out := Empty()
	for id, q := range a.Questions {
		out.Questions[id] = q
	}
	for id, incoming := range b.Questions {
		if existing, ok := out.Questions[id]; !ok || incoming.UpdatedAt > existing.UpdatedAt {
			if !ok && len(out.Questions) >= MaxQuestions {
				continue
			}
			out.Questions[id] = incoming
		}
	}
	out.LastVisit = a.LastVisit
	if b.LastVisit != nil && (out.LastVisit == nil || b.LastVisit.At > out.LastVisit.At) {
		out.LastVisit = b.LastVisit
	}
	return out
}

// SectionOutline is the minimum a summary needs to know about the content.
type SectionOutline struct {
	ID          string
	QuestionIDs []string
}

// Summary is what admins see per learner. Notes and per-question data are never included.
type Summary struct {
	DoneCount     int            `json:"doneCount"`
	Total         int            `json:"total"`
	ByRound       map[string]int `json:"byRound"`
	DueCount      int            `json:"dueCount"`
	LastActiveAt  float64        `json:"lastActiveAt"`
	LastSectionID *string        `json:"lastSectionId"`
}

// Summarize counts progress against the current content. nowMs decides which reviews are due.
func Summarize(doc Doc, outline []SectionOutline, nowMs float64) Summary {
	s := Summary{ByRound: map[string]int{}}
	for _, section := range outline {
		done := 0
		for _, id := range section.QuestionIDs {
			s.Total++
			q, ok := doc.Questions[id]
			if !ok || !q.Done {
				continue
			}
			done++
			if q.DueAt != nil && *q.DueAt <= nowMs {
				s.DueCount++
			}
		}
		s.ByRound[section.ID] = done
		s.DoneCount += done
	}
	if doc.LastVisit != nil {
		s.LastActiveAt = doc.LastVisit.At
		section := doc.LastVisit.SectionID
		s.LastSectionID = &section
	}
	for _, q := range doc.Questions {
		s.LastActiveAt = math.Max(s.LastActiveAt, q.UpdatedAt)
	}
	return s
}
