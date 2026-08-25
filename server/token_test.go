package main

import (
	"errors"
	"testing"
	"time"
)

func TestTokenStoreOneTimeLifecycle(t *testing.T) {
	store := newTokenStore(nil)
	target := recorderTarget{UserID: "user", ChannelID: "channel", RootID: "root"}
	token, err := store.issue(target)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	claim, err := store.claim(token)
	if err != nil {
		t.Fatalf("claim token: %v", err)
	}
	if claim.record.Target != target {
		t.Fatalf("claim target = %#v, want %#v", claim.record.Target, target)
	}
	if _, err = store.claim(token); !errors.Is(err, errTokenInUse) {
		t.Fatalf("second concurrent claim error = %v, want %v", err, errTokenInUse)
	}

	store.release(claim)
	claim, err = store.claim(token)
	if err != nil {
		t.Fatalf("claim after release: %v", err)
	}
	store.complete(claim)
	if _, err = store.claim(token); !errors.Is(err, errInvalidToken) {
		t.Fatalf("claim after completion error = %v, want %v", err, errInvalidToken)
	}
}

func TestTokenStoreExpiry(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	store := newTokenStore(nil)
	store.now = func() time.Time { return now }
	token, err := store.issue(recorderTarget{UserID: "user"})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	now = now.Add(recorderLinkTTL)
	if _, err = store.claim(token); !errors.Is(err, errInvalidToken) {
		t.Fatalf("expired claim error = %v, want %v", err, errInvalidToken)
	}
}
