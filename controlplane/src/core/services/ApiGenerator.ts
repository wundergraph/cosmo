import { uid } from 'uid/secure';

export class ApiKeyGenerator {
  public static generate(): string {
    return `cosmo_${uid(32)}`;
  }
}
