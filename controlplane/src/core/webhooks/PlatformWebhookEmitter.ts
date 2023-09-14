import axios from 'axios';

interface GraphMigrate {
  id?: string;
  name?: string;
  actorID?: string;
}

interface UserRegister {
  id: string;
  email: string;
}

interface EventMap {
  'user.register.success': UserRegister;
  'graph.migrate.init': GraphMigrate;
  'graph.migrate.success': GraphMigrate;
}

export type EventType<T extends keyof EventMap> = {
  name: T;
  data: EventMap[T];
};

export class PlatformWebhookEmitter {
  private url: string;
  private key: string;

  constructor(webhookURL = '', webhookKey = '') {
    this.url = webhookURL;
    this.key = webhookKey;
  }

  send<T extends keyof EventMap>(eventName: T, data: EventMap[T]) {
    if (!this.url) {
      return;
    }

    axios
      .post(
        this.url,
        {
          event: eventName,
          payload: data,
        },
        {
          headers: {
            'x-cosmo-webhook-key': this.key,
          },
        },
      )
      .catch((e) => {});
  }
}
