type SenderIdentity = { sender: string; sender_name?: string };
type ChannelIdentity = { channel?: string; channel_name?: string };

export function senderName(source: SenderIdentity) {
  return source.sender_name?.trim() || source.sender;
}

export function channelName(source: ChannelIdentity) {
  return (source.channel_name?.trim() || source.channel || '').replace(/^#/, '');
}

// Only format the backend's generated channel label; original source text stays intact.
export function slackSourceLabel(source: string, identities: ChannelIdentity[]) {
  const identity = identities.find(
    (item) =>
      item.channel &&
      source === `Slack channel ${item.channel}` &&
      item.channel_name?.trim() &&
      item.channel_name.trim() !== item.channel,
  );
  return identity ? `Slack channel #${channelName(identity)}` : source;
}

// Labels can change or collide; channel IDs remain the filter and route values.
export function channelOptions(sources: (ChannelIdentity & { channel: string })[]) {
  const channels = new Map<string, { value: string; label: string }>();
  for (const source of sources) {
    if (!channels.has(source.channel) || source.channel_name?.trim()) {
      channels.set(source.channel, { value: source.channel, label: channelName(source) });
    }
  }
  return [...channels.values()].sort(
    (left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value),
  );
}
