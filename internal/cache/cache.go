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
	Root    string
	Limit   int64
	mu      sync.Mutex
	evictMu sync.Mutex
	active  map[string]int
	scan    func(string) ([]entry, int64, error)
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
	m.mu.Lock()
	m.active[key]++
	m.mu.Unlock()
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
	sort.Slice(all, func(i, j int) bool { return all[i].time.Before(all[j].time) })
	for _, e := range all {
		if total <= m.Limit {
			return nil
		}
		m.mu.Lock()
		if m.active[e.key] > 0 {
			m.mu.Unlock()
			continue
		}
		err = os.Remove(e.path)
		m.mu.Unlock()
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		total -= e.size
	}
	return nil
}
