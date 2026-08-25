package main

import (
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

const pluginID = "corp.osbren.voicenotes"

type mattermostAPI interface {
	RegisterCommand(command *model.Command) error
	GetConfig() *model.Config
	GetUser(userID string) (*model.User, *model.AppError)
	HasPermissionToChannel(userID, channelID string, permission *model.Permission) bool
	GetPost(postID string) (*model.Post, *model.AppError)
	UploadFile(data []byte, channelID, filename string) (*model.FileInfo, *model.AppError)
	CreatePost(post *model.Post) (*model.Post, *model.AppError)
	KVSetWithExpiry(key string, value []byte, expireInSeconds int64) *model.AppError
	KVSetWithOptions(key string, value []byte, options model.PluginKVSetOptions) (bool, *model.AppError)
	KVGet(key string) ([]byte, *model.AppError)
	KVCompareAndDelete(key string, oldValue []byte) (bool, *model.AppError)
}

type Plugin struct {
	plugin.MattermostPlugin

	runtimeMu sync.Mutex
	api       mattermostAPI
	tokens    *tokenStore
}

func (p *Plugin) OnActivate() error {
	p.runtimeMu.Lock()
	if p.api == nil {
		p.api = p.API
	}
	api := p.api
	if api != nil && p.tokens == nil {
		p.tokens = newTokenStore(mattermostTokenKV{api: p.api})
	}
	p.runtimeMu.Unlock()

	if api == nil {
		return fmt.Errorf("Mattermost API is unavailable")
	}
	return api.RegisterCommand(&model.Command{
		Trigger:          "voice",
		AutoComplete:     true,
		AutoCompleteDesc: "Record and send a voice message",
		DisplayName:      "Voice Notes",
	})
}

func (p *Plugin) ExecuteCommand(_ *plugin.Context, args *model.CommandArgs) (*model.CommandResponse, *model.AppError) {
	api, tokens := p.runtime()
	if api == nil || args == nil || args.UserId == "" || args.ChannelId == "" {
		return commandError("The voice recorder is temporarily unavailable."), nil
	}

	siteURL, err := configuredSiteURL(api.GetConfig())
	if err != nil {
		return commandError("The mobile voice recorder requires an HTTPS Mattermost Site URL. Ask your administrator to configure ServiceSettings.SiteURL."), nil
	}

	if !hasRecorderPermissions(api, args.UserId, args.ChannelId) {
		return commandError("You no longer have permission to post files in this channel."), nil
	}

	token, err := tokens.issue(recorderTarget{
		UserID:    args.UserId,
		ChannelID: args.ChannelId,
		TeamID:    args.TeamId,
		RootID:    args.RootId,
	})
	if err != nil {
		return commandError("The voice recorder could not be opened. Please try again."), nil
	}

	locale := ""
	if user, appErr := api.GetUser(args.UserId); appErr == nil && user != nil {
		locale = user.Locale
	}
	recorderURL := siteURL + "/plugins/" + pluginID + "/mobile/"
	if locale != "" {
		recorderURL += "?lang=" + url.QueryEscape(locale)
	}
	recorderURL += "#token=" + url.QueryEscape(token)
	return &model.CommandResponse{
		ResponseType:     model.CommandResponseTypeEphemeral,
		Text:             mobileCommandText(locale, recorderURL),
		SkipSlackParsing: true,
	}, nil
}

func mobileCommandText(locale, recorderURL string) string {
	switch strings.ToLower(strings.Split(locale, "-")[0]) {
	case "ru":
		return fmt.Sprintf("[🎤 Открыть запись голоса](%s)\n\nПриватная ссылка действует 20 минут и позволяет отправить одно голосовое сообщение.", recorderURL)
	case "es":
		return fmt.Sprintf("[🎤 Abrir grabadora de voz](%s)\n\nEste enlace privado caduca en 20 minutos y permite enviar un mensaje de voz.", recorderURL)
	default:
		return fmt.Sprintf("[🎤 Open voice recorder](%s)\n\nThis private link expires in 20 minutes and can send one voice message.", recorderURL)
	}
}

func (p *Plugin) runtime() (mattermostAPI, *tokenStore) {
	p.runtimeMu.Lock()
	defer p.runtimeMu.Unlock()
	if p.api == nil && p.API != nil {
		p.api = p.API
	}
	if p.tokens == nil {
		if p.api == nil {
			p.tokens = newTokenStore(nil)
		} else {
			p.tokens = newTokenStore(mattermostTokenKV{api: p.api})
		}
	}
	return p.api, p.tokens
}

type mattermostTokenKV struct {
	api mattermostAPI
}

func (m mattermostTokenKV) setWithExpiry(key string, value []byte, expiresIn time.Duration) error {
	if appErr := m.api.KVSetWithExpiry(key, value, int64(expiresIn/time.Second)); appErr != nil {
		return appErr
	}
	return nil
}

func (m mattermostTokenKV) get(key string) ([]byte, error) {
	value, appErr := m.api.KVGet(key)
	if appErr != nil {
		return nil, appErr
	}
	return value, nil
}

func (m mattermostTokenKV) compareAndSet(key string, oldValue, newValue []byte, expiresIn time.Duration) (bool, error) {
	seconds := int64((expiresIn + time.Second - 1) / time.Second)
	updated, appErr := m.api.KVSetWithOptions(key, newValue, model.PluginKVSetOptions{
		Atomic:          true,
		OldValue:        oldValue,
		ExpireInSeconds: seconds,
	})
	if appErr != nil {
		return false, appErr
	}
	return updated, nil
}

func (m mattermostTokenKV) compareAndDelete(key string, oldValue []byte) (bool, error) {
	deleted, appErr := m.api.KVCompareAndDelete(key, oldValue)
	if appErr != nil {
		return false, appErr
	}
	return deleted, nil
}

func configuredSiteURL(config *model.Config) (string, error) {
	if config == nil || config.ServiceSettings.SiteURL == nil {
		return "", fmt.Errorf("SiteURL is not configured")
	}

	raw := strings.TrimSpace(*config.ServiceSettings.SiteURL)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return "", fmt.Errorf("SiteURL must be an absolute HTTPS URL")
	}
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimRight(u.String(), "/"), nil
}

func commandError(message string) *model.CommandResponse {
	return &model.CommandResponse{
		ResponseType: model.CommandResponseTypeEphemeral,
		Text:         message,
	}
}

func hasRecorderPermissions(api mattermostAPI, userID, channelID string) bool {
	return api.HasPermissionToChannel(userID, channelID, model.PermissionReadChannel) &&
		api.HasPermissionToChannel(userID, channelID, model.PermissionUploadFile) &&
		api.HasPermissionToChannel(userID, channelID, model.PermissionCreatePost)
}
