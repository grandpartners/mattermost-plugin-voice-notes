// Reads webapp state directly instead of bundling mattermost-redux (~250 KB).
// Paths are guarded: if they move in a future webapp, features degrade to
// "post to current channel" instead of breaking.
export function getRecordTarget(state) {
    const channelId = state?.entities?.channels?.currentChannelId || '';
    let rootId = '';
    const rhsPostId = state?.views?.rhs?.selectedPostId || '';
    if (rhsPostId && channelId) {
        const post = state?.entities?.posts?.posts?.[rhsPostId];
        if (post && post.channel_id === channelId) {
            rootId = post.root_id || post.id;
        }
    }
    return {channelId, rootId};
}

export function getChannelLabel(state, channelId) {
    const channel = state?.entities?.channels?.channels?.[channelId];
    if (!channel || !channel.display_name) {
        return '';
    }
    if (channel.type === 'O' || channel.type === 'P') {
        return `#${channel.display_name}`;
    }
    return channel.display_name;
}
