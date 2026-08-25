package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

type fakeMattermostAPI struct {
	created         *model.Post
	locale          string
	denyPermissions bool
	failUpload      bool
	failCreate      bool
	uploadCalls     int
	createCalls     int
	pendingPostIDs  []string
	warnings        []string
}

type blockingUploadAPI struct {
	*fakeMattermostAPI
	uploadStarted  chan struct{}
	continueUpload chan struct{}
	startedOnce    sync.Once
}

func (b *blockingUploadAPI) UploadFile(data []byte, channelID, filename string) (*model.FileInfo, *model.AppError) {
	b.startedOnce.Do(func() { close(b.uploadStarted) })
	<-b.continueUpload
	return b.fakeMattermostAPI.UploadFile(data, channelID, filename)
}

func (f *fakeMattermostAPI) RegisterCommand(_ *model.Command) error { return nil }
func (f *fakeMattermostAPI) LogWarn(msg string, _ ...any) {
	f.warnings = append(f.warnings, msg)
}
func (f *fakeMattermostAPI) GetConfig() *model.Config {
	siteURL := "https://mattermost.example.com"
	return &model.Config{ServiceSettings: model.ServiceSettings{SiteURL: &siteURL}}
}
func (f *fakeMattermostAPI) GetUser(_ string) (*model.User, *model.AppError) {
	locale := f.locale
	if locale == "" {
		locale = "en"
	}
	return &model.User{Locale: locale}, nil
}
func (f *fakeMattermostAPI) HasPermissionToChannel(_, _ string, _ *model.Permission) bool {
	return !f.denyPermissions
}
func (f *fakeMattermostAPI) GetPost(_ string) (*model.Post, *model.AppError) { return nil, nil }
func (f *fakeMattermostAPI) UploadFile(data []byte, channelID, filename string) (*model.FileInfo, *model.AppError) {
	f.uploadCalls++
	if f.failUpload || len(data) == 0 || channelID == "" || !strings.HasSuffix(filename, ".webm") {
		return nil, model.NewAppError("test", "invalid upload", nil, "", http.StatusBadRequest)
	}
	return &model.FileInfo{Id: "abcdefghijklmnopqrstuvwxyz"}, nil
}
func (f *fakeMattermostAPI) CreatePost(post *model.Post) (*model.Post, *model.AppError) {
	f.createCalls++
	f.pendingPostIDs = append(f.pendingPostIDs, post.PendingPostId)
	if f.failCreate {
		return nil, model.NewAppError("test", "create failed", nil, "", http.StatusInternalServerError)
	}
	f.created = post
	post.Id = "created-post-id"
	return post, nil
}
func (f *fakeMattermostAPI) KVSetWithExpiry(_ string, _ []byte, _ int64) *model.AppError {
	return nil
}
func (f *fakeMattermostAPI) KVSetWithOptions(_ string, _ []byte, _ model.PluginKVSetOptions) (bool, *model.AppError) {
	return true, nil
}
func (f *fakeMattermostAPI) KVGet(_ string) ([]byte, *model.AppError) { return nil, nil }
func (f *fakeMattermostAPI) KVCompareAndDelete(_ string, _ []byte) (bool, *model.AppError) {
	return true, nil
}

