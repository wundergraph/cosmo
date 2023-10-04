import * as crypto from 'node:crypto';
import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import pino from 'pino';
import { InstallationEvent } from '@octokit/webhooks-types';
import { GitHubRepository } from '../repositories/GitHubRepository.js';

export type WebhookControllerOptions = {
  githubRepository: GitHubRepository;
  webhookSecret: string;
  logger: pino.Logger;
};

const verify = (request: any, webhookSecret: string) => {
  const signature = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(request.body)).digest('hex');
  const trusted = Buffer.from(`sha256=${signature}`, 'ascii');
  const untrusted = Buffer.from(request.headers['x-hub-signature-256'], 'ascii');
  return crypto.timingSafeEqual(trusted, untrusted);
};

const plugin: FastifyPluginCallback<WebhookControllerOptions> = function GitHubWebhook(fastify, opts, done) {
  fastify.get('/post-install', async (req, res) => {
    const query = req.query as {
      code?: string;
      installation_id?: string;
      setup_action?: 'install' | 'update';
      error?: string;
      error_description?: string;
    };

    if (query.error) {
      return res.code(400).send(`Error received from GitHub: ${query.error} (${query.error_description})`);
    }

    if (!query.code || !query.installation_id || !query.setup_action) {
      return res.code(400).send(`Not enough data`);
    }

    if (query.setup_action !== 'install') {
      return res.code(200).send(`OK`);
    }

    const resp = await opts.githubRepository.verifyAppInstall({
      code: query.code,
      installationId: Number.parseInt(query.installation_id, 10),
    });

    if (resp.error) {
      opts.logger.error(`Failed to register github installation ${resp.error}`);
      return res.code(200).send(`Cosmo could not register your installation`);
    }

    return res.code(200).send('App installed successfully');
  });

  fastify.post('/events', async (req, res) => {
    if (!verify(req, opts.webhookSecret)) {
      return res.code(403).send({ status: 'Signature mismatch' });
    }

    if (req.headers['x-github-event'] === 'installation') {
      const installationEvent = req.body as InstallationEvent;

      if (installationEvent.action === 'deleted' && installationEvent.installation.id) {
        const result = await opts.githubRepository.deleteAppInstallation(installationEvent.installation.id);

        const logger = opts.logger.child({
          installationId: installationEvent.installation.id,
        });

        if (result.error) {
          logger.error('Could not delete installation');
          return res.code(500).send();
        }

        logger.debug('Installation deleted');
      }
    }

    return res.code(200).send();
  });

  done();
};

export default fp(plugin, {
  encapsulate: true,
});
