import { JWTPayload } from 'jose';
import { verifyJwt } from '../crypto/jwt.js';

export type GraphKeyAuthContext = {
  organizationId: string;
  federatedGraphId: string;
};

export interface GraphApiJwtPayload extends JWTPayload {
  organization_id: string;
  federated_graph_id: string;
}

export default class GraphApiTokenAuthenticator {
  constructor(private jwtSecret: string) {}

  public async authenticate(jwt: string): Promise<GraphKeyAuthContext> {
    const jwtPayload = await verifyJwt<GraphApiJwtPayload>(this.jwtSecret, jwt);

    if (!jwtPayload) {
      throw new Error('Invalid graph api token');
    }

    return {
      organizationId: jwtPayload.organization_id,
      federatedGraphId: jwtPayload.federated_graph_id,
    };
  }
}
