package server

// Integration tests: real HTTP against a real Postgres.
//
//	TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/frontend_loop_test?sslmode=disable go test ./backend/...
//
// Each test gets a freshly migrated, seeded schema. Skipped when TEST_DATABASE_URL is unset.

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/anand1296/frontend-loop/backend/auth"
	"github.com/anand1296/frontend-loop/backend/catalog"
	"github.com/anand1296/frontend-loop/backend/mail"
	"github.com/anand1296/frontend-loop/backend/store"
)

const goodBody = "> [!TLDR]\n> A complete sixty second answer that says the important thing clearly and briefly.\n\n" +
	"### Details\n\nSome more explanation that makes the answer long enough to pass the published bar. " +
	"It has a code sample too.\n\n```ts\nconst answer: number = 42;\n```\n"

func fixtureRepo() []catalog.Section {
	return []catalog.Section{
		{ID: "basics", Title: "Basics", Description: "First round", Published: true, Questions: []catalog.Question{
			{ID: "first-question", SectionID: "basics", Title: "First?", Level: "senior", Tags: []string{"one"}, Minutes: 5, Body: goodBody, Published: true},
			{ID: "second-question", SectionID: "basics", Title: "Second?", Level: "lead", Tags: []string{"two"}, Minutes: 7, Body: goodBody, Published: true},
		}},
		{ID: "advanced", Title: "Advanced", Description: "Second round", Published: true, Questions: []catalog.Question{
			{ID: "third-question", SectionID: "advanced", Title: "Third?", Level: "principal", Tags: []string{"three"}, Minutes: 9, Body: goodBody, Published: true},
		}},
	}
}

type env struct {
	t     *testing.T
	srv   *httptest.Server
	app   *Server
	store *store.Store
	now   time.Time
}

// newEnv starts a server whose content is public (most tests read as an
// anonymous visitor). newPrivateEnv keeps the members-only default.
func newEnv(t *testing.T, mutate ...func(*Config)) *env {
	t.Helper()
	e := newPrivateEnv(t, mutate...)
	if err := e.store.PutSetting(context.Background(), 0, "site", Site{Name: "Whetstone", Registration: "invite", ContentAccess: "public"}); err != nil {
		t.Fatal(err)
	}
	return e
}

