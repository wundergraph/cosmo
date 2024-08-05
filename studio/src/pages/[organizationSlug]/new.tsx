import { CreateGraphForm } from "@/components/create-graph";
import { FullscreenLayout } from "@/components/layout/fullscreen-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NextPageWithLayout } from "@/lib/page";
import { HomeIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useState } from "react";

const NewGraphPage: NextPageWithLayout = () => {
  const [isMonograph, setIsMonograph] = useState(false);

  return (
    <div>
      <div className="flex h-16 items-center border-b px-4 lg:px-8">
        <Button asChild variant="outline">
          <Link href="/">
            <HomeIcon className="mr-2" /> Home
          </Link>
        </Button>
      </div>
      <div className="mx-auto my-8 max-w-screen-sm px-4 md:px-0">
        <Tabs
          onValueChange={(v) => {
            setIsMonograph(v !== "federated");
          }}
          defaultValue="federated"
          className="mb-4 w-max"
        >
          <TabsList>
            <TabsTrigger value="federated">Federated Graph</TabsTrigger>
            <TabsTrigger value="monograph">Monograph</TabsTrigger>
          </TabsList>
        </Tabs>
        <Card>
          <CardHeader>
            <CardTitle>
              {isMonograph ? "Create Monograph" : "Create Federated Graph"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CreateGraphForm isMonograph={isMonograph} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

NewGraphPage.getLayout = (page) => {
  return <FullscreenLayout>{page}</FullscreenLayout>;
};

export default NewGraphPage;
