package playbackgrant

import (
	"errors"
	"testing"
	"time"
)

func TestGrantLifecycleAndBinding(t *testing.T) {
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	m := New(Options{ActivationTTL: time.Minute, IdleTTL: time.Hour, Now: func() time.Time { return now }})
	token, err := m.Issue("Movies/example.mkv")
	if err != nil || token == "" {
		t.Fatalf("Issue() = %q, %v", token, err)
	}
	if _, err := m.Acquire(token, "Movies/other.mkv"); !errors.Is(err, ErrMismatch) {
		t.Fatalf("wrong binding error = %v", err)
	}
	release, err := m.Acquire(token, "Movies/example.mkv")
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(6 * time.Hour)
	secondRelease, err := m.AcquireAny(token)
	if err != nil {
		t.Fatalf("active long request should keep grant alive: %v", err)
	}
	secondRelease()
	release()
	now = now.Add(59 * time.Minute)
	release, err = m.Acquire(token, "Movies/example.mkv")
	if err != nil {
		t.Fatalf("request should refresh idle timeout: %v", err)
	}
	release()
	now = now.Add(time.Hour + time.Nanosecond)
	if _, err := m.AcquireAny(token); !errors.Is(err, ErrExpired) {
		t.Fatalf("idle grant error = %v", err)
	}
}

func TestUnactivatedGrantExpiresAndCapacityIsBounded(t *testing.T) {
	now := time.Now()
	m := New(Options{ActivationTTL: time.Minute, IdleTTL: time.Hour, Capacity: 1, Now: func() time.Time { return now }})
	token, err := m.Issue("one")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Issue("two"); !errors.Is(err, ErrCapacity) {
		t.Fatalf("capacity error = %v", err)
	}
	now = now.Add(time.Minute + time.Nanosecond)
	if _, err := m.AcquireAny(token); !errors.Is(err, ErrExpired) {
		t.Fatalf("activation expiry = %v", err)
	}
	if _, err := m.Issue("two"); err != nil {
		t.Fatalf("expired entry should free capacity: %v", err)
	}
}
