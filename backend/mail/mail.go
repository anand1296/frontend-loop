// Package mail sends email over SMTP with nothing but the standard library.
//
// SMTP is the lowest common denominator: the same code works with a Gmail
// account (app password), Resend, Brevo, Postmark, SES or a local MailHog, so
// switching providers is a configuration change, not a code change.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Message is one email with a plain-text and an HTML part.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
	// Headers are extra headers, e.g. List-Unsubscribe.
	Headers map[string]string
}

// Sender delivers messages.
type Sender interface {
	Send(ctx context.Context, m Message) error
	Configured() bool
}

// SMTP sends through an SMTP server. Port 465 uses implicit TLS; any other
// port uses STARTTLS, which is mandatory whenever credentials are sent
// (unauthenticated local catchers like Mailpit may skip it).
type SMTP struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string // "Frontend Loop <you@example.com>"
}

// Configured reports whether enough settings are present to try sending.
func (s *SMTP) Configured() bool { return s != nil && s.Host != "" && s.From != "" }

// ErrNotConfigured is returned when sending without configuration.
var ErrNotConfigured = errors.New("email is not configured on this server")

func clean(s string) string { return strings.NewReplacer("\r", "", "\n", "").Replace(s) }

// Build renders the full RFC 5322 message (multipart/alternative). Exported for tests.
func Build(from string, m Message, now time.Time) ([]byte, error) {
	fromAddr, err := mail.ParseAddress(from)
	if err != nil {
		return nil, fmt.Errorf("mail: bad From %q: %w", from, err)
	}
	toAddr, err := mail.ParseAddress(clean(m.To))
	if err != nil {
		return nil, fmt.Errorf("mail: bad To: %w", err)
	}
	boundary := randomHex(12)
	var b bytes.Buffer
	header := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, clean(v)) }
	header("From", fromAddr.String())
	header("To", toAddr.String())
	header("Subject", mime.QEncoding.Encode("utf-8", clean(m.Subject)))
	header("Date", now.Format(time.RFC1123Z))
	domain := fromAddr.Address[strings.LastIndex(fromAddr.Address, "@")+1:]
	header("Message-ID", fmt.Sprintf("<%s@%s>", randomHex(16), domain))
	header("MIME-Version", "1.0")
	keys := make([]string, 0, len(m.Headers))
	for k := range m.Headers {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		header(clean(k), m.Headers[k])
	}
	header("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	b.WriteString("\r\n")
	part := func(contentType, body string) error {
		fmt.Fprintf(&b, "--%s\r\nContent-Type: %s; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", boundary, contentType)
		w := quotedprintable.NewWriter(&b)
		if _, err := w.Write([]byte(strings.ReplaceAll(body, "\n", "\r\n"))); err != nil {
			return err
		}
		if err := w.Close(); err != nil {
			return err
		}
		b.WriteString("\r\n")
		return nil
	}
	if err := part("text/plain", m.Text); err != nil {
		return nil, err
	}
	if m.HTML != "" {
		if err := part("text/html", m.HTML); err != nil {
			return nil, err
		}
	}
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return b.Bytes(), nil
}

func randomHex(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

// Send delivers one message, honoring the context deadline.
func (s *SMTP) Send(ctx context.Context, m Message) error {
	if !s.Configured() {
		return ErrNotConfigured
	}
	raw, err := Build(s.From, m, time.Now())
	if err != nil {
		return err
	}
	fromAddr, _ := mail.ParseAddress(s.From)
	toAddr, _ := mail.ParseAddress(clean(m.To))

	port := s.Port
	if port == 0 {
		port = 587
	}
	addr := net.JoinHostPort(s.Host, strconv.Itoa(port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	if port == 465 {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12})
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("mail: connect %s: %w", addr, err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	}
	c, err := smtp.NewClient(conn, s.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("mail: handshake: %w", err)
	}
	defer c.Close()
	local := s.Host == "localhost" || s.Host == "127.0.0.1"
	if port != 465 {
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(&tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12}); err != nil {
				return fmt.Errorf("mail: starttls: %w", err)
			}
		} else if !local && s.Username != "" {
			return errors.New("mail: server does not offer STARTTLS; refusing to send credentials in clear text")
		}
	}
	if s.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", s.Username, s.Password, s.Host)); err != nil {
			return fmt.Errorf("mail: auth: %w", err)
		}
	}
	if err := c.Mail(fromAddr.Address); err != nil {
		return fmt.Errorf("mail: MAIL FROM: %w", err)
	}
	if err := c.Rcpt(toAddr.Address); err != nil {
		return fmt.Errorf("mail: RCPT TO: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("mail: DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return fmt.Errorf("mail: write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("mail: send: %w", err)
	}
	return c.Quit()
}

// Recorder keeps messages in memory instead of sending them (tests, local demos).
type Recorder struct {
	mu   sync.Mutex
	Sent []Message
	// Fail makes Send return this error.
	Fail error
}

func (r *Recorder) Configured() bool { return true }

func (r *Recorder) Send(_ context.Context, m Message) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.Fail != nil {
		return r.Fail
	}
	r.Sent = append(r.Sent, m)
	return nil
}

// Messages returns a copy of what was sent.
func (r *Recorder) Messages() []Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Message(nil), r.Sent...)
}
