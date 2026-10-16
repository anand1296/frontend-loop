// Package markdown turns answer Markdown into the exact HTML shape the
// frontend styles: callouts, code figures with a copy button, wrapped tables,
// safe links. It is the Go twin of build/content/markdown.ts (marked +
// highlight.js) and follows the same security rules:
//
//   - raw HTML in Markdown is escaped and shown as text, never passed through;
//   - links are kept only for http(s), "#fragment" and same-origin "/path";
//   - images render as their alt text;
//   - code is tokenized and emitted as escaped <span class="hljs-…"> runs,
//     so the stylesheet written for highlight.js styles both renderers.
//
// The output is therefore safe to inject with dangerouslySetInnerHTML even
// though it now comes from an admin-editable database instead of the repo.
package markdown

import (
	"bytes"
	"errors"
	"fmt"
	"html"
	"regexp"
	"sort"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Callouts maps the GitHub-alert style marker (> [!TIP]) to its visible label.
var Callouts = map[string]string{
	"TLDR":      "The 60-second answer",
	"NOTE":      "Note",
	"TIP":       "Tip",
	"WARNING":   "Common mistake",
	"IMPORTANT": "Important",
	"PRINCIPAL": "Principal-level depth",
}

// CalloutKinds returns the known callout markers in a stable order (for error messages and docs).
func CalloutKinds() []string {
	kinds := make([]string, 0, len(Callouts))
	for kind := range Callouts {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	return kinds
}

// Error is a content problem an author can fix (unknown fence language, unknown callout).
type Error struct{ Message string }

func (e *Error) Error() string { return e.Message }

// IsContentError reports whether err is an author-fixable content problem.
func IsContentError(err error) bool {
	var target *Error
	return errors.As(err, &target)
}

// Result is one rendered answer.
type Result struct {
	HTML string
	// Summary is the plain text of the first [!TLDR] callout ("" when missing).
	Summary string
	// Text is the plain text of the whole answer except code, used for search.
	Text string
}

// Renderer is safe for concurrent use; build one and share it.
type Renderer struct {
	md goldmark.Markdown
}

// New builds the renderer. GFM gives tables, strikethrough, autolinks and task lists, like marked's gfm mode.
func New() *Renderer {
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithParserOptions(
			parser.WithASTTransformers(util.Prioritized(calloutTransformer{}, 100)),
		),
		goldmark.WithRendererOptions(
			renderer.WithNodeRenderers(util.Prioritized(&nodeRenderer{}, 0)),
		),
	)
	return &Renderer{md: md}
}

var calloutErrorsKey = parser.NewContextKey()

// Render converts one answer. Content errors are returned as *Error.
func (r *Renderer) Render(source string) (Result, error) {
	src := []byte(strings.ReplaceAll(source, "\r\n", "\n"))
	ctx := parser.NewContext()
	doc := r.md.Parser().Parse(text.NewReader(src), parser.WithContext(ctx))
	if problems, ok := ctx.Get(calloutErrorsKey).([]string); ok && len(problems) > 0 {
		return Result{}, &Error{Message: problems[0]}
	}
	var buf bytes.Buffer
	if err := r.md.Renderer().Render(&buf, src, doc); err != nil {
		return Result{}, err
	}
	return Result{
		HTML:    buf.String(),
		Summary: summaryOf(doc, src),
		Text:    plainText(doc, src),
	}, nil
}

/* ---------------------------------------------------------------- callouts */

// KindCallout is the AST node a "> [!KIND]" blockquote becomes.
var KindCallout = ast.NewNodeKind("Callout")

// Callout is a blockquote that starts with a [!KIND] marker.
type Callout struct {
	ast.BaseBlock
	Callout string
}

func (n *Callout) Kind() ast.NodeKind { return KindCallout }

func (n *Callout) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"Callout": n.Callout}, nil)
}

var markerPattern = regexp.MustCompile(`^\[!([A-Z]+)\]`)

type calloutTransformer struct{}

// Transform rewrites "> [!KIND] …" blockquotes into Callout nodes and strips the marker text.
func (calloutTransformer) Transform(doc *ast.Document, reader text.Reader, pc parser.Context) {
	source := reader.Source()
	var quotes []*ast.Blockquote
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if q, ok := n.(*ast.Blockquote); ok && entering {
			quotes = append(quotes, q)
		}
		return ast.WalkContinue, nil
	})
	for _, quote := range quotes {
		paragraph, ok := quote.FirstChild().(*ast.Paragraph)
		if !ok {
			continue
		}
		match := markerPattern.FindSubmatch(leadingText(paragraph, source))
		if match == nil {
			continue
		}
		kind := string(match[1])
		if _, known := Callouts[kind]; !known {
			problems, _ := pc.Get(calloutErrorsKey).([]string)
			pc.Set(calloutErrorsKey, append(problems, fmt.Sprintf("unknown callout [!%s]. Known: %s", kind, strings.Join(CalloutKinds(), ", "))))
			continue
		}
		if !stripPrefix(paragraph, source, len(match[0])) {
			continue
		}
		callout := &Callout{Callout: kind}
		parent := quote.Parent()
		parent.ReplaceChild(parent, quote, callout)
		for child := quote.FirstChild(); child != nil; {
			next := child.NextSibling()
			callout.AppendChild(callout, child)
			child = next
		}
		if paragraph.ChildCount() == 0 {
			callout.RemoveChild(callout, paragraph)
		}
	}
}

