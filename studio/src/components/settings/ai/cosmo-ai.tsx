import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { FaMagic } from 'react-icons/fa';
import { PtQSegment } from './ptq-segment';
import { CosmoAiSegment } from './cosmo-ai-segment';

export function CosmoAi() {
  const organization = useCurrentOrganization();
  if (!organization) {
    return null;
  }

  return (
    <Card className="pb-3">
      <CardHeader className="px-6 pt-6">
        <CardTitle className="flex items-center gap-x-2">
          <FaMagic />
          <span>Cosmo AI</span>
          <Badge variant="outline">Beta</Badge>
        </CardTitle>
      </CardHeader>

      <CosmoAiSegment organization={organization} />
      <PtQSegment organization={organization} />
    </Card>
  );
}