func newPrivateEnv(t *testing.T, mutate ...func(*Config)) *env {
	t.Helper()
	url := testDatabaseURL(t)
	ctx := context.Background()
	st, err := store.Open(ctx, url, 5)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Reset(ctx); err != nil {
		t.Fatal(err)
	}
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	compiler := catalog.NewCompiler()
	repo := fixtureRepo()
	if _, err := st.SeedIfEmpty(ctx, repo, compiler.Check); err != nil {
		t.Fatal(err)
	}
	cfg := Config{OwnerLogin: "owner", DevLogin: true}
	for _, m := range mutate {
		m(&cfg)
	}
	app := New(cfg, st, repo, slog.New(slog.NewTextHandler(testLogOutput(), nil)))
	e := &env{t: t, app: app, store: st, now: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	app.SetClock(func() time.Time { return e.now })
	e.srv = httptest.NewServer(app.Handler())
	t.Cleanup(func() {
		e.srv.Close()
		_ = st.Close()
	})
	return e
}

type client struct {
	e    *env
	http *http.Client
}

func (e *env) anon() *client {
	jar, _ := cookiejar.New(nil)
	return &client{e: e, http: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// login signs in through the dev-login endpoint (DEV_LOGIN=1).
func (e *env) login(login string, invite ...string) *client {
	e.t.Helper()
	c := e.anon()
	body := map[string]string{"login": login}
	if len(invite) > 0 {
		body["invite"] = invite[0]
	}
	if res := c.do("POST", "/api/auth/dev-login", body); res.status != 200 {
		e.t.Fatalf("login %s: %d %s", login, res.status, res.body)
	}
	return c
}

type result struct {
	status int
	body   []byte
	header http.Header
}

func (r result) json(t *testing.T, into any) {
	t.Helper()
	if err := json.Unmarshal(r.body, into); err != nil {
		t.Fatalf("decode %s: %v", r.body, err)
	}
}

func (r result) code() string {
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(r.body, &e)
	return e.Error.Code
}

func (c *client) request(method, path string, body any, headers map[string]string) result {
	c.e.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, c.e.srv.URL+path, reader)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(CSRFHeader, CSRFValue)
	for k, v := range headers {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return result{status: res.StatusCode, body: raw, header: res.Header}
}

func (c *client) do(method, path string, body any) result { return c.request(method, path, body, nil) }

func expect(t *testing.T, r result, status int) {
	t.Helper()
	if r.status != status {
		t.Fatalf("expected %d, got %d: %s", status, r.status, r.body)
	}
}

type bootstrapBody struct {
	User *struct {
		Login string `json:"login"`
		Role  string `json:"role"`
	} `json:"user"`
	Locked   bool            `json:"locked"`
	Features map[string]bool `json:"features"`
	Site     Site            `json:"site"`
	Content  *struct {
		Version  int64 `json:"version"`
		Sections []struct {
			ID        string `json:"id"`
			Published bool   `json:"published"`
			Questions []struct {
				ID        string `json:"id"`
				Published bool   `json:"published"`
				Summary   string `json:"summary"`
			} `json:"questions"`
		} `json:"sections"`
	} `json:"content"`
	Announcement *Announcement `json:"announcement"`
}

func (c *client) bootstrap() bootstrapBody {
	c.e.t.Helper()
	var b bootstrapBody
	r := c.do("GET", "/api/bootstrap", nil)
	expect(c.e.t, r, 200)
	r.json(c.e.t, &b)
	return b
}

func (b bootstrapBody) questionIDs() []string {
	var ids []string
	if b.Content == nil {
		return ids
	}
	for _, s := range b.Content.Sections {
		for _, q := range s.Questions {
			ids = append(ids, q.ID)
		}
	}
	return ids
}

/* ---------------------------------------------------------------- tests */

// A fresh deployment is private: anonymous visitors get the sign-in screen
// (locked, no content), the owner gets in, strangers need an invite.
func TestPrivateByDefault(t *testing.T) {
	e := newPrivateEnv(t)
	anon := e.anon()
	b := anon.bootstrap()
	if !b.Locked || b.Content != nil || b.Site.ContentAccess != "members" || b.Site.Registration != "invite" {
		t.Fatalf("fresh deployment should be members-only and invite-only: %+v", b)
	}
	expect(t, anon.do("GET", "/api/content/sections/basics", nil), 401)
	owner := e.login("owner")
	if b := owner.bootstrap(); b.Locked || b.Content == nil || b.User.Role != "owner" {
		t.Fatalf("owner should read everything: %+v", b)
	}
}

func TestBootstrapAndHealth(t *testing.T) {
	e := newEnv(t)
	anon := e.anon()
	expect(t, anon.do("GET", "/api/health", nil), 200)
	b := anon.bootstrap()
	if b.User != nil || b.Content == nil || len(b.Content.Sections) != 2 || b.Content.Sections[0].Questions[0].Summary == "" {
		t.Fatalf("unexpected anonymous bootstrap: %+v", b)
	}
	if !b.Features["review"] || b.Site.Registration != "invite" {
		t.Fatalf("defaults missing: %+v", b)
	}
	expect(t, anon.do("GET", "/api/nope", nil), 404)
}

func TestOwnerAndInvitePolicy(t *testing.T) {
	e := newEnv(t)
	owner := e.login("owner")
	if b := owner.bootstrap(); b.User == nil || b.User.Role != "owner" {
		t.Fatalf("owner role not applied: %+v", b.User)
	}

	// Strangers can't join an invite-only site.
	r := e.anon().do("POST", "/api/auth/dev-login", map[string]string{"login": "stranger"})
	if r.status != 403 || r.code() != "not_invited" {
		t.Fatalf("expected not_invited, got %d %s", r.status, r.body)
	}

	// A single-use learner invite works once.
	var created struct {
		URL    string `json:"url"`
		Invite struct {
			ID     int64  `json:"id"`
			Status string `json:"status"`
		} `json:"invite"`
	}
	res := owner.do("POST", "/api/admin/invites", map[string]any{"role": "learner", "note": "Priya"})
	expect(t, res, 201)
	res.json(t, &created)
	token := strings.TrimPrefix(created.URL[strings.Index(created.URL, "?invite="):], "?invite=")
	var info map[string]any
	e.anon().do("GET", "/api/invites/"+token, nil).json(t, &info)
	if info["status"] != "active" || info["role"] != "learner" {
		t.Fatalf("invite info: %v", info)
	}
	learner := e.login("priya", token)
	if b := learner.bootstrap(); b.User.Role != "learner" {
		t.Fatalf("expected learner, got %+v", b.User)
	}
	if r := e.anon().do("POST", "/api/auth/dev-login", map[string]string{"login": "second", "invite": token}); r.code() != "not_invited" {
		t.Fatalf("single-use invite reused: %s", r.body)
	}
	e.anon().do("GET", "/api/invites/"+token, nil).json(t, &info)
	if info["status"] != "used" {
		t.Fatalf("expected used, got %v", info)
	}
	// Returning users don't need an invite.
	e.login("priya")

	// Learners can't reach the admin API.
	expect(t, learner.do("GET", "/api/admin/users", nil), 403)
	expect(t, e.anon().do("GET", "/api/admin/users", nil), 401)

	// Admin invites: owner only. An admin can't change roles or touch other admins.
	res = owner.do("POST", "/api/admin/invites", map[string]any{"role": "admin", "maxUses": 1})
	expect(t, res, 201)
	res.json(t, &created)
	adminToken := created.URL[strings.Index(created.URL, "=")+1:]
	admin := e.login("helper", adminToken)
	if b := admin.bootstrap(); b.User.Role != "admin" {
		t.Fatalf("expected admin, got %+v", b.User)
	}
	expect(t, admin.do("POST", "/api/admin/invites", map[string]any{"role": "admin"}), 403)
	expect(t, admin.do("POST", "/api/admin/invites", map[string]any{"role": "learner", "maxUses": 5}), 201)

	var users struct {
		Users []struct {
			ID    int64  `json:"id"`
			Login string `json:"login"`
			Role  string `json:"role"`
		} `json:"users"`
	}
	owner.do("GET", "/api/admin/users", nil).json(t, &users)
	ids := map[string]int64{}
	for _, u := range users.Users {
		ids[u.Login] = u.ID
	}
	expect(t, admin.do("PATCH", fmt.Sprintf("/api/admin/users/%d", ids["priya"]), map[string]any{"role": "admin"}), 403)
	expect(t, admin.do("PATCH", fmt.Sprintf("/api/admin/users/%d", ids["owner"]), map[string]any{"disabled": true}), 403)
	expect(t, owner.do("PATCH", fmt.Sprintf("/api/admin/users/%d", ids["helper"]), map[string]any{"role": "learner"}), 200)
	expect(t, admin.do("GET", "/api/admin/users", nil), 403) // demotion applies to the existing session

	// Disabling signs the user out everywhere and blocks sign-in.
	expect(t, owner.do("PATCH", fmt.Sprintf("/api/admin/users/%d", ids["priya"]), map[string]any{"disabled": true}), 200)
	if b := learner.bootstrap(); b.User != nil {
		t.Fatal("disabled user still signed in")
	}
	if r := e.anon().do("POST", "/api/auth/dev-login", map[string]string{"login": "priya"}); r.code() != "disabled" {
		t.Fatalf("expected disabled, got %s", r.body)
	}

	// Revoked and expired invites stop working.
	res = owner.do("POST", "/api/admin/invites", map[string]any{"maxUses": 10, "expiresInDays": 1})
	res.json(t, &created)
	tok := created.URL[strings.Index(created.URL, "=")+1:]
	expect(t, owner.do("DELETE", fmt.Sprintf("/api/admin/invites/%d", created.Invite.ID), nil), 200)
	if r := e.anon().do("POST", "/api/auth/dev-login", map[string]string{"login": "late", "invite": tok}); r.code() != "not_invited" {
		t.Fatal("revoked invite accepted")
	}
	res = owner.do("POST", "/api/admin/invites", map[string]any{"maxUses": 10, "expiresInDays": 1})
	res.json(t, &created)
	tok = created.URL[strings.Index(created.URL, "=")+1:]
	e.now = e.now.Add(48 * time.Hour)
	if r := e.anon().do("POST", "/api/auth/dev-login", map[string]string{"login": "late", "invite": tok}); r.code() != "not_invited" {
		t.Fatal("expired invite accepted")
	}
}

func TestOpenRegistrationAndMembersOnly(t *testing.T) {
	e := newEnv(t)
	owner := e.login("owner")
	expect(t, owner.do("PUT", "/api/admin/settings/site", Site{Name: "Team Loop", Registration: "open", ContentAccess: "members"}), 200)
	e.now = e.now.Add(time.Minute) // past the settings cache

	anon := e.anon()
	b := anon.bootstrap()
	if !b.Locked || b.Content != nil || b.Site.Name != "Team Loop" {
		t.Fatalf("members-only should lock anonymous readers: %+v", b)
	}
	expect(t, anon.do("GET", "/api/content/sections/basics", nil), 401)
	newcomer := e.login("newcomer") // open registration: no invite needed
	if b := newcomer.bootstrap(); b.Locked || b.Content == nil {
		t.Fatal("members should read content")
	}
	expect(t, newcomer.do("GET", "/api/content/sections/basics", nil), 200)

	// Only the owner changes site settings; admins can flip features and announce.
	expect(t, owner.do("PATCH", fmt.Sprintf("/api/admin/users/%d", userID(t, owner, "newcomer")), map[string]any{"role": "admin"}), 200)
	expect(t, newcomer.do("PUT", "/api/admin/settings/site", Site{Name: "X", Registration: "open", ContentAccess: "public"}), 403)
	expect(t, newcomer.do("PUT", "/api/admin/settings/features", map[string]bool{"notes": false}), 200)
	expect(t, newcomer.do("PUT", "/api/admin/settings/features", map[string]bool{"teleport": true}), 422)
	expect(t, newcomer.do("PUT", "/api/admin/settings/announcement", Announcement{Message: "Mock interviews on Friday", Tone: "success", LinkURL: "javascript:alert(1)"}), 422)
	expect(t, newcomer.do("PUT", "/api/admin/settings/announcement", Announcement{Message: "Mock interviews on Friday", Tone: "success", LinkURL: "#review", LinkLabel: "Review"}), 200)
	e.now = e.now.Add(time.Minute)
	b = newcomer.bootstrap()
	if b.Features["notes"] || !b.Features["review"] || b.Announcement == nil || b.Announcement.Message != "Mock interviews on Friday" {
		t.Fatalf("settings not applied: %+v %+v", b.Features, b.Announcement)
	}
}

func userID(t *testing.T, c *client, login string) int64 {
	t.Helper()
	var users struct {
		Users []struct {
			ID    int64  `json:"id"`
			Login string `json:"login"`
		} `json:"users"`
	}
	c.do("GET", "/api/admin/users", nil).json(t, &users)
	for _, u := range users.Users {
		if u.Login == login {
			return u.ID
		}
	}
	t.Fatalf("no user %s", login)
	return 0
}

type questionRecord struct {
	ID        string   `json:"id"`
	SectionID string   `json:"sectionId"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Tags      []string `json:"tags"`
	Published bool     `json:"published"`
	Revision  int      `json:"revision"`
	UpdatedBy *string  `json:"updatedBy"`
}

func TestContentManagementLifecycle(t *testing.T) {
	e := newEnv(t)
	owner := e.login("owner")
	reader := e.anon()

	// A new round, then a draft question in it: invisible to readers until published.
	expect(t, owner.do("POST", "/api/admin/sections", map[string]any{"id": "web-components", "title": "Web Components", "description": "Custom elements and shadow DOM"}), 201)
	expect(t, owner.do("POST", "/api/admin/sections", map[string]any{"id": "web-components", "title": "Again", "description": "dup"}), 409)
	expect(t, owner.do("POST", "/api/admin/sections", map[string]any{"id": "first-question", "title": "Clash", "description": "ids share one namespace"}), 409)
	r := owner.do("POST", "/api/admin/sections", map[string]any{"id": "Review", "title": "", "description": ""})
	expect(t, r, 422)

	draft := map[string]any{"id": "shadow-dom-basics", "sectionId": "web-components", "title": "What does shadow DOM encapsulate?",
		"level": "senior", "tags": []string{"Shadow DOM", "css"}, "minutes": 10, "body": "Notes to self", "published": false}
	r = owner.do("POST", "/api/admin/questions", draft)
	expect(t, r, 201)
	var rec questionRecord
	r.json(t, &rec)
	if rec.Revision != 1 || rec.Tags[0] != "shadow dom" || rec.UpdatedBy == nil || *rec.UpdatedBy != "owner" {
		t.Fatalf("unexpected record %+v", rec)
	}
	for _, id := range reader.bootstrap().questionIDs() {
		if id == "shadow-dom-basics" {
			t.Fatal("draft visible to readers")
		}
	}
	if ids := owner.bootstrap().questionIDs(); !contains(ids, "shadow-dom-basics") {
		t.Fatal("admins should see drafts in the app")
	}

	// Publishing enforces the full bar, with field-level problems.
	draft["published"] = true
	draft["revision"] = 1
	r = owner.do("PUT", "/api/admin/questions/shadow-dom-basics", draft)
	expect(t, r, 422)
	var problems struct {
		Error struct {
			Problems []catalog.FieldError `json:"problems"`
		} `json:"error"`
	}
	r.json(t, &problems)
	if len(problems.Error.Problems) == 0 || problems.Error.Problems[0].Field != "body" {
		t.Fatalf("expected body problems, got %s", r.body)
	}

	// Preview shows the rendered HTML and the same problems without saving.
	var preview struct {
		HTML     string               `json:"html"`
		Problems []catalog.FieldError `json:"problems"`
	}
	owner.do("POST", "/api/admin/preview", map[string]any{"id": "x", "title": "x", "level": "lead", "tags": []string{"a"}, "minutes": 3, "body": goodBody, "published": true}).json(t, &preview)
	if len(preview.Problems) != 0 || !strings.Contains(preview.HTML, "callout-tldr") {
		t.Fatalf("preview: %+v", preview)
	}

	draft["body"] = goodBody
	r = owner.do("PUT", "/api/admin/questions/shadow-dom-basics", draft)
	expect(t, r, 200)
	r.json(t, &rec)
	if rec.Revision != 2 || !rec.Published {
		t.Fatalf("expected published revision 2, got %+v", rec)
	}
	if !contains(reader.bootstrap().questionIDs(), "shadow-dom-basics") {
		t.Fatal("published question not visible")
	}
	var answers struct {
		Answers map[string]string `json:"answers"`
	}
	reader.do("GET", "/api/content/sections/web-components", nil).json(t, &answers)
	if !strings.Contains(answers.Answers["shadow-dom-basics"], `<span class="hljs-keyword">const</span>`) {
		t.Fatalf("answer html missing: %v", answers.Answers)
	}

	// Optimistic concurrency: a save based on revision 1 is rejected.
	draft["title"] = "Stale edit"
	draft["revision"] = 1
	r = owner.do("PUT", "/api/admin/questions/shadow-dom-basics", draft)
	if r.status != 409 || r.code() != "conflict" {
		t.Fatalf("expected conflict, got %d %s", r.status, r.body)
	}
	// Ids are permanent.
	draft["revision"] = 2
	draft["id"] = "renamed"
	expect(t, owner.do("PUT", "/api/admin/questions/shadow-dom-basics", draft), 422)
	draft["id"] = "shadow-dom-basics"

	// Move it to another round: it lands at the end.
	draft["sectionId"] = "basics"
	draft["title"] = "Moved"
	expect(t, owner.do("PUT", "/api/admin/questions/shadow-dom-basics", draft), 200)
	b := reader.bootstrap()
	if last := b.Content.Sections[0].Questions[len(b.Content.Sections[0].Questions)-1]; last.ID != "shadow-dom-basics" {
		t.Fatalf("moved question should be last in basics, got %s", last.ID)
	}
	// The round left empty disappears for readers but stays for admins.
	for _, s := range b.Content.Sections {
		if s.ID == "web-components" {
			t.Fatal("empty round shown to readers")
		}
	}

	// History: two previous versions, restorable.
	var revisions []store.Revision
	owner.do("GET", "/api/admin/questions/shadow-dom-basics/revisions", nil).json(t, &revisions)
	if len(revisions) != 2 || revisions[0].Revision != 2 || revisions[1].Revision != 1 {
		t.Fatalf("unexpected revisions %+v", revisions)
	}
	r = owner.do("POST", fmt.Sprintf("/api/admin/questions/shadow-dom-basics/revisions/%d/restore", revisions[0].ID), nil)
	expect(t, r, 200)
	r.json(t, &rec)
	if rec.Title != "What does shadow DOM encapsulate?" || rec.Revision != 4 || rec.SectionID != "basics" {
		t.Fatalf("restore: %+v", rec)
	}

	// Reorder: must be a full permutation.
	expect(t, owner.do("PUT", "/api/admin/sections/order", map[string]any{"ids": []string{"advanced", "basics"}}), 400)
	expect(t, owner.do("PUT", "/api/admin/sections/order", map[string]any{"ids": []string{"advanced", "web-components", "basics"}}), 200)
	expect(t, owner.do("PUT", "/api/admin/sections/basics/order", map[string]any{"ids": []string{"shadow-dom-basics", "second-question", "first-question"}}), 200)
	b = reader.bootstrap()
	if b.Content.Sections[0].ID != "advanced" || b.Content.Sections[1].Questions[0].ID != "shadow-dom-basics" {
		t.Fatalf("order not applied: %+v", b.questionIDs())
	}

	// Unpublishing a round hides it (and its questions) from readers.
	expect(t, owner.do("PATCH", "/api/admin/sections/advanced", map[string]any{"published": false}), 200)
	if contains(reader.bootstrap().questionIDs(), "third-question") {
		t.Fatal("unpublished round visible")
	}
	expect(t, reader.do("GET", "/api/content/sections/advanced", nil), 404)

	// Delete → trash → restore (comes back as a draft).
	expect(t, owner.do("DELETE", "/api/admin/questions/first-question", nil), 200)
	var trash []store.DeletedQuestion
	owner.do("GET", "/api/admin/trash", nil).json(t, &trash)
	if len(trash) != 1 || trash[0].QuestionID != "first-question" {
		t.Fatalf("trash: %+v", trash)
	}
	r = owner.do("POST", fmt.Sprintf("/api/admin/questions/first-question/revisions/%d/restore", trash[0].ID), nil)
	expect(t, r, 200)
	r.json(t, &rec)
	if rec.Published {
		t.Fatal("restored-from-trash question should be a draft")
	}

	// Deleting a round snapshots its questions so they can come back.
	expect(t, owner.do("DELETE", "/api/admin/sections/advanced", nil), 200)
	owner.do("GET", "/api/admin/trash", nil).json(t, &trash)
	if len(trash) != 1 || trash[0].QuestionID != "third-question" {
		t.Fatalf("trash after round delete: %+v", trash)
	}
	r = owner.do("POST", fmt.Sprintf("/api/admin/questions/third-question/revisions/%d/restore", trash[0].ID), nil)
	if r.status != 409 || r.code() != "section_missing" {
		t.Fatalf("expected section_missing, got %s", r.body)
	}

	// Audit trail records who did what.
	var audit []store.AuditEntry
	owner.do("GET", "/api/admin/audit", nil).json(t, &audit)
	if len(audit) < 10 || audit[0].Action != "section.deleted" || *audit[0].Actor != "owner" {
		t.Fatalf("audit: %+v", audit[:1])
	}
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func TestAnswersETag(t *testing.T) {
	e := newEnv(t)
	reader := e.anon()
	r := reader.do("GET", "/api/content/sections/basics", nil)
	expect(t, r, 200)
	etag := r.header.Get("ETag")
	expect(t, reader.request("GET", "/api/content/sections/basics", nil, map[string]string{"If-None-Match": etag}), 304)
	// Any content change bumps the version.
	owner := e.login("owner")
	expect(t, owner.do("PATCH", "/api/admin/sections/basics", map[string]any{"title": "Basics 2"}), 200)
	expect(t, reader.request("GET", "/api/content/sections/basics", nil, map[string]string{"If-None-Match": etag}), 200)
}

func TestProgressSyncAndSummaries(t *testing.T) {
	e := newEnv(t)
	owner := e.login("owner")
	var inv struct {
		URL string `json:"url"`
	}
	owner.do("POST", "/api/admin/invites", map[string]any{"maxUses": 2}).json(t, &inv)
	token := inv.URL[strings.Index(inv.URL, "=")+1:]
	laptop := e.login("dev", token)
	phone := e.login("dev")

	expect(t, e.anon().do("GET", "/api/me/progress", nil), 401)
	doc := func(entries map[string]any) map[string]any {
		return map[string]any{"version": 1, "questions": entries, "lastVisit": map[string]any{"sectionId": "basics", "questionId": "first-question", "at": 5}}
	}
	expect(t, laptop.do("PUT", "/api/me/progress", doc(map[string]any{
		"first-question":  map[string]any{"done": true, "doneAt": 1, "stage": 0, "dueAt": 1, "notes": "private", "updatedAt": 10},
		"second-question": map[string]any{"done": true, "doneAt": 1, "stage": 0, "dueAt": 9e15, "notes": "", "updatedAt": 10},
	})), 200)
	// The phone has an older view of first-question and a newer one of second-question.
	r := phone.do("PUT", "/api/me/progress", doc(map[string]any{
		"first-question":  map[string]any{"done": false, "doneAt": nil, "stage": 0, "dueAt": nil, "notes": "", "updatedAt": 5},
		"second-question": map[string]any{"done": false, "doneAt": nil, "stage": 0, "dueAt": nil, "notes": "", "updatedAt": 20},
		"junk":            "ignored",
	}))
	expect(t, r, 200)
	var merged struct {
		Questions map[string]struct {
			Done  bool   `json:"done"`
			Notes string `json:"notes"`
		} `json:"questions"`
	}
	r.json(t, &merged)
	if !merged.Questions["first-question"].Done || merged.Questions["second-question"].Done || len(merged.Questions) != 2 {
		t.Fatalf("merge wrong: %+v", merged)
	}
	expect(t, laptop.do("PUT", "/api/me/progress", map[string]any{"version": 2}), 400)

	var users struct {
		Users []struct {
			Login   string `json:"login"`
			Summary struct {
				DoneCount int            `json:"doneCount"`
				Total     int            `json:"total"`
				DueCount  int            `json:"dueCount"`
				ByRound   map[string]int `json:"byRound"`
			} `json:"summary"`
		} `json:"users"`
	}
	r = owner.do("GET", "/api/admin/users", nil)
	r.json(t, &users)
	if strings.Contains(string(r.body), "private") {
		t.Fatal("notes leaked to admin")
	}
	for _, u := range users.Users {
		if u.Login == "dev" && (u.Summary.DoneCount != 1 || u.Summary.Total != 3 || u.Summary.DueCount != 1 || u.Summary.ByRound["basics"] != 1) {
			t.Fatalf("summary: %+v", u.Summary)
		}
	}

	// Right to erasure.
	expect(t, phone.do("DELETE", "/api/me", nil), 200)
	if b := laptop.bootstrap(); b.User != nil {
		t.Fatal("deleting the account should end every session")
	}
	expect(t, owner.do("DELETE", "/api/me", nil), 403)
}

func TestCSRFGuards(t *testing.T) {
	e := newEnv(t)
	owner := e.login("owner")
	body := map[string]any{"id": "x-round", "title": "X", "description": "x"}
	r := owner.request("POST", "/api/admin/sections", body, map[string]string{CSRFHeader: ""})
	if r.status != 403 || r.code() != "csrf" {
		t.Fatalf("missing header accepted: %d", r.status)
	}
	r = owner.request("POST", "/api/admin/sections", body, map[string]string{"Origin": "https://evil.example"})
	if r.status != 403 {
		t.Fatalf("foreign origin accepted: %d", r.status)
	}
	r = owner.request("POST", "/api/admin/sections", body, map[string]string{"Sec-Fetch-Site": "cross-site"})
	if r.status != 403 {
		t.Fatalf("cross-site fetch accepted: %d", r.status)
	}
	expect(t, owner.request("POST", "/api/admin/sections", body, map[string]string{"Origin": e.srv.URL}), 201)
	// Unknown fields are rejected instead of silently ignored.
	expect(t, owner.do("POST", "/api/admin/sections", map[string]any{"id": "y", "title": "Y", "description": "y", "isAdmin": true}), 400)
}

func TestRepositorySyncAndExport(t *testing.T) {
	e := newEnv(t)
	owner := e.login("owner")
	var plan store.SyncPlan
	owner.do("GET", "/api/admin/sync", nil).json(t, &plan)
	if !plan.Empty() || plan.Unchanged != 3 {
		t.Fatalf("fresh seed should match the repository: %+v", plan)
	}

	// Edit a seeded question in the console and add a console-only one.
	var rec questionRecord
	owner.do("GET", "/api/admin/questions/first-question", nil).json(t, &rec)
	expect(t, owner.do("PUT", "/api/admin/questions/first-question", map[string]any{"sectionId": "basics", "title": "Edited in console",
		"level": "senior", "tags": []string{"one"}, "minutes": 5, "body": goodBody, "published": true, "revision": rec.Revision}), 200)
	expect(t, owner.do("POST", "/api/admin/questions", map[string]any{"id": "console-only", "sectionId": "basics", "title": "Console only",
		"level": "lead", "tags": []string{"x"}, "minutes": 3, "body": goodBody, "published": true}), 201)
	expect(t, owner.do("DELETE", "/api/admin/questions/third-question", nil), 200)

	owner.do("GET", "/api/admin/sync", nil).json(t, &plan)
	if len(plan.ChangedQuestions) != 1 || len(plan.NewQuestions) != 1 || plan.OnlyInDatabase != 1 {
		t.Fatalf("plan: %+v", plan)
	}
	// "Add missing" restores the deleted question but keeps the console edit.
	r := owner.do("POST", "/api/admin/sync", map[string]bool{"overwrite": false})
	expect(t, r, 200)
	owner.do("GET", "/api/admin/questions/first-question", nil).json(t, &rec)
	if rec.Title != "Edited in console" {
		t.Fatal("add-missing must not overwrite edits")
	}
	// "Overwrite" makes repository questions match the files; console-only content stays.
	expect(t, owner.do("POST", "/api/admin/sync", map[string]bool{"overwrite": true}), 200)
	owner.do("GET", "/api/admin/questions/first-question", nil).json(t, &rec)
	if rec.Title != "First?" {
		t.Fatalf("overwrite did not apply: %+v", rec)
	}
	expect(t, owner.do("GET", "/api/admin/questions/console-only", nil), 200)

	// Export: one round as Markdown, everything as a zip of content/*.md.
	r = owner.do("GET", "/api/admin/sections/basics/export", nil)
	expect(t, r, 200)
	sec, err := catalog.ParseFile("export.md", string(r.body))
	if err != nil || len(sec.Questions) != 3 {
		t.Fatalf("export not parseable: %v %+v", err, sec)
	}
	r = owner.do("GET", "/api/admin/export", nil)
	expect(t, r, 200)
	zr, err := zip.NewReader(bytes.NewReader(r.body), int64(len(r.body)))
	if err != nil || len(zr.File) != 2 || zr.File[0].Name != "content/01-basics.md" {
		t.Fatalf("zip: %v", err)
	}
}

func TestGitHubOAuthFlow(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login/oauth/access_token":
			_ = r.ParseForm()
			if r.Form.Get("code") != "good-code" || r.Form.Get("client_secret") != "secret" {
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "bad_verification_code"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "gho_test"})
		case "/user":
			if r.Header.Get("Authorization") != "Bearer gho_test" {
				w.WriteHeader(401)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": 4242, "login": "Owner", "name": "The Owner", "avatar_url": "https://avatars.githubusercontent.com/u/4242"})
		case "/user/emails":
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"email": "old@example.com", "primary": false, "verified": true},
				{"email": "owner@example.com", "primary": true, "verified": true},
			})
		}
	}))
	defer fake.Close()
	e := newEnv(t)
	gh := auth.NewGitHub("client", "secret")
	gh.TokenURL = fake.URL + "/login/oauth/access_token"
	gh.APIURL = fake.URL
	e.app.SetGitHub(gh)

	c := e.anon()
	r := c.do("GET", "/api/auth/github/start?next=%23review", nil)
	expect(t, r, 302)
	loc, _ := url.Parse(r.header.Get("Location"))
	state := loc.Query().Get("state")
	if loc.Host != "github.com" || state == "" || loc.Query().Get("redirect_uri") != e.srv.URL+"/api/auth/github/callback" || loc.Query().Get("scope") != "user:email" {
		t.Fatalf("bad authorize redirect: %s", loc)
	}

	// Wrong state is refused (login CSRF).
	r = c.do("GET", "/api/auth/github/callback?code=good-code&state=forged", nil)
	if !strings.Contains(r.header.Get("Location"), "auth_error=state") {
		t.Fatalf("forged state accepted: %s", r.header.Get("Location"))
	}
	// The state cookie is single-use, so start again.
	r = c.do("GET", "/api/auth/github/start?next=%23review", nil)
	loc, _ = url.Parse(r.header.Get("Location"))
	state = loc.Query().Get("state")
	r = c.do("GET", "/api/auth/github/callback?code=good-code&state="+state, nil)
	expect(t, r, 302)
	if got := r.header.Get("Location"); got != e.srv.URL+"/#review" {
		t.Fatalf("unexpected final redirect %s", got)
	}
	b := c.bootstrap()
	if b.User == nil || b.User.Login != "owner" || b.User.Role != "owner" {
		t.Fatalf("oauth sign-in failed: %+v", b.User)
	}
	var reminders struct {
		Email string `json:"email"`
	}
	c.do("GET", "/api/me/reminders", nil).json(t, &reminders)
	if reminders.Email != "owner@example.com" {
		t.Fatalf("primary verified email not stored: %q", reminders.Email)
	}
	// Open redirects are not possible through next.
	r = c.do("GET", "/api/auth/github/start?next=https://evil.example", nil)
	loc, _ = url.Parse(r.header.Get("Location"))
	r = c.do("GET", "/api/auth/github/callback?code=good-code&state="+loc.Query().Get("state"), nil)
	if got := r.header.Get("Location"); got != e.srv.URL+"/" {
		t.Fatalf("next not sanitized: %s", got)
	}
	expect(t, c.do("POST", "/api/auth/logout", nil), 200)
	if c.bootstrap().User != nil {
		t.Fatal("logout did not end the session")
	}
}

func TestDevLoginDisabledByDefault(t *testing.T) {
	e := newEnv(t, func(c *Config) { c.DevLogin = false })
	expect(t, e.anon().do("POST", "/api/auth/dev-login", map[string]string{"login": "owner"}), 404)
}

func testDatabaseURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping database integration tests")
	}
	return url
}

// A single-use invite raced by many sign-ins must admit exactly one person
// (the invite row is locked with SELECT ... FOR UPDATE inside the sign-in transaction).
func TestSingleUseInviteUnderConcurrency(t *testing.T) {
	e := newEnv(t)
	owner := e.login("owner")
	var inv struct {
		URL string `json:"url"`
	}
	owner.do("POST", "/api/admin/invites", map[string]any{"maxUses": 1}).json(t, &inv)
	token := inv.URL[strings.Index(inv.URL, "=")+1:]

	const racers = 12
	statuses := make(chan int, racers)
	for i := 0; i < racers; i++ {
		go func(i int) {
			raw, _ := json.Marshal(map[string]string{"login": fmt.Sprintf("racer-%d", i), "invite": token})
			req, _ := http.NewRequest("POST", e.srv.URL+"/api/auth/dev-login", bytes.NewReader(raw))
			req.Header.Set(CSRFHeader, CSRFValue)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				statuses <- 0
				return
			}
			res.Body.Close()
			statuses <- res.StatusCode
		}(i)
	}
	ok := 0
	for i := 0; i < racers; i++ {
		if <-statuses == 200 {
			ok++
		}
	}
	if ok != 1 {
		t.Fatalf("expected exactly one successful sign-in, got %d", ok)
	}
}

func TestEmailReminders(t *testing.T) {
	e := newEnv(t, func(c *Config) { c.CronSecret = "cron-secret" })
	outbox := &mail.Recorder{}
	e.app.SetMailer(outbox)

	owner := e.anon()
	expect(t, owner.do("POST", "/api/auth/dev-login", map[string]string{"login": "owner", "email": "owner@example.com"}), 200)
	var inv struct {
		URL string `json:"url"`
	}
	ir := owner.do("POST", "/api/admin/invites", map[string]any{})
	expect(t, ir, 201)
	ir.json(t, &inv)
	learner := e.login("noemail", inv.URL[strings.Index(inv.URL, "=")+1:])

	type prefs struct {
		Enabled         bool   `json:"enabled"`
		Frequency       string `json:"frequency"`
		Email           string `json:"email"`
		EmailConfigured bool   `json:"emailConfigured"`
		Available       bool   `json:"available"`
	}
	var p prefs
	owner.do("GET", "/api/me/reminders", nil).json(t, &p)
	if p.Enabled || p.Frequency != "weekly" || p.Email != "owner@example.com" || !p.EmailConfigured || !p.Available {
		t.Fatalf("defaults: %+v", p)
	}
	// Off by default; can't switch on without a verified address.
	if r := learner.do("PUT", "/api/me/reminders", map[string]any{"enabled": true, "frequency": "daily"}); r.code() != "no_email" {
		t.Fatalf("expected no_email, got %s", r.body)
	}
	expect(t, owner.do("PUT", "/api/me/reminders", map[string]any{"enabled": true, "frequency": "hourly"}), 422)
	expect(t, owner.do("PUT", "/api/me/reminders", map[string]any{"enabled": true, "frequency": "daily"}), 200)
	expect(t, owner.do("PUT", "/api/me/progress", map[string]any{"version": 1, "lastVisit": nil, "questions": map[string]any{
		"first-question": map[string]any{"done": true, "doneAt": 1, "stage": 0, "dueAt": 1, "notes": "", "updatedAt": float64(e.now.UnixMilli())},
	}}), 200)

	cron := func() (status int, body map[string]any) {
		r := e.anon().request("GET", "/api/cron/reminders", nil, map[string]string{"Authorization": "Bearer cron-secret"})
		_ = json.Unmarshal(r.body, &body)
		return r.status, body
	}
	expect(t, e.anon().request("GET", "/api/cron/reminders", nil, map[string]string{"Authorization": "Bearer wrong"}), 401)
	if status, body := cron(); status != 200 || body["sent"] != float64(1) {
		t.Fatalf("first run: %d %v", status, body)
	}
	msgs := outbox.Messages()
	if len(msgs) != 1 || msgs[0].To != "owner@example.com" || !strings.Contains(msgs[0].Subject, "1/3 done · 1 due for review") ||
		!strings.Contains(msgs[0].HTML, e.srv.URL+"/#second-question") {
		t.Fatalf("unexpected email: %+v", msgs)
	}

	// Frequency is respected: nothing more today, one more tomorrow.
	if _, body := cron(); body["claimed"] != float64(0) {
		t.Fatalf("second run the same day must send nothing: %v", body)
	}
	e.now = e.now.Add(21 * time.Hour)
	if _, body := cron(); body["sent"] != float64(1) {
		t.Fatalf("next day: %v", body)
	}

	// A failed send is released and retried on the next run.
	e.now = e.now.Add(21 * time.Hour)
	outbox.Fail = errors.New("smtp down")
	if _, body := cron(); body["failed"] != float64(1) {
		t.Fatalf("failure not reported: %v", body)
	}
	outbox.Fail = nil
	if _, body := cron(); body["sent"] != float64(1) {
		t.Fatalf("retry after failure: %v", body)
	}

	// Test email: available on demand, rate limited.
	expect(t, owner.do("POST", "/api/me/reminders/test", nil), 200)
	expect(t, owner.do("POST", "/api/me/reminders/test", nil), 200)
	expect(t, owner.do("POST", "/api/me/reminders/test", nil), 200)
	expect(t, owner.do("POST", "/api/me/reminders/test", nil), 429)
	if r := learner.do("POST", "/api/me/reminders/test", nil); r.code() != "no_email" {
		t.Fatalf("expected no_email, got %s", r.body)
	}

	// Unsubscribe: GET only asks; POST (no session, no CSRF header) switches off.
	link := outbox.Messages()[0].Headers["List-Unsubscribe"]
	unsub, _ := url.Parse(strings.Trim(link, "<>"))
	path := unsub.Path + "?" + unsub.RawQuery
	r := e.anon().do("GET", path, nil)
	if r.status != 200 || !strings.Contains(string(r.body), "Stop reminder emails?") {
		t.Fatalf("confirm page: %d %s", r.status, r.body)
	}
	owner.do("GET", "/api/me/reminders", nil).json(t, &p)
	if !p.Enabled {
		t.Fatal("GET must not unsubscribe (link scanners)")
	}
	r = e.anon().request("POST", path, nil, map[string]string{CSRFHeader: ""})
	if r.status != 200 || !strings.Contains(string(r.body), "unsubscribed") {
		t.Fatalf("one-click unsubscribe: %d %s", r.status, r.body)
	}
	owner.do("GET", "/api/me/reminders", nil).json(t, &p)
	if p.Enabled {
		t.Fatal("still subscribed")
	}
	expect(t, e.anon().do("GET", "/api/reminders/unsubscribe?token=nope", nil), 404)

	// Emails are private: admins never see them.
	if r := owner.do("GET", "/api/admin/users", nil); strings.Contains(string(r.body), "owner@example.com") {
		t.Fatal("email leaked into the admin people list")
	}

	// The admin switch turns the whole feature off.
	expect(t, owner.do("PUT", "/api/admin/settings/features", map[string]bool{"emailReminders": false}), 200)
	e.now = e.now.Add(time.Minute)
	if r := owner.do("PUT", "/api/me/reminders", map[string]any{"enabled": true, "frequency": "weekly"}); r.code() != "disabled" {
		t.Fatalf("expected disabled, got %s", r.body)
	}
	if _, body := cron(); body["skipped"] == nil {
		t.Fatalf("cron should skip when the feature is off: %v", body)
	}
}

func TestCronNeedsASecret(t *testing.T) {
	e := newEnv(t)
	if r := e.anon().do("GET", "/api/cron/reminders", nil); r.code() != "cron_unconfigured" {
		t.Fatalf("expected cron_unconfigured, got %s", r.body)
	}
}

// testLogOutput shows server logs with TEST_VERBOSE=1 (useful when a 500 needs explaining).
func testLogOutput() io.Writer {
	if os.Getenv("TEST_VERBOSE") != "" {
		return os.Stderr
	}
	return io.Discard
}

func TestQuestionSubmissions(t *testing.T) {
	e := newEnv(t)
	outbox := &mail.Recorder{}
	e.app.SetMailer(outbox)
	owner := e.anon()
	expect(t, owner.do("POST", "/api/auth/dev-login", map[string]string{"login": "owner", "email": "owner@example.com"}), 200)
	var inv struct {
		URL string `json:"url"`
	}
	owner.do("POST", "/api/admin/invites", map[string]any{"maxUses": 1}).json(t, &inv)
	learner := e.anon()
	expect(t, learner.do("POST", "/api/auth/dev-login", map[string]string{"login": "sam", "email": "sam@example.com", "invite": inv.URL[strings.Index(inv.URL, "=")+1:]}), 200)

	proposal := map[string]any{"sectionId": "basics", "title": "How would you debounce a search box?", "level": "senior",
		"tags": []string{"React", "performance"}, "body": goodBody, "context": "Asked in a phone screen", "credit": true}

	// Preview and validation use the same bar as published questions.
	var preview struct {
		HTML     string               `json:"html"`
		Problems []catalog.FieldError `json:"problems"`
	}
	learner.do("POST", "/api/submissions/preview", map[string]any{"sectionId": "basics", "title": "Short", "level": "lead", "tags": []string{"x"}, "body": "too short"}).json(t, &preview)
	if len(preview.Problems) == 0 {
		t.Fatal("preview should report problems for a short answer")
	}
	expect(t, learner.do("POST", "/api/submissions", map[string]any{"title": "No round", "level": "lead", "tags": []string{"x"}, "body": goodBody}), 422)
	r := learner.do("POST", "/api/submissions", proposal)
	expect(t, r, 201)
	var sub struct {
		ID         int64   `json:"id"`
		Status     string  `json:"status"`
		QuestionID *string `json:"questionId"`
		ReviewNote string  `json:"reviewNote"`
	}
	r.json(t, &sub)
	if sub.Status != "pending" {
		t.Fatalf("new submissions are pending: %+v", sub)
	}
	if msgs := outbox.Messages(); len(msgs) != 1 || msgs[0].To != "owner@example.com" || !strings.Contains(msgs[0].Subject, "New question to review") {
		t.Fatalf("owner should be notified: %+v", msgs)
	}
	// Nothing is visible to learners before review; admins see a badge count.
	if contains(learner.bootstrap().questionIDs(), "how-would-you-debounce") {
		t.Fatal("unreviewed submission leaked")
	}
	var boot struct {
		Pending int `json:"pendingSubmissions"`
	}
	owner.do("GET", "/api/bootstrap", nil).json(t, &boot)
	if boot.Pending != 1 {
		t.Fatalf("admin badge: %d", boot.Pending)
	}
	expect(t, learner.do("GET", "/api/admin/submissions", nil), 403)

	// Approve (the reviewer can adjust the question first).
	approve := map[string]any{"note": "Great one", "question": map[string]any{"id": "debounce-search-box", "sectionId": "basics",
		"title": "How would you debounce a search box?", "level": "senior", "tags": []string{"react"}, "minutes": 8, "body": goodBody, "published": true}}
	r = owner.do("POST", fmt.Sprintf("/api/admin/submissions/%d/approve", sub.ID), approve)
	expect(t, r, 200)
	r.json(t, &sub)
	if sub.Status != "approved" || sub.QuestionID == nil || *sub.QuestionID != "debounce-search-box" {
		t.Fatalf("approve: %+v", sub)
	}
	if r := owner.do("POST", fmt.Sprintf("/api/admin/submissions/%d/approve", sub.ID), approve); r.code() != "not_pending" {
		t.Fatalf("double approval must fail: %s", r.body)
	}
	var b struct {
		Content struct {
			Sections []struct {
				Questions []struct {
					ID          string `json:"id"`
					Contributor string `json:"contributor"`
				} `json:"questions"`
			} `json:"sections"`
		} `json:"content"`
	}
	learner.do("GET", "/api/bootstrap", nil).json(t, &b)
	credited := false
	for _, s := range b.Content.Sections {
		for _, q := range s.Questions {
			credited = credited || (q.ID == "debounce-search-box" && q.Contributor == "sam")
		}
	}
	if !credited {
		t.Fatal("approved question should be published and credited to @sam")
	}
	if msgs := outbox.Messages(); len(msgs) != 2 || msgs[1].To != "sam@example.com" || !strings.Contains(msgs[1].HTML, "/#debounce-search-box") {
		t.Fatalf("submitter should hear about the approval: %+v", msgs)
	}

	// Reject with a note; withdraw; rate limits.
	second := map[string]any{"newSectionTitle": "Web Components", "title": "What does shadow DOM isolate?", "level": "lead",
		"tags": []string{"web components"}, "body": goodBody, "credit": false}
	learner.do("POST", "/api/submissions", second).json(t, &sub)
	expect(t, owner.do("POST", fmt.Sprintf("/api/admin/submissions/%d/reject", sub.ID), map[string]string{"note": "Already covered in Browser Platform"}), 200)
	var mine []struct {
		Status     string `json:"status"`
		ReviewNote string `json:"reviewNote"`
	}
	learner.do("GET", "/api/me/submissions", nil).json(t, &mine)
	if len(mine) != 2 || mine[0].Status != "rejected" || mine[0].ReviewNote != "Already covered in Browser Platform" {
		t.Fatalf("my submissions: %+v", mine)
	}
	learner.do("POST", "/api/submissions", second).json(t, &sub)
	expect(t, learner.do("DELETE", fmt.Sprintf("/api/me/submissions/%d", sub.ID), nil), 200)
	expect(t, learner.do("DELETE", fmt.Sprintf("/api/me/submissions/%d", sub.ID), nil), 409)
	expect(t, learner.do("POST", "/api/submissions", second), 201)
	expect(t, learner.do("POST", "/api/submissions", second), 201)
	if r := learner.do("POST", "/api/submissions", second); r.status != 429 {
		t.Fatalf("expected the daily limit after 5 submissions, got %d", r.status)
	}

	// The admin switch closes submissions.
	expect(t, owner.do("PUT", "/api/admin/settings/features", map[string]bool{"contribute": false}), 200)
	e.now = e.now.Add(25 * time.Hour)
	if r := learner.do("POST", "/api/submissions", second); r.code() != "disabled" {
		t.Fatalf("expected disabled, got %s", r.body)
	}
}
