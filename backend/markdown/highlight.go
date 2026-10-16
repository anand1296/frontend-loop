package markdown

import (
	"fmt"
	"html"
	"sort"
	"strings"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"
)

// Language describes one supported code fence language.
type Language struct {
	// Lexer is the chroma lexer name; "" means plain, escaped text.
	Lexer string
	Label string
}

// Languages mirrors the LANGUAGES table in build/content/markdown.ts. Keep them in sync:
// a fence the static build accepts must also be accepted here, and vice versa.
var Languages = map[string]Language{
	"ts":         {"typescript", "TypeScript"},
	"typescript": {"typescript", "TypeScript"},
	"tsx":        {"tsx", "TSX"},
	"js":         {"javascript", "JavaScript"},
	"javascript": {"javascript", "JavaScript"},
	"jsx":        {"react", "JSX"},
	"html":       {"html", "HTML"},
	"xml":        {"xml", "XML"},
	"css":        {"css", "CSS"},
	"bash":       {"bash", "Shell"},
	"sh":         {"bash", "Shell"},
	"shell":      {"bash", "Shell"},
	"json":       {"json", "JSON"},
	"diff":       {"diff", "Diff"},
	"yaml":       {"yaml", "YAML"},
	"yml":        {"yaml", "YAML"},
	"graphql":    {"graphql", "GraphQL"},
	// Backend, cloud and data (for full-stack rounds).
	"go":         {"go", "Go"},
	"golang":     {"go", "Go"},
	"sql":        {"sql", "SQL"},
	"python":     {"python", "Python"},
	"py":         {"python", "Python"},
	"dockerfile": {"docker", "Dockerfile"},
	"docker":     {"docker", "Dockerfile"},
	"proto":      {"protobuf", "Protobuf"},
	"protobuf":   {"protobuf", "Protobuf"},
	"toml":       {"toml", "TOML"},
	"ini":        {"ini", "INI"},
	"hcl":        {"terraform", "Terraform"},
	"terraform":  {"terraform", "Terraform"},
	"tf":         {"terraform", "Terraform"},
	"http":       {"", "HTTP"},
	"text":       {"", "Text"},
	"txt":        {"", "Text"},
	"":           {"", "Text"},
}

// LanguageNames lists the accepted fence names.
func LanguageNames() []string {
	names := make([]string, 0, len(Languages))
	for name := range Languages {
		if name != "" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

// hljsClass maps chroma token types onto the highlight.js class names the
// stylesheet already themes (src/styles/prose.css). The most specific match wins.
func hljsClass(t chroma.TokenType) string {
	switch t {
	case chroma.KeywordConstant:
		return "hljs-literal"
	case chroma.KeywordType:
		return "hljs-type"
	case chroma.NameBuiltin:
		return "hljs-built_in"
	case chroma.NameBuiltinPseudo:
		return "hljs-variable language_"
	case chroma.NameFunction, chroma.NameFunctionMagic:
		return "hljs-title function_"
	case chroma.NameClass:
		return "hljs-title class_"
	case chroma.NameTag:
		return "hljs-name"
	case chroma.NameAttribute:
		return "hljs-attr"
	case chroma.NameVariable, chroma.NameVariableGlobal, chroma.NameVariableInstance, chroma.NameVariableClass:
		return "hljs-variable"
	case chroma.NameConstant:
		return "hljs-variable constant_"
	case chroma.NameProperty:
		return "hljs-property"
	case chroma.NameDecorator, chroma.CommentPreproc, chroma.CommentPreprocFile, chroma.CommentHashbang:
		return "hljs-meta"
	case chroma.NameEntity:
		return "hljs-symbol"
	case chroma.LiteralStringRegex:
		return "hljs-regexp"
	case chroma.LiteralStringInterpol:
		return "hljs-subst"
	case chroma.GenericInserted:
		return "hljs-addition"
	case chroma.GenericDeleted:
		return "hljs-deletion"
	case chroma.GenericHeading, chroma.GenericSubheading:
		return "hljs-meta"
	}
	switch {
	case t.InCategory(chroma.Keyword):
		return "hljs-keyword"
	case t.InCategory(chroma.Comment):
		return "hljs-comment"
	case t.InSubCategory(chroma.LiteralString):
		return "hljs-string"
	case t.InSubCategory(chroma.LiteralNumber):
		return "hljs-number"
	}
	return ""
}

func highlight(def Language, code string) (string, error) {
	if def.Lexer == "" {
		return html.EscapeString(code), nil
	}
	lexer := lexers.Get(def.Lexer)
	if lexer == nil {
		return "", fmt.Errorf("markdown: chroma has no lexer %q", def.Lexer)
	}
	iterator, err := chroma.Coalesce(lexer).Tokenise(nil, code)
	if err != nil {
		return "", fmt.Errorf("markdown: tokenise %s: %w", def.Lexer, err)
	}
	tokens := iterator.Tokens()
	// chroma guarantees a trailing newline; the static renderer emits none.
	if !strings.HasSuffix(code, "\n") {
		for i := len(tokens) - 1; i >= 0; i-- {
			if strings.HasSuffix(tokens[i].Value, "\n") {
				tokens[i].Value = strings.TrimSuffix(tokens[i].Value, "\n")
				break
			}
			if tokens[i].Value != "" {
				break
			}
		}
	}
	var b strings.Builder
	for _, token := range tokens {
		value := html.EscapeString(token.Value)
		if class := hljsClass(token.Type); class != "" && strings.TrimSpace(token.Value) != "" {
			fmt.Fprintf(&b, `<span class="%s">%s</span>`, class, value)
		} else {
			b.WriteString(value)
		}
	}
	return b.String(), nil
}
