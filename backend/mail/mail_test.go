package mail

import (
	"context"
	"net"
	"net/textproto"
	"strings"
	"testing"
	"time"
)

func TestBuildMultipartMessage(t *testing.T) {
	raw, err := Build("Whetstone <loop@example.com>", Message{
		To:      "Priya <priya@example.com>",
		Subject: "Your check-in: 42/110 done ✓",
		Text:    "Hello\nworld",
		HTML:    "<p>Hello</p>",
		Headers: map[string]string{"List-Unsubscribe": "<https://app/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
	}, time.Date(2026, 10, 17, 3, 30, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	for _, want := range []string{
		"From: \"Whetstone\" <loop@example.com>\r\n",
		"To: \"Priya\" <priya@example.com>\r\n",
		"Subject: =?utf-8?q?",
		"List-Unsubscribe: <https://app/u>\r\n",
		"Content-Type: multipart/alternative;",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Type: text/html; charset=utf-8",
		"Message-ID: <",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %q in:\n%s", want, s)
		}
	}
}

func TestBuildRejectsHeaderInjection(t *testing.T) {
	raw, err := Build("loop@example.com", Message{To: "a@example.com", Subject: "Hi\r\nBcc: victim@example.com", Text: "x"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "\r\nBcc:") {
		t.Fatal("CRLF in a header value must not start a new header")
	}
	if _, err := Build("loop@example.com", Message{To: "not an address", Text: "x"}, time.Now()); err == nil {
		t.Fatal("expected an error for a bad recipient")
	}
}

func TestUnconfiguredSMTP(t *testing.T) {
	var s *SMTP
	if s.Configured() {
		t.Fatal("nil SMTP must not be configured")
	}
	if (&SMTP{Host: "smtp.example.com"}).Configured() {
		t.Fatal("From is required")
	}
}

// fakeSMTP is a minimal SMTP server (no TLS, no auth) that records one message.
func fakeSMTP(t *testing.T) (port int, received chan string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	received = make(chan string, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		tp := textproto.NewConn(conn)
		_ = tp.PrintfLine("220 fake ESMTP")
		var data strings.Builder
		for {
			line, err := tp.ReadLine()
			if err != nil {
				return
			}
			cmd := strings.ToUpper(strings.SplitN(line, " ", 2)[0])
			switch {
			case cmd == "EHLO" || cmd == "HELO":
				_ = tp.PrintfLine("250-fake\r\n250 SIZE 1000000")
			case cmd == "DATA":
				_ = tp.PrintfLine("354 go ahead")
				lines, _ := tp.ReadDotLines()
				data.WriteString(strings.Join(lines, "\n"))
				_ = tp.PrintfLine("250 queued")
				received <- data.String()
			case cmd == "QUIT":
				_ = tp.PrintfLine("221 bye")
				return
			default:
				_ = tp.PrintfLine("250 ok")
			}
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, received
}

func TestSMTPSendEndToEnd(t *testing.T) {
	port, received := fakeSMTP(t)
	s := &SMTP{Host: "127.0.0.1", Port: port, From: "Loop <loop@example.com>"}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Send(ctx, Message{To: "a@example.com", Subject: "Hello", Text: "Plain body", HTML: "<p>HTML body</p>"}); err != nil {
		t.Fatal(err)
	}
	got := <-received
	if !strings.Contains(got, "Subject: Hello") || !strings.Contains(got, "Plain body") || !strings.Contains(got, "<p>HTML body</p>") {
		t.Fatalf("unexpected DATA:\n%s", got)
	}
}
