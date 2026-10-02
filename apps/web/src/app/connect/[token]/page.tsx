import type { Metadata } from "next";

import { ConnectLink } from "@modules/connect/connect-link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect your tracker",
  robots: { index: false, follow: false },
};

export default async function ConnectLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConnectLink token={token} />;
}
