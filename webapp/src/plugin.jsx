import React from 'react';
import {FormattedMessage} from 'react-intl';

import {POST_TYPE} from './constants';
import {getTranslations} from './i18n';
import {injectStyles} from './styles';
import {openRecorder} from './controller';
import {getChannelLabel, getRecordTarget} from './store_helpers';
import Root from './components/root';
import VoicePost from './components/voice_post';
import {MicIcon} from './components/icons';

const APP_BAR_ICON =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5d6670">' +
        '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/>' +
        '<path d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>' +
        '</svg>',
    );

export default class VoiceNotesPlugin {
    initialize(registry, store) {
        injectStyles();

        const open = () => {
            const state = store.getState();
            const target = getRecordTarget(state);
            if (!target.channelId) {
                return;
            }
            openRecorder({
                ...target,
                channelLabel: getChannelLabel(state, target.channelId),
            });
        };

        registry.registerTranslations(getTranslations);
        registry.registerRootComponent(Root);
        registry.registerPostTypeComponent(POST_TYPE, VoicePost);
        registry.registerFileUploadMethod(
            <MicIcon/>,
            open,
            <FormattedMessage
                id='voicenotes.attach'
                defaultMessage='Voice message'
            />,
        );
        registry.registerSlashCommandWillBePostedHook((message, args) => {
            if (message.trim() === '/voice') {
                open();
                return {};
            }
            return {message, args};
        });
        if (registry.registerAppBarComponent) {
            registry.registerAppBarComponent(
                APP_BAR_ICON,
                open,
                <FormattedMessage
                    id='voicenotes.attach'
                    defaultMessage='Voice message'
                />,
            );
        }
    }
}
