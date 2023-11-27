import { readFileSync } from 'node:fs';
import * as postmark from 'postmark';
import * as ejs from 'ejs';

interface OrganizationInviteBody {
  organizationName: string;
  email: string;
  inviteLink: string;
}

export default class Postmark {
  client: postmark.ServerClient;

  constructor(serverToken: string) {
    this.client = new postmark.ServerClient(serverToken);
  }

  public async sendInviteEmail({
    recieverEmail,
    inviteLink,
    organizationName,
  }: {
    recieverEmail: string;
    inviteLink: string;
    organizationName: string;
  }) {
    const emailBody = readFileSync('./src/resources/organizationInvite.html').toString('utf8');
    const data: OrganizationInviteBody = {
      organizationName,
      email: recieverEmail,
      inviteLink,
    };

    const template = ejs.compile(emailBody);
    const htmlBody = template(data);

    await this.client.sendEmail({
      From: 'system@wundergraph.com',
      To: recieverEmail,
      Subject: '[WunderGraph Cosmo] You are invited to join' + organizationName,
      HtmlBody: htmlBody,
      TrackOpens: true,
    });
  }
}
