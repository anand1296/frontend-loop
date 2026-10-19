package markdown

import (
	"strings"
	"testing"
)

func render(t *testing.T, src string) Result {
	t.Helper()
	res, err := New().Render(src)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestCallouts(t *testing.T) {
	cases := map[string]string{
		"marker on its own line": "> [!TIP]\n> Say the trade-off out loud.",
		"marker inline":          "> [!TIP] Say the trade-off out loud.",
		"blank line after":       "> [!TIP]\n>\n> Say the trade-off out loud.",
	}
	for name, src := range cases {
		html := render(t, src).HTML
		want := `<aside class="callout callout-tip"><p class="callout-label">Tip</p><p>Say the trade-off out loud.</p>` + "\n</aside>\n"
		if html != want {
			t.Errorf("%s:\n got %q\nwant %q", name, html, want)
		}
	}
	if html := render(t, "> [!note] lower case is a plain quote").HTML; !strings.HasPrefix(html, "<blockquote>") {
		t.Errorf("lower-case marker should stay a blockquote: %s", html)
	}
	if _, err := New().Render("> [!DANGER]\n> x"); err == nil || !IsContentError(err) {
		t.Errorf("unknown callout should be a content error, got %v", err)
	}
}

func TestPromptCallout(t *testing.T) {
	res := render(t, "> [!PROMPT]\n> Build a **thing**.\n>\n> **Test cases**\n> - `a()` returns 1\n> - `b()` throws\n\n> [!TLDR]\n> Short answer.")
	if !strings.HasPrefix(res.HTML, `<aside class="callout callout-prompt"><p class="callout-label">The full question</p>`) {
		t.Errorf("prompt should be first: %s", res.HTML)
	}
	if !strings.Contains(res.HTML, "<li><code>a()</code> returns 1</li>") {
		t.Errorf("prompt lists should render: %s", res.HTML)
	}
	if res.Summary != "Short answer." {
		t.Errorf("summary must come from the TLDR, got %q", res.Summary)
	}
}

func TestSummaryAndText(t *testing.T) {
	res := render(t, "> [!TLDR]\n> Use `useMemo` for **expensive** work, see [docs](https://react.dev).\n\n### More\n\nBody text.\n\n```ts\nconst hidden = 1;\n```")
	if res.Summary != "Use useMemo for expensive work, see docs." {
		t.Errorf("summary: %q", res.Summary)
	}
	if strings.Contains(res.Text, "hidden") || !strings.Contains(res.Text, "Body text.") {
		t.Errorf("search text should skip code: %q", res.Text)
	}
}

func TestSafety(t *testing.T) {
	html := render(t, "<div onclick=x>hi</div>\n\nA <em>raw</em> [bad](javascript:alert(1)) [rel](/x) [proto](//evil.example) ![pic](https://x/y.png)").HTML
	for _, bad := range []string{"<div", "<em>", "javascript:", `href="//evil`, "<img"} {
		if strings.Contains(html, bad) {
			t.Errorf("unsafe %q in %s", bad, html)
		}
	}
	if !strings.Contains(html, `<a href="/x">rel</a>`) {
		t.Errorf("same-origin links should survive: %s", html)
	}
}

func TestCodeFigure(t *testing.T) {
	html := render(t, "```tsx\nconst el = <a href=\"x\">{'<'}</a>;\n```").HTML
	if !strings.HasPrefix(html, `<figure class="code"><figcaption><span>TSX</span><button type="button" class="copy-code" data-copy-code>Copy</button></figcaption><pre><code class="hljs">`) {
		t.Errorf("figure shape: %s", html)
	}
	if strings.Contains(html, "<a href") || !strings.HasSuffix(html, "</code></pre></figure>\n") {
		t.Errorf("code must be escaped and trimmed: %s", html)
	}
	if strings.Contains(html, "\n</code>") {
		t.Errorf("trailing newline should be trimmed: %q", html)
	}
}

// Every fence language must have a working lexer (backend rounds use Go, SQL, Terraform...).
func TestEveryLanguageHighlights(t *testing.T) {
	r := New()
	for name := range Languages {
		if name == "" {
			continue
		}
		res, err := r.Render("```" + name + "\nx := 1 // a\n```")
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if !strings.Contains(res.HTML, "<figure class=\"code\">") {
			t.Errorf("%s: no code figure", name)
		}
	}
}

func TestFrameworkContainers(t *testing.T) {
	html := render(t, "Shared.\n\n:::angular\n### Angular\n\n```ts\nconst x = 1;\n```\n:::\n\n:::vue\nVue only.\n:::\n").HTML
	for _, want := range []string{
		"<section class=\"fw\" data-fw=\"angular\">\n<h3>Angular</h3>",
		"<section class=\"fw\" data-fw=\"vue\">\n<p>Vue only.</p>\n</section>",
		"<p>Shared.</p>",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %q in %s", want, html)
		}
	}
	if strings.Count(html, "<section") != 2 || strings.Count(html, "</section>") != 2 {
		t.Errorf("section balance: %s", html)
	}
	if got := render(t, "```text\n:::angular\n```\n").HTML; strings.Contains(got, "<section") {
		t.Errorf("::: inside a fence must stay text: %s", got)
	}
}

func TestFrameworkContainerErrors(t *testing.T) {
	r := New()
	for source, want := range map[string]string{
		":::svelte\ntext\n:::":          "unknown framework",
		":::vue\ntext":                  "never closed",
		":::":                            "closes nothing",
		":::vue\n:::react\ntext\n:::\n:::": "cannot nest",
	} {
		_, err := r.Render(source)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: got %v, want %q", source, err, want)
		}
	}
}
