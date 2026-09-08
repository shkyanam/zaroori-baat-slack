# Zaroori Baat Slack

## Slack Signal Desk

Zaroori Baat Slack scans incoming Slack message events, scores actionability, and ranks the messages most likely to need a response, owner, or decision.

![Zaroori Baat Slack architecture](zaroori-baat-slack-architecture.svg)

### Run locally

```bash
cd /Users/shalinikyanam/Documents/Training/MasteringAgenticAI/SlackProject
python3 app.py
```

Open http://127.0.0.1:8001.

### Slack app setup

Create a Slack app at api.slack.com/apps and enable **Event Subscriptions**. Set the Request URL to:

```text
https://YOUR_PUBLIC_HOST/webhooks/slack
```

Subscribe to bot events such as `message.channels`, `message.groups`, or `message.im` according to the channels the bot is allowed to access. Set `SLACK_SIGNING_SECRET` in the environment before production use. The endpoint supports Slack URL verification and verifies signed requests when the secret is configured. Set `SLACK_CHANNEL_IDS` to a comma-separated list to scan multiple channels with one Sync Slack action.

### Add every new Slack channel

For each new channel that Zaroori Baat should scan:

1. Open the channel in Slack and invite the Zaroori Baat bot/app:

   ```text
   /invite @Zaroori Baat Slack
   ```

   Use the bot's actual Slack display name if it differs. The bot must be a member of private channels.
2. Copy the channel ID from the channel details. Use the ID, not the channel name.
3. Add the channel ID to `.env`, keeping existing channel IDs separated by commas:

   ```env
   SLACK_BOT_TOKEN=xoxb-your-token
   SLACK_CHANNEL_IDS=C012OLDCHANNEL,C012NEWCHANNEL
   SLACK_SIGNING_SECRET=your-signing-secret
   ```

4. Restart the local server so it reloads `.env`, then select **Sync Slack** in the app.

If a channel is not included in `SLACK_CHANNEL_IDS`, history sync will not scan it. If Slack returns `not_in_channel`, invite the bot to that channel and try again.

### Design boundary

This MVP processes events delivered to the Slack app. It does not scrape Slack's UI or pull private history without the required Slack scopes. The queue is connector-independent, so mock messages can be used for evaluation.

### Priority model

- **High:** blocker, incident, deadline, urgent request, or explicit action with a near-term time.
- **Medium:** actionable request without an immediate deadline.
- **Low:** informational or social message without a clear action.

Human actions are recorded as `approved`, `deferred`, `dismissed`, or `escalated`.
