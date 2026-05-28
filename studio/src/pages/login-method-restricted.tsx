import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthLayout } from '@/components/layout/auth-layout';
import { LogoutLink } from '@/components/user-menu';
import { NextPageWithLayout } from '@/lib/page';
import { cn } from '@/lib/utils';
import { PiLockKey } from 'react-icons/pi';

const LoginMethodRestrictedPage: NextPageWithLayout = () => {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center pb-4 text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full border bg-muted/50">
            <PiLockKey className="size-6 text-muted-foreground" />
          </div>
          <CardTitle>Login method not allowed</CardTitle>
          <CardDescription className="text-balance">
            None of your organizations can be accessed with your current login method. Sign in with a different method
            to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LogoutLink className={cn(buttonVariants(), 'w-full')}>Sign in with a different method</LogoutLink>
        </CardContent>
      </Card>
    </div>
  );
};

LoginMethodRestrictedPage.getLayout = (page) => {
  return <AuthLayout>{page}</AuthLayout>;
};

export default LoginMethodRestrictedPage;
