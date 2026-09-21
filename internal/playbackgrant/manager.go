package playbackgrant

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"sync"
	"time"
)

var (
	ErrMissing  = errors.New("missing playback grant")
	ErrInvalid  = errors.New("invalid playback grant")
	ErrExpired  = errors.New("expired playback grant")
	ErrMismatch = errors.New("playback grant is bound to another media file")
	ErrCapacity = errors.New("playback grant capacity reached")
)

type Options struct {
	ActivationTTL time.Duration
	IdleTTL       time.Duration
	Capacity      int
	Now           func() time.Time
}

type grant struct {
	binding        string
	issuedAt       time.Time
	lastActivityAt time.Time
	activated      bool
	activeRequests int
}

// Manager stores only hashes of bearer grants. A request lease keeps a grant
// active for the full lifetime of a long-running response; after the final
// request ends, the idle timeout starts again.
type Manager struct {
	mu            sync.Mutex
	grants        map[[32]byte]*grant
	activationTTL time.Duration
	idleTTL       time.Duration
	capacity      int
	now           func() time.Time
}

func New(options Options) *Manager {
	if options.ActivationTTL <= 0 {
		options.ActivationTTL = time.Minute
	}
	if options.IdleTTL <= 0 {
		options.IdleTTL = time.Hour
	}
	if options.Capacity <= 0 {
		options.Capacity = 10_000
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	return &Manager{
		grants:        make(map[[32]byte]*grant),
		activationTTL: options.ActivationTTL,
		idleTTL:       options.IdleTTL,
		capacity:      options.Capacity,
		now:           options.Now,
	}
}

func (m *Manager) Issue(binding string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupLocked(m.now())
	if len(m.grants) >= m.capacity {
		return "", ErrCapacity
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	m.grants[sha256.Sum256([]byte(token))] = &grant{binding: binding, issuedAt: m.now()}
	return token, nil
}

// Acquire validates and touches a media-bound grant. The returned release
// function must be called exactly once after the request has finished.
func (m *Manager) Acquire(token, binding string) (func(), error) {
	return m.acquire(token, binding, true)
}

// AcquireAny validates a grant for a playback-session request that is not
// itself addressed by media id.
func (m *Manager) AcquireAny(token string) (func(), error) {
	return m.acquire(token, "", false)
}

func (m *Manager) acquire(token, binding string, enforceBinding bool) (func(), error) {
	if token == "" {
		return nil, ErrMissing
	}
	hash := sha256.Sum256([]byte(token))
	now := m.now()
	m.mu.Lock()
	g, ok := m.grants[hash]
	if !ok {
		m.mu.Unlock()
		return nil, ErrInvalid
	}
	if (!g.activated && now.Sub(g.issuedAt) > m.activationTTL) ||
		(g.activated && g.activeRequests == 0 && now.Sub(g.lastActivityAt) > m.idleTTL) {
		delete(m.grants, hash)
		m.mu.Unlock()
		return nil, ErrExpired
	}
	if enforceBinding && g.binding != binding {
		m.mu.Unlock()
		return nil, ErrMismatch
	}
	g.activated = true
	g.lastActivityAt = now
	g.activeRequests++
	m.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			m.mu.Lock()
			if current := m.grants[hash]; current != nil {
				if current.activeRequests > 0 {
					current.activeRequests--
				}
				current.lastActivityAt = m.now()
			}
			m.mu.Unlock()
		})
	}, nil
}

func (m *Manager) cleanupLocked(now time.Time) {
	for hash, g := range m.grants {
		if (!g.activated && now.Sub(g.issuedAt) > m.activationTTL) ||
			(g.activated && g.activeRequests == 0 && now.Sub(g.lastActivityAt) > m.idleTTL) {
			delete(m.grants, hash)
		}
	}
}
