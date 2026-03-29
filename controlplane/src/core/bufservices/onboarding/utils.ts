import { OnboardingDTO } from '../../../types/index.js';

export function serializeOnboardingDTO(dto: OnboardingDTO) {
  return {
    ...dto,
    createdAt: dto.createdAt.toISOString(),
    finishedAt: dto.finishedAt?.toISOString() ?? '',
    updatedAt: dto.updatedAt?.toISOString() ?? '',
    federatedGraphId: dto.federatedGraphId ?? '',
  };
}