// leadingText concatenates the paragraph's leading Text nodes (the marker may be split across several).
func leadingText(paragraph *ast.Paragraph, source []byte) []byte {
	var out []byte
	for child := paragraph.FirstChild(); child != nil && len(out) < 32; child = child.NextSibling() {
		t, ok := child.(*ast.Text)
		if !ok {
			break
		}
		out = append(out, t.Segment.Value(source)...)
		if t.SoftLineBreak() || t.HardLineBreak() {
			break
		}
	}
	return out
}

// stripPrefix removes n bytes of leading text plus following whitespace, across Text nodes.
func stripPrefix(paragraph *ast.Paragraph, source []byte, n int) bool {
	remaining := n
	child := paragraph.FirstChild()
	for remaining > 0 && child != nil {
		t, ok := child.(*ast.Text)
		if !ok {
			return false
		}
		next := child.NextSibling()
		length := t.Segment.Len()
		if length <= remaining {
			remaining -= length
			paragraph.RemoveChild(paragraph, t)
		} else {
			t.Segment = t.Segment.WithStart(t.Segment.Start + remaining)
			remaining = 0
		}
		child = next
	}
	// Like marked's /\[!X\]\s*/: drop whitespace that followed the marker.
	if first, ok := paragraph.FirstChild().(*ast.Text); ok {
		value := first.Segment.Value(source)
		trimmed := bytes.TrimLeft(value, " \t")
		first.Segment = first.Segment.WithStart(first.Segment.Start + (len(value) - len(trimmed)))
		if first.Segment.Len() == 0 && !first.SoftLineBreak() && !first.HardLineBreak() {
			paragraph.RemoveChild(paragraph, first)
		}
	}
	return true
}

/* ---------------------------------------------------------------- renderer */

type nodeRenderer struct{}

func (r *nodeRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(KindCallout, r.callout)
	reg.Register(ast.KindFencedCodeBlock, r.fencedCode)
	reg.Register(ast.KindCodeBlock, r.indentedCode)
	reg.Register(ast.KindHTMLBlock, r.htmlBlock)
	reg.Register(ast.KindRawHTML, r.rawHTML)
	reg.Register(ast.KindLink, r.link)
	reg.Register(ast.KindAutoLink, r.autoLink)
	reg.Register(ast.KindImage, r.image)
	reg.Register(east.KindTable, r.table)
}

func (r *nodeRenderer) callout(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	n := node.(*Callout)
	if entering {
		kind := strings.ToLower(n.Callout)
		fmt.Fprintf(w, `<aside class="callout callout-%s"><p class="callout-label">%s</p>`, kind, html.EscapeString(Callouts[n.Callout]))
	} else {
		_, _ = w.WriteString("</aside>\n")
	}
	return ast.WalkContinue, nil
}

func codeText(node ast.Node, source []byte) string {
	var b strings.Builder
	lines := node.Lines()
	for i := 0; i < lines.Len(); i++ {
		segment := lines.At(i)
		b.Write(segment.Value(source))
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func (r *nodeRenderer) fencedCode(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkSkipChildren, nil
	}
	n := node.(*ast.FencedCodeBlock)
	lang := ""
	if n.Info != nil {
		if fields := strings.Fields(string(n.Info.Segment.Value(source))); len(fields) > 0 {
			lang = strings.ToLower(fields[0])
		}
	}
	return ast.WalkSkipChildren, writeCode(w, lang, codeText(n, source))
}

func (r *nodeRenderer) indentedCode(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkSkipChildren, nil
	}
	return ast.WalkSkipChildren, writeCode(w, "", codeText(node, source))
}

func writeCode(w util.BufWriter, lang, code string) error {
	def, ok := Languages[lang]
	if !ok {
		return &Error{Message: fmt.Sprintf("unsupported code fence language %q. Supported: %s", lang, strings.Join(LanguageNames(), ", "))}
	}
	body, err := highlight(def, code)
	if err != nil {
		return err
	}
	fmt.Fprintf(w, `<figure class="code"><figcaption><span>%s</span>`, def.Label)
	_, _ = w.WriteString(`<button type="button" class="copy-code" data-copy-code>Copy</button></figcaption>`)
	_, _ = w.WriteString(`<pre><code class="hljs">`)
	_, _ = w.WriteString(body)
	_, _ = w.WriteString("</code></pre></figure>\n")
	return nil
}