func TestServeMobileRecorder(t *testing.T) {
	p := &Plugin{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/mobile/", nil)
	p.ServeHTTP(nil, recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if !strings.Contains(recorder.Body.String(), "Voice Notes") {
		t.Fatal("recorder HTML was not served")
	}
	if got := recorder.Header().Get("Content-Security-Policy"); !strings.Contains(got, "frame-ancestors 'none'") {
		t.Fatalf("unexpected Content-Security-Policy: %q", got)
	}
}

func TestAudioContainerSignatures(t *testing.T) {
	if !hasAudioContainerSignature([]byte{0x1a, 0x45, 0xdf, 0xa3}, "webm") {
		t.Fatal("valid WebM signature rejected")
	}
	if !hasAudioContainerSignature([]byte{0, 0, 0, 20, 'f', 't', 'y', 'p', 'M', '4', 'A', ' '}, "m4a") {
		t.Fatal("valid M4A signature rejected")
	}
	if hasAudioContainerSignature([]byte("not audio"), "webm") {
		t.Fatal("invalid WebM signature accepted")
	}
}

func TestLocalizedPostMessage(t *testing.T) {
	tests := map[string]string{
		"en-US": "🎤 Voice message (1:05)",
		"ru":    "🎤 Голосовое сообщение (1:05)",
		"es-ES": "🎤 Mensaje de voz (1:05)",
	}
	for language, want := range tests {
		if got := localizedPostMessage(language, 65_000); got != want {
			t.Errorf("localizedPostMessage(%q) = %q, want %q", language, got, want)
		}
	}
}

func TestMobileSendCreatesPostAndRedeemsToken(t *testing.T) {
	api := &fakeMattermostAPI{}
	store := newTokenStore(nil)
	p := &Plugin{api: api, tokens: store}
	token, err := store.issue(recorderTarget{UserID: "user-id", ChannelID: "channel-id"})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	request := newWebMUploadRequest(t, token)
	recorder := httptest.NewRecorder()
	p.ServeHTTP(nil, recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body: %s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
	if api.created == nil {
		t.Fatal("voice post was not created")
	}
	if api.created.UserId != "user-id" || api.created.ChannelId != "channel-id" || api.created.Type != "custom_voice" {
		t.Fatalf("unexpected post target: %#v", api.created)
	}
	if got := api.created.GetProps()["fileId"]; got != "abcdefghijklmnopqrstuvwxyz" {
		t.Fatalf("fileId prop = %#v", got)
	}
	if api.created.PendingPostId == "" {
		t.Fatal("voice post has no pending post ID for retry deduplication")
	}

	replay := newWebMUploadRequest(t, token)
	replayRecorder := httptest.NewRecorder()
	p.ServeHTTP(nil, replayRecorder, replay)
	if replayRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("replay status = %d, want %d", replayRecorder.Code, http.StatusUnauthorized)
	}
}

func TestMobileSendReusesUploadAfterCreatePostFailure(t *testing.T) {
	api := &fakeMattermostAPI{failCreate: true}
	store := newTokenStore(nil)
	p := &Plugin{api: api, tokens: store}
	token, err := store.issue(recorderTarget{UserID: "user-id", ChannelID: "channel-id"})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	firstRecorder := httptest.NewRecorder()
	p.ServeHTTP(nil, firstRecorder, newWebMUploadRequest(t, token))
	if firstRecorder.Code != http.StatusBadGateway {
		t.Fatalf("first status = %d, want %d; body: %s", firstRecorder.Code, http.StatusBadGateway, firstRecorder.Body.String())
	}
	if api.uploadCalls != 1 || api.createCalls != 1 {
		t.Fatalf("first attempt calls: upload = %d, create = %d", api.uploadCalls, api.createCalls)
	}

	api.failCreate = false
	secondRecorder := httptest.NewRecorder()
	p.ServeHTTP(nil, secondRecorder, newWebMUploadRequest(t, token))
	if secondRecorder.Code != http.StatusCreated {
		t.Fatalf("retry status = %d, want %d; body: %s", secondRecorder.Code, http.StatusCreated, secondRecorder.Body.String())
	}
	if api.uploadCalls != 1 {
		t.Fatalf("retry uploaded another file; upload calls = %d, want 1", api.uploadCalls)
	}
	if api.createCalls != 2 {
		t.Fatalf("create calls = %d, want 2", api.createCalls)
	}
	if len(api.pendingPostIDs) != 2 || api.pendingPostIDs[0] == "" || api.pendingPostIDs[0] != api.pendingPostIDs[1] {
		t.Fatalf("pending post IDs are not stable across retry: %#v", api.pendingPostIDs)
	}
	if len(api.warnings) == 0 {
		t.Fatal("CreatePost failure was not logged for orphan-file diagnostics")
	}
}

func TestMobileSendReleasesTokenAfterUploadFailure(t *testing.T) {
	api := &fakeMattermostAPI{failUpload: true}
	store := newTokenStore(nil)
	p := &Plugin{api: api, tokens: store}
	token, err := store.issue(recorderTarget{UserID: "user-id", ChannelID: "channel-id"})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	firstRecorder := httptest.NewRecorder()
	p.ServeHTTP(nil, firstRecorder, newWebMUploadRequest(t, token))
	if firstRecorder.Code != http.StatusBadGateway {
		t.Fatalf("first status = %d, want %d", firstRecorder.Code, http.StatusBadGateway)
	}

	api.failUpload = false
	retryRecorder := httptest.NewRecorder()
	p.ServeHTTP(nil, retryRecorder, newWebMUploadRequest(t, token))
	if retryRecorder.Code != http.StatusCreated {
		t.Fatalf("retry status = %d, want %d; body: %s", retryRecorder.Code, http.StatusCreated, retryRecorder.Body.String())
	}
}

func TestMobileSendRechecksPermissionsAndReleasesToken(t *testing.T) {
	api := &fakeMattermostAPI{denyPermissions: true}
	store := newTokenStore(nil)
	p := &Plugin{api: api, tokens: store}
	token, err := store.issue(recorderTarget{UserID: "user-id", ChannelID: "channel-id"})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	deniedRecorder := httptest.NewRecorder()
	p.ServeHTTP(nil, deniedRecorder, newWebMUploadRequest(t, token))
	if deniedRecorder.Code != http.StatusForbidden {
		t.Fatalf("denied status = %d, want %d", deniedRecorder.Code, http.StatusForbidden)
	}
	if api.uploadCalls != 0 {
		t.Fatalf("recording was uploaded after permissions were revoked; calls = %d", api.uploadCalls)
	}

	api.denyPermissions = false
	retryRecorder := httptest.NewRecorder()
	p.ServeHTTP(nil, retryRecorder, newWebMUploadRequest(t, token))
	if retryRecorder.Code != http.StatusCreated {
		t.Fatalf("retry status = %d, want %d; body: %s", retryRecorder.Code, http.StatusCreated, retryRecorder.Body.String())
	}
}

func TestMobileSendAllowsOnlyOneParallelRequest(t *testing.T) {
	api := &blockingUploadAPI{
		fakeMattermostAPI: &fakeMattermostAPI{},
		uploadStarted:     make(chan struct{}),
		continueUpload:    make(chan struct{}),
	}
	store := newTokenStore(nil)
	p := &Plugin{api: api, tokens: store}
	token, err := store.issue(recorderTarget{UserID: "user-id", ChannelID: "channel-id"})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	firstRequest := newWebMUploadRequest(t, token)
	firstDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		recorder := httptest.NewRecorder()
		p.ServeHTTP(nil, recorder, firstRequest)
		firstDone <- recorder
	}()

	select {
	case <-api.uploadStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("first request did not reach UploadFile")
	}

	parallelRecorder := httptest.NewRecorder()
	p.ServeHTTP(nil, parallelRecorder, newWebMUploadRequest(t, token))
	if parallelRecorder.Code != http.StatusConflict {
		t.Fatalf("parallel status = %d, want %d", parallelRecorder.Code, http.StatusConflict)
	}

	close(api.continueUpload)
	select {
	case firstRecorder := <-firstDone:
		if firstRecorder.Code != http.StatusCreated {
			t.Fatalf("first status = %d, want %d; body: %s", firstRecorder.Code, http.StatusCreated, firstRecorder.Body.String())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first request did not finish")
	}
}

func newWebMUploadRequest(t *testing.T, token string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="audio"; filename="voice-note.webm"`)
	header.Set("Content-Type", "audio/webm; codecs=opus")
	file, err := writer.CreatePart(header)
	if err != nil {
		t.Fatalf("create audio part: %v", err)
	}
	_, _ = file.Write([]byte{0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02})
	_ = writer.WriteField("duration_ms", "4200")
	peaks, _ := json.Marshal([]float64{0.1, 0.2, 0.3, 0.4, 0.5})
	_ = writer.WriteField("peaks", string(peaks))
	_ = writer.WriteField("language", "ru")
	if err = writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/mobile/send", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+token)
	return request
}
