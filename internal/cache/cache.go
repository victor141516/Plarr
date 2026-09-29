package cache

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Manager struct {
	Root     string
	Limit    int64
	mu       sync.Mutex
	evictMu  sync.Mutex
	active   map[string]int
	removing map[string]chan struct{}
	scan     func(string) ([]entry, int64, error)
	remove   func(string) error
}

func New(root string, limit int64) *Manager {
	return &Manager{Root: root, Limit: limit, active: map[string]int{}, scan: scanEntries}
}
func (m *Manager) ClearStartup() error {
	entries, err := os.ReadDir(m.Root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err = os.RemoveAll(filepath.Join(m.Root, e.Name())); err != nil {
			return err
		}
	}
	return nil
}
func (m *Manager) Acquire(key string) func() {
	for {
		m.mu.Lock()
		if done := m.removing[key]; done != nil {
			m.mu.Unlock()
			<-done
			continue
		}
		m.active[key]++
		m.mu.Unlock()
		break
	}
	return func() {
		m.mu.Lock()
		m.active[key]--
		if m.active[key] <= 0 {
			delete(m.active, key)
		}
		m.mu.Unlock()
	}
}

type entry struct {
	path, key string
	size      int64
	time      time.Time
}

func cacheKey(rel string) string {
	clean := filepath.Clean(rel)
	if first, _, found := strings.Cut(clean, string(filepath.Separator)); found {
		return first
	}
	base := filepath.Base(clean)
	if dot := strings.IndexByte(base, '.'); dot > 0 {
		return base[:dot]
	}
	return base
}

func scanEntries(root string) ([]entry, int64, error) {
	var all []entry
	var total int64
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, e error) error {
		if e != nil {
			if errors.Is(e, os.ErrNotExist) {
				return nil
			}
			return e
		}
		if d.IsDir() {
			return nil
		}
		info, e := d.Info()
		if e != nil {
			if errors.Is(e, os.ErrNotExist) {
				return nil
			}
			return e
		}
		rel, _ := filepath.Rel(root, path)
		all = append(all, entry{path, cacheKey(rel), info.Size(), info.ModTime()})
		total += info.Size()
		return nil
	})
	return all, total, err
}

func (m *Manager) Evict() error {
	// Multiple completed jobs may request eviction together. Serialize the scans,
	// but never hold the active-stream mutex while walking the cache: acquiring an
	// HLS playlist or segment must remain effectively instantaneous.
	m.evictMu.Lock()
	defer m.evictMu.Unlock()
	scan := m.scan
	if scan == nil {
		scan = scanEntries
	}
	all, total, err := scan(m.Root)
	if err != nil {
		return err
	}
	if total <= m.Limit {
		return nil
	}
	// An HLS playlist, its init segment, and every media segment are one
	// cache entry. Evicting individual files can leave a valid-looking
	// playlist whose init segment is gone; MSE then rejects the stream.
	type group struct {
		key   string
		files []entry
		time  time.Time
	}
	byKey := make(map[string]*group)
	for _, e := range all {
		g := byKey[e.key]
		if g == nil {
			g = &group{key: e.key}
			byKey[e.key] = g
		}
		g.files = append(g.files, e)
		if e.time.After(g.time) {
			g.time = e.time
		}
	}
	groups := make([]*group, 0, len(byKey))
	for _, g := range byKey {
		groups = append(groups, g)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].time.Before(groups[j].time) })
	remove := m.remove
	if remove == nil {
		remove = os.Remove
	}
	for _, g := range groups {
		if total <= m.Limit {
			return nil
		}
		m.mu.Lock()
		if m.active[g.key] > 0 {
			m.mu.Unlock()
			continue
		}
		if m.removing == nil {
			m.removing = make(map[string]chan struct{})
		}
		done := make(chan struct{})
		m.removing[g.key] = done
		m.mu.Unlock()
		for _, e := range g.files {
			err = remove(e.path)
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				break
			}
			total -= e.size
		}
		m.mu.Lock()
		delete(m.removing, g.key)
		close(done)
		m.mu.Unlock()
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}