// Raw HTML is never trusted, even from our own content: it is shown as text.
func (r *nodeRenderer) htmlBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkSkipChildren, nil
	}
	n := node.(*ast.HTMLBlock)
	lines := n.Lines()
	for i := 0; i < lines.Len(); i++ {
		segment := lines.At(i)
		_, _ = w.WriteString(html.EscapeString(string(segment.Value(source))))
	}
	if n.HasClosure() {
		_, _ = w.WriteString(html.EscapeString(string(n.ClosureLine.Value(source))))
	}
	return ast.WalkSkipChildren, nil
}

func (r *nodeRenderer) rawHTML(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkSkipChildren, nil
	}
	n := node.(*ast.RawHTML)
	for i := 0; i < n.Segments.Len(); i++ {
		segment := n.Segments.At(i)
		_, _ = w.WriteString(html.EscapeString(string(segment.Value(source))))
	}
	return ast.WalkSkipChildren, nil
}

var safeHref = regexp.MustCompile(`(?i)^(https?://|#|/(?:[^/]|$))`)

// SafeHref reports whether a link target may be rendered as a link.
func SafeHref(href string) bool { return safeHref.MatchString(href) }

func openLink(w util.BufWriter, href, title string) {
	fmt.Fprintf(w, `<a href="%s"`, html.EscapeString(href))
	if title != "" {
		fmt.Fprintf(w, ` title="%s"`, html.EscapeString(title))
	}
	if strings.HasPrefix(strings.ToLower(href), "http") {
		_, _ = w.WriteString(` target="_blank" rel="noopener noreferrer"`)
	}
	_ = w.WriteByte('>')
}

func (r *nodeRenderer) link(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	n := node.(*ast.Link)
	href := string(n.Destination)
	if !SafeHref(href) {
		return ast.WalkContinue, nil // render the link text only
	}
	if entering {
		openLink(w, href, string(n.Title))
	} else {
		_, _ = w.WriteString("</a>")
	}
	return ast.WalkContinue, nil
}

func (r *nodeRenderer) autoLink(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	n := node.(*ast.AutoLink)
	label := string(n.Label(source))
	href := string(n.URL(source))
	if n.AutoLinkType == ast.AutoLinkEmail {
		_, _ = w.WriteString(html.EscapeString(label))
		return ast.WalkContinue, nil
	}
	if !strings.Contains(href, "://") {
		href = "http://" + href // GFM "www." autolinks
	}
	if !SafeHref(href) {
		_, _ = w.WriteString(html.EscapeString(label))
		return ast.WalkContinue, nil
	}
	openLink(w, href, "")
	_, _ = w.WriteString(html.EscapeString(label))
	_, _ = w.WriteString("</a>")
	return ast.WalkContinue, nil
}

func (r *nodeRenderer) image(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if entering {
		_, _ = w.WriteString(html.EscapeString(inlineText(node, source)))
	}
	return ast.WalkSkipChildren, nil
}

func (r *nodeRenderer) table(w util.BufWriter, _ []byte, _ ast.Node, entering bool) (ast.WalkStatus, error) {
	if entering {
		_, _ = w.WriteString(`<div class="table-wrap"><table>` + "\n")
	} else {
		_, _ = w.WriteString("</table></div>\n")
	}
	return ast.WalkContinue, nil
}

/* ---------------------------------------------------------------- plain text */

func inlineText(node ast.Node, source []byte) string {
	var b strings.Builder
	_ = ast.Walk(node, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch t := n.(type) {
		case *ast.Text:
			b.Write(t.Segment.Value(source))
			if t.SoftLineBreak() || t.HardLineBreak() {
				b.WriteByte(' ')
			}
		case *ast.String:
			b.Write(t.Value)
		case *ast.AutoLink:
			b.Write(t.Label(source))
		case *ast.RawHTML:
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return b.String()
}

var spaces = regexp.MustCompile(`\s+`)

func collapse(s string) string { return strings.TrimSpace(spaces.ReplaceAllString(s, " ")) }

func summaryOf(doc ast.Node, source []byte) string {
	var summary string
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if c, ok := n.(*Callout); ok && entering && c.Callout == "TLDR" {
			summary = collapse(blockText(c, source))
			return ast.WalkStop, nil
		}
		return ast.WalkContinue, nil
	})
	return summary
}

// blockText joins the text of every block under node, skipping code and raw HTML.
func blockText(node ast.Node, source []byte) string {
	var parts []string
	_ = ast.Walk(node, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n.Kind() {
		case ast.KindFencedCodeBlock, ast.KindCodeBlock, ast.KindHTMLBlock:
			return ast.WalkSkipChildren, nil
		case ast.KindParagraph, ast.KindHeading, ast.KindTextBlock, east.KindTableCell:
			parts = append(parts, inlineText(n, source))
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return strings.Join(parts, " ")
}

func plainText(doc ast.Node, source []byte) string { return collapse(blockText(doc, source)) }
