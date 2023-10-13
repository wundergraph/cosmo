import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { SlackAccessTokenResponse } from '../../types/index.js';

export default class Slack {
  clientID = '';
  clientSecret = '';
  constructor({ clientID, clientSecret }: { clientID: string; clientSecret: string }) {
    this.clientID = clientID;
    this.clientSecret = clientSecret;
  }

  public async fetchAccessToken(code: string, redirectURI: string): Promise<SlackAccessTokenResponse | undefined> {
    const url = 'https://slack.com/api/oauth.v2.access';
    const formData = new FormData();
    formData.append('code', code);
    formData.append('client_id', this.clientID);
    formData.append('client_secret', this.clientSecret);
    formData.append('grant_type', 'authorization_code');
    formData.append('redirect_uri', redirectURI);

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    const body = await response.json();

    if (body.ok === false) {
      return undefined;
    }

    return {
      accessToken: body.access_token,
      slackUserId: body.authed_user.id,
      slackOrgId: body.team.id,
      slackOrgName: body.team.name,
      slackChannelId: body.incoming_webhook.channel_id,
      slackChannelName: body.incoming_webhook.channel,
      webhookURL: body.incoming_webhook.url,
    };
  }

  public async addSlackInstallations({
    slackUserId,
    accessToken,
    slackOrganizationId,
    slackOrganizationName,
    slackChannelId,
    slackChannelName,
    db,
    organizationId,
  }: {
    slackUserId: string;
    accessToken: string;
    slackOrganizationId: string;
    slackOrganizationName: string;
    slackChannelId: string;
    slackChannelName: string;
    db: PostgresJsDatabase<typeof schema>;
    organizationId: string;
  }) {
    await db
      .insert(schema.slackInstallations)
      .values({
        accessToken,
        organizationId,
        slackChannelId,
        slackChannelName,
        slackOrganizationId,
        slackOrganizationName,
        slackUserId,
      })
      .onConflictDoUpdate({
        target: [
          schema.slackInstallations.slackChannelId,
          schema.slackInstallations.organizationId,
          schema.slackInstallations.slackOrganizationId,
        ],
        set: {
          accessToken,
          slackChannelName,
          slackOrganizationId,
          slackOrganizationName,
          slackUserId,
          updatedAt: new Date(),
        },
      })
      .execute();
  }
}
