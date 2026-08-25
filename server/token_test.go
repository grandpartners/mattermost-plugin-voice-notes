package main

import (
	"errors"
	"testing"
	"time"
)

type faultTokenKV struct {
	tokenKV
	compareAndSetErr    error
	compareAndDeleteErr error
}

func (f *faultTokenKV) compareAndSet(key string, oldValue, newValue []byte, expiresIn time.Duration) (bool, error) {
	if f.compareAndSetErr != nil {
		return false, f.compareAndSetErr
	}
	return f.tokenKV.compareAndSet(key, oldValue, newValue, expiresIn)
}

func (f *faultTokenKV) compareAndDelete(key string, oldValue []byte) (bool, error) {
	if f.compareAndDeleteErr != nil {
		return false, f.compareAndDeleteErr
	}
	return f.tokenKV.compareAndDelete(key, oldValue)
}

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

	if claim.record.PendingPostID == "" {
		t.Fatal("issued token has no pending post ID")
	}
	if err = store.attachFile(claim, "file-id"); err != nil {
		t.Fatalf("attach file: %v", err)
	}
	if err = store.release(claim); err != nil {
		t.Fatalf("release token: %v", err)
	}
	claim, err = store.claim(token)
	if err != nil {
		t.Fatalf("claim after release: %v", err)
	}
	if claim.record.FileID != "file-id" {
		t.Fatalf("file ID after retry = %q, want %q", claim.record.FileID, "file-id")
	}
	if err = store.complete(claim); err != nil {
		t.Fatalf("complete token: %v", err)
	}
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

func TestTokenStoreReportsReleaseAndCompleteErrors(t *testing.T) {
	backend := &faultTokenKV{tokenKV: newMemoryTokenKV()}
	store := newTokenStore(backend)
	token, err := store.issue(recorderTarget{UserID: "user"})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	claim, err := store.claim(token)
	if err != nil {
		t.Fatalf("claim token: %v", err)
	}

	backend.compareAndSetErr = errors.New("temporary KV error")
	if err = store.release(claim); err == nil {
		t.Fatal("release ignored a KV error")
	}
	backend.compareAndSetErr = nil
	if err = store.release(claim); err != nil {
		t.Fatalf("release after KV recovery: %v", err)
	}

	claim, err = store.claim(token)
	if err != nil {
		t.Fatalf("claim after release: %v", err)
	}
	backend.compareAndDeleteErr = errors.New("temporary KV error")
	if err = store.complete(claim); err == nil {
		t.Fatal("complete ignored a KV error")
	}
}
