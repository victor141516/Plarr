package transcode

import (
	"strings"
	"time"
	"unicode"
)

const maxPlaybackDiagnosticSessions = 64

type StrategyAttempt struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

type PlaybackStrategyDiagnostics struct {
	Rendition string            `json:"rendition,omitempty"`
	Height    int               `json:"height,omitempty"`
	Color     ColorMode         `json:"color,omitempty"`
	SourceHDR bool              `json:"sourceHDR"`
	Attempts  []StrategyAttempt `json:"attempts"`
	Selected  string            `json:"selected,omitempty"`
}

type playbackStrategyTrace struct {
	key       string
	updatedAt time.Time
	value     PlaybackStrategyDiagnostics
}

func (m *Manager) beginVideoDiagnostics(session, key, rendition string, height int, color ColorMode, sourceHDR bool) {
	if session == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.strategyDiagnostics == nil {
		m.strategyDiagnostics = map[string]*playbackStrategyTrace{}
	}
	if existing := m.strategyDiagnostics[session]; existing != nil && existing.key == key {
		existing.updatedAt = time.Now()
		return
	}
	if len(m.strategyDiagnostics) >= maxPlaybackDiagnosticSessions {
		oldestSession := ""
		var oldest time.Time
		for candidate, trace := range m.strategyDiagnostics {
			if oldestSession == "" || trace.updatedAt.Before(oldest) {
				oldestSession = candidate
				oldest = trace.updatedAt
			}
		}
		delete(m.strategyDiagnostics, oldestSession)
	}
	m.strategyDiagnostics[session] = &playbackStrategyTrace{
		key:       key,
		updatedAt: time.Now(),
		value: PlaybackStrategyDiagnostics{
			Rendition: rendition,
			Height:    height,
			Color:     color,
			SourceHDR: sourceHDR,
			Attempts:  []StrategyAttempt{},
		},
	}
}

func (m *Manager) recordVideoStrategy(session, key, name, status, failure string) {
	if session == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	trace := m.strategyDiagnostics[session]
	if trace == nil || trace.key != key {
		return
	}
	trace.updatedAt = time.Now()
	trace.value.Attempts = append(trace.value.Attempts, StrategyAttempt{
		Name:   name,
		Status: status,
		Error:  failure,
	})
}

func (m *Manager) updateVideoStrategy(session, key, name, status, failure string, selected bool) {
	if session == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	trace := m.strategyDiagnostics[session]
	if trace == nil || trace.key != key {
		return
	}
	trace.updatedAt = time.Now()
	for index := len(trace.value.Attempts) - 1; index >= 0; index-- {
		attempt := &trace.value.Attempts[index]
		if attempt.Name == name && (attempt.Status == "running" || attempt.Status == "active") {
			attempt.Status = status
			attempt.Error = failure
			if selected {
				trace.value.Selected = name
			}
			return
		}
	}
}

func (m *Manager) markVideoStrategyActive(session, key string) {
	if session == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	trace := m.strategyDiagnostics[session]
	if trace == nil || trace.key != key {
		return
	}
	for index := len(trace.value.Attempts) - 1; index >= 0; index-- {
		attempt := &trace.value.Attempts[index]
		if attempt.Status == "running" || attempt.Status == "active" {
			attempt.Status = "active"
			trace.value.Selected = attempt.Name
			trace.updatedAt = time.Now()
			return
		}
	}
}

func (m *Manager) markVideoCacheSelected(session, key string) {
	if session == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	trace := m.strategyDiagnostics[session]
	if trace == nil || trace.key != key || trace.value.Selected == "hls-cache" {
		return
	}
	trace.value.Attempts = append(trace.value.Attempts, StrategyAttempt{
		Name:   "hls-cache",
		Status: "succeeded",
	})
	trace.value.Selected = "hls-cache"
	trace.updatedAt = time.Now()
}

func (m *Manager) StrategyDiagnostics(session string) PlaybackStrategyDiagnostics {
	m.mu.Lock()
	defer m.mu.Unlock()
	trace := m.strategyDiagnostics[session]
	if trace == nil {
		return PlaybackStrategyDiagnostics{Attempts: []StrategyAttempt{}}
	}
	result := trace.value
	result.Attempts = append([]StrategyAttempt(nil), trace.value.Attempts...)
	return result
}

func strategyErrorSummary(err error) string {
	if err == nil {
		return ""
	}
	raw := strings.ReplaceAll(err.Error(), "\r", "\n")
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(strings.Map(func(r rune) rune {
			if unicode.IsControl(r) {
				return -1
			}
			return r
		}, line))
		if line == "" {
			continue
		}
		const prefix = "FFmpeg failed: "
		line = strings.TrimPrefix(line, prefix)
		if len(line) > 240 {
			line = line[:237] + "..."
		}
		return line
	}
	return "Conversion process failed."
}
