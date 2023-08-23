import { uid } from 'uid';

export class ApiKeyGenerator {
  public static generate(): string {
    return `cosmo_${uid(32)}`;
  }
}
