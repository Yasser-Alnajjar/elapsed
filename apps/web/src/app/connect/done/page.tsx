import type { Metadata } from "next";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Connected",
  robots: { index: false, follow: false },
};

export default function ConnectDonePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>You are done</CardTitle>
          <CardDescription>
            The connection is saved and this link no longer works. You can close this tab.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
