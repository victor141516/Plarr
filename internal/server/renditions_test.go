package server

import (
	"testing"

	"github.com/victor141516/Plarr/internal/config"
)

func testRenditions() []config.Rendition {
	return []config.Rendition{
		{Label: "2160p", Height: 2160},
		{Label: "1080p", Height: 1080},
		{Label: "720p", Height: 720},
		{Label: "480p", Height: 480},
	}
}

func TestPlayableRenditionsIncludesNearbyUpperRung(t *testing.T) {
	got := playableRenditions(testRenditions(), 808)
	if len(got) != 3 || got[2].Label != "1080p" {
		t.Fatalf("808p should expose 480p, 720p and 1080p; got %#v", got)
	}
}

func TestPlayableRenditionsRejectsDistantUpperRung(t *testing.T) {
	got := playableRenditions(testRenditions(), 500)
	if len(got) != 1 || got[0].Label != "480p" {
		t.Fatalf("500p should not expose 720p because more than 30%% is missing; got %#v", got)
	}
}

func TestPlayableRenditionsAddsOnlyImmediateUpperRung(t *testing.T) {
	got := playableRenditions(testRenditions(), 900)
	if len(got) != 3 || got[2].Label != "1080p" {
		t.Fatalf("900p should expose 1080p but never 2160p; got %#v", got)
	}
}
