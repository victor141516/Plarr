package server

import (
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestPlaybackParamsPropagateGeneration(t *testing.T) {
	request := httptest.NewRequest("GET", "/?session=player-1&generation=12&start=4.5", nil)
	_, _, raw := playbackParams(request, 100)
	values, err := url.ParseQuery(strings.TrimPrefix(raw, "?"))
	if err != nil {
		t.Fatal(err)
	}
	if values.Get("generation") != "12" {
		t.Fatalf("playback generation was not propagated: %s", raw)
	}
}

func TestPlaybackGenerationRejectsStaleChildrenAndMasters(t *testing.T) {
	server := &Server{}
	activate := func(generation string) (bool, int) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest("GET", "/?session=player-1&generation="+generation, nil)
		return server.acceptPlaybackGeneration(recorder, request, true), recorder.Code
	}
	child := func(generation string) (bool, int) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest("GET", "/?session=player-1&generation="+generation, nil)
		return server.acceptPlaybackGeneration(recorder, request, false), recorder.Code
	}

	if accepted, status := child("1"); accepted || status != 409 {
		t.Fatalf("unactivated child accepted=%v status=%d", accepted, status)
	}
	if accepted, _ := activate("2"); !accepted {
		t.Fatal("current master generation was rejected")
	}
	if accepted, status := child("1"); accepted || status != 409 {
		t.Fatalf("stale child accepted=%v status=%d", accepted, status)
	}
	if accepted, _ := child("2"); !accepted {
		t.Fatal("current child generation was rejected")
	}
	if accepted, status := activate("1"); accepted || status != 409 {
		t.Fatalf("stale master accepted=%v status=%d", accepted, status)
	}
	if accepted, _ := activate("3"); !accepted {
		t.Fatal("newer master generation was rejected")
	}
}

func TestSourceGenerationIsCancelledOnlyOnItsFirstMasterRequest(t *testing.T) {
	if !sourceSwitchNeeded(4, 0) {
		t.Fatal("a new source generation must stop the old jobs")
	}
	if sourceSwitchNeeded(4, 4) {
		t.Fatal("reloading the same HLS master must not stop its video and audio jobs")
	}
	if !sourceSwitchNeeded(5, 4) {
		t.Fatal("a newer source generation must stop the previous jobs")
	}
}
