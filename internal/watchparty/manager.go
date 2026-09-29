package watchparty

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"math"
	"sync"
	"time"
)

var ErrNotFound = errors.New("watch party not found")

type Event struct {
	Type       string  `json:"type"`
	Position   float64 `json:"position"`
	Rate       float64 `json:"rate"`
	ClientTime float64 `json:"clientTime"`
}

type State struct {
	Type         string  `json:"type"`
	Position     float64 `json:"position"`
	Playing      bool    `json:"playing"`
	Intent       bool    `json:"intent"`
	Rate         float64 `json:"rate"`
	Participants int     `json:"participants"`
	Buffering    int     `json:"buffering"`
	Revision     uint64  `json:"revision"`
	ServerTime   int64   `json:"serverTime"`
	ObservedSkew float64 `json:"observedSkew"`
	Action       string  `json:"action,omitempty"`
}

type participant struct {
	send      chan State
	buffering bool
	boosting  bool
	position  float64
	reported  time.Time
}
type room struct {
	media    string
	position float64
	rate     float64
	playing  bool
	updated  time.Time
	revision uint64
	action   string
	peers    map[*participant]struct{}
	emptyAt  time.Time
}
type Manager struct {
	mu    sync.Mutex
	rooms map[string]*room
	now   func() time.Time
}

func New() *Manager { return &Manager{rooms: make(map[string]*room), now: time.Now} }

func (m *Manager) Create(media string) (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	id := base64.RawURLEncoding.EncodeToString(b)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanup()
	m.rooms[id] = &room{media: media, rate: 1, playing: true, updated: m.now(), peers: make(map[*participant]struct{}), emptyAt: m.now()}
	return id, nil
}

func (m *Manager) Media(id string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanup()
	if r := m.rooms[id]; r != nil {
		return r.media, nil
	}
	return "", ErrNotFound
}

func (m *Manager) Snapshot(id string) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.rooms[id]
	if r == nil {
		return State{}, ErrNotFound
	}
	r.advance(m.now())
	buffers := 0
	for p := range r.peers {
		if p.buffering {
			buffers++
		}
	}
	now := m.now()
	return State{Type: "state", Position: r.position, Playing: r.effective(), Intent: r.playing, Rate: r.speed(), Participants: len(r.peers), Buffering: buffers, Revision: r.revision, ServerTime: now.UnixMilli(), ObservedSkew: r.observedSkew(now), Action: r.action}, nil
}

func (m *Manager) cleanup() {
	for id, room := range m.rooms {
		if len(room.peers) == 0 && m.now().Sub(room.emptyAt) > time.Hour {
			delete(m.rooms, id)
		}
	}
}

func (m *Manager) Join(id string) (string, <-chan State, func(), func(Event), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanup()
	r := m.rooms[id]
	if r == nil {
		return "", nil, nil, nil, ErrNotFound
	}
	p := &participant{send: make(chan State, 16), buffering: true}
	r.advance(m.now())
	r.peers[p] = struct{}{}
	r.revision++
	r.action = "join"
	r.publish(m.now())
	leave := func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if _, ok := r.peers[p]; !ok {
			return
		}
		r.advance(m.now())
		delete(r.peers, p)
		close(p.send)
		r.revision++
		r.action = "leave"
		if len(r.peers) == 0 {
			r.emptyAt = m.now()
		}
		r.publish(m.now())
	}
	action := func(e Event) {
		m.mu.Lock()
		defer m.mu.Unlock()
		if _, ok := r.peers[p]; !ok {
			return
		}
		r.advance(m.now())
		if r.apply(p, e, m.now()) {
			r.revision++
			r.action = e.Type
			r.publish(m.now())
		}
	}
	return r.media, p.send, leave, action, nil
}

func (r *room) effective() bool {
	if len(r.peers) == 0 {
		return false
	}
	active := r.playing
	for p := range r.peers {
		if p.boosting {
			active = true
		}
	}
	if !active {
		return false
	}
	for p := range r.peers {
		if p.buffering {
			return false
		}
	}
	return true
}
func (r *room) speed() float64 {
	for p := range r.peers {
		if p.boosting {
			return 2
		}
	}
	return r.rate
}
func (r *room) advance(now time.Time) {
	if r.effective() {
		r.position += now.Sub(r.updated).Seconds() * r.speed()
	}
	r.updated = now
}
func (r *room) apply(p *participant, e Event, now time.Time) bool {
	switch e.Type {
	case "play":
		r.playing = true
	case "pause":
		// The initiating browser knows its actual media position more precisely
		// than the room clock, especially while a command is in flight.
		if e.ClientTime > 0 && finite(e.Position) && e.Position >= 0 && math.Abs(e.Position-r.position) <= 5 {
			r.position = e.Position
		}
		r.playing = false
	case "seek":
		if !finite(e.Position) || e.Position < 0 {
			return false
		}
		r.position = e.Position
	case "rate":
		if !finite(e.Rate) || e.Rate < 0.25 || e.Rate > 3 {
			return false
		}
		r.rate = e.Rate
	case "boost-start":
		p.boosting = true
	case "boost-end":
		p.boosting = false
	case "buffering":
		p.buffering = true
	case "ready":
		p.buffering = false
	case "report":
		if !finite(e.Position) || e.Position < 0 {
			return false
		}
		p.position = e.Position
		p.reported = now
		return false
	default:
		return false
	}
	return true
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func (r *room) observedSkew(now time.Time) float64 {
	var maxSkew float64
	for p := range r.peers {
		if p.reported.IsZero() || p.buffering || now.Sub(p.reported) > 4*time.Second {
			continue
		}
		position := p.position
		if r.effective() {
			position += now.Sub(p.reported).Seconds() * r.speed()
		}
		maxSkew = math.Max(maxSkew, math.Abs(position-r.position))
	}
	return maxSkew
}

func (r *room) publish(now time.Time) {
	buffers := 0
	for p := range r.peers {
		if p.buffering {
			buffers++
		}
	}
	state := State{Type: "state", Position: r.position, Playing: r.effective(), Intent: r.playing, Rate: r.speed(), Participants: len(r.peers), Buffering: buffers, Revision: r.revision, ServerTime: now.UnixMilli(), ObservedSkew: r.observedSkew(now), Action: r.action}
	for p := range r.peers {
		select {
		case p.send <- state:
		default:
			select {
			case <-p.send:
			default:
			}
			select {
			case p.send <- state:
			default:
			}
		}
	}
}
