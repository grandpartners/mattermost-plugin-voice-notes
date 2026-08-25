package main

import (
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestExecuteCommandCreatesLocalizedFragmentLink(t *testing.T) {
	api := &fakeMattermostAPI{locale: "ru"}
	p := &Plugin{api: api, tokens: newTokenStore(nil)}
	response, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
		UserId:    "user-id",
		ChannelId: "channel-id",
		TeamId:    "team-id",
		RootId:    "root-id",
	})
	if appErr != nil {
		t.Fatalf("ExecuteCommand error: %v", appErr)
	}
	if response.ResponseType != model.CommandResponseTypeEphemeral {
		t.Fatalf("response type = %q", response.ResponseType)
	}
	if !strings.Contains(response.Text, "Открыть запись голоса") {
		t.Fatalf("command was not localized: %q", response.Text)
	}
	if !strings.Contains(response.Text, "/mobile/?lang=ru#token=") {
		t.Fatalf("token is not carried in the URL fragment: %q", response.Text)
	}
}

func TestConfiguredSiteURLRequiresHTTPS(t *testing.T) {
	httpURL := "http://mattermost.example.com"
	if _, err := configuredSiteURL(&model.Config{ServiceSettings: model.ServiceSettings{SiteURL: &httpURL}}); err == nil {
		t.Fatal("HTTP SiteURL was accepted")
	}

	httpsURL := "https://mattermost.example.com/subpath/"
	got, err := configuredSiteURL(&model.Config{ServiceSettings: model.ServiceSettings{SiteURL: &httpsURL}})
	if err != nil {
		t.Fatalf("HTTPS SiteURL rejected: %v", err)
	}
	if got != "https://mattermost.example.com/subpath" {
		t.Fatalf("configuredSiteURL = %q", got)
	}
}

func TestMattermostPostDeepLinkPreservesSiteSubpath(t *testing.T) {
	siteURL := "https://mattermost.example.com/subpath/?ignored=yes#fragment"
	got, err := mattermostPostDeepLink(
		&model.Config{ServiceSettings: model.ServiceSettings{SiteURL: &siteURL}},
		"my-team",
		"created-post-id",
	)
	if err != nil {
		t.Fatalf("mattermostPostDeepLink error: %v", err)
	}
	if got != "mattermost://mattermost.example.com/subpath/my-team/pl/created-post-id" {
		t.Fatalf("mattermostPostDeepLink = %q", got)
	}
}
