import fp from 'fastify-plugin';
import { FastifyPluginCallback } from 'fastify';

const plugin: FastifyPluginCallback = function HealthPlugin(fastify, opts, done) {
  let shutdown = false;

  fastify.addHook('onClose', (instance, done) => {
    fastify.log.debug('Return 503 for health checks because server is shutting down.');
    shutdown = true;
    done();
  });

  fastify.get('/health', (req, res) => {
    // Specific to GKE container native load balancing.
    // Configure Pods to begin failing health checks when they receive SIGTERM.
    // This signals the load balancer to stop sending traffic to the Pod while endpoint deprogramming is in progress.
    // See https://cloud.google.com/kubernetes-engine/docs/how-to/container-native-load-balancing#scale-to-zero_workloads_interruption
    if (shutdown) {
      res.code(503).send();
      return;
    }
    res.code(200).send();
  });

  done();
};

export default fp(plugin);
