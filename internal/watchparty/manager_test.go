package watchparty

import (
	"testing"
	"time"
)

func TestRoomSynchronizesPlaybackAndBuffering(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	manager := New()
	manager.now = func() time.Time { return now }
	id, err := manager.Create("Movies/Example.mkv")
	if err != nil {
		t.Fatal(err)
	}
	media, a, leaveA, sendA, err := manager.Join(id)
	if err != nil || media != "Movies/Example.mkv" {
		t.Fatalf("join: %s %v", media, err)
	}
	defer leaveA()
	_, b, leaveB, sendB, err := manager.Join(id)
	if err != nil {
		t.Fatal(err)
	}
	defer leaveB()
	latest := func(ch <-chan State) State {
		var state State
		for {
			select {
			case next := <-ch:
				state = next
			default:
				return state
			}
		}
	}
	sendA(Event{Type: "ready"})
	sendB(Event{Type: "ready"})
	state := latest(a)
	if !state.Playing || state.Participants != 2 || state.Buffering != 0 {
		t.Fatalf("ready: %+v", state)
	}
	now = now.Add(5 * time.Second)
	state, _ = manager.Snapshot(id)
	if state.Position != 5 {
		t.Fatalf("position = %v", state.Position)
	}
	sendB(Event{Type: "buffering"})
	state = latest(a)
	if state.Playing || state.Buffering != 1 || state.Position != 5 {
		t.Fatalf("buffer: %+v", state)
	}
	now = now.Add(8 * time.Second)
	state, _ = manager.Snapshot(id)
	if state.Position != 5 {
		t.Fatalf("buffering advanced position = %v", state.Position)
	}
	sendA(Event{Type: "seek", Position: 60})
	sendA(Event{Type: "rate", Rate: 1.5})
	sendB(Event{Type: "ready"})
	state = latest(b)
	if !state.Playing || state.Position != 60 || state.Rate != 1.5 {
		t.Fatalf("resume: %+v", state)
	}
	sendA(Event{Type: "boost-start"})
	state = latest(b)
	if state.Rate != 2 {
		t.Fatalf("boost: %+v", state)
	}
	sendA(Event{Type: "boost-end"})
	state = latest(b)
	if state.Rate != 1.5 {
		t.Fatalf("boost ended: %+v", state)
	}
	sendB(Event{Type: "pause"})
	state = latest(a)
	if state.Playing || state.Intent {
		t.Fatalf("manual pause: %+v", state)
	}
	sendA(Event{Type: "rate", Rate: 8})
	state, _ = manager.Snapshot(id)
	if state.Rate != 1.5 {
		t.Fatalf("invalid rate accepted: %+v", state)
	}
	leaveB()
	state = latest(a)
	if state.Participants != 1 || state.Buffering != 0 {
		t.Fatalf("leave: %+v", state)
	}
}

func TestEmptyRoomExpires(t *testing.T) {
	now := time.Now()
	manager := New()
	manager.now = func() time.Time { return now }
	id, _ := manager.Create("file")
	now = now.Add(time.Hour + time.Second)
	if _, err := manager.Media(id); err != ErrNotFound {
		t.Fatalf("expected expired room, got %v", err)
	}
}
