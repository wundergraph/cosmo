import { readFileSync } from 'node:fs';
import { createTransport, Transporter } from 'nodemailer';
import * as ejs from 'ejs';

interface OrganizationInviteBody {
  organizationName: string;
  inviteBody: string;
  inviteLink: string;
}

export default class Mailer {
  client: Transporter;

  constructor({ username, password }: { username: string; password: string }) {
    this.client = createTransport({
      host: 'smtp.postmarkapp.com',
      port: 587,
      // true for 465, false for other ports, will still upgrade to StartTLS
      secure: false,
      requireTLS: true, // Forces the client to use STARTTLS
      auth: {
        user: username,
        pass: password,
      },
    });
  }

  /**
   * Verify the connection to the mail server is working.
   * (Authenticates with the mail server and returns true if successful, false otherwise)
   */
  public verifyConnection() {
    return this.client.verify();
  }

  public async sendInviteEmail({
    receiverEmail,
    inviteLink,
    organizationName,
    invitedBy,
  }: {
    receiverEmail: string;
    inviteLink: string;
    organizationName: string;
    invitedBy?: string;
  }) {
    const emailBody = readFileSync('./src/templates/email/organizationInvite.html').toString('utf8');
    let inviteBody;
    if (invitedBy) {
      inviteBody = `Hello <strong>${receiverEmail}</strong>, you have been invited to the
            <strong>${organizationName}</strong> organization by <strong>${invitedBy}</strong>.`;
    } else {
      inviteBody = `Hello <strong>${receiverEmail}</strong>, you have been invited to the
            <strong>${organizationName}</strong> organization.`;
    }

    const data: OrganizationInviteBody = {
      organizationName,
      inviteLink,
      inviteBody,
    };

    const template = ejs.compile(emailBody);
    const htmlBody = template(data);

    await this.client.sendMail({
      from: 'system@wundergraph.com',
      to: receiverEmail,
      subject: `[WunderGraph Cosmo] You have been invited to the ${organizationName} organization.`,
      html: htmlBody,
    });
  }
}
