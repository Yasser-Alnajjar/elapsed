import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createConnectLink,
  getPrismaClient,
  listActiveConnectLinks,
  revokeConnectLink,
  CONNECT_LINK_PROVIDERS,
} from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { connectLinkUrl } from "@/lib/connect-link";

const createSchema = z.object({
  provider: z.enum(CONNECT_LINK_PROVIDERS),
  intendedFor: z.string().trim().max(120).optional(),
});

/** Owner-only: list the organization's unused, unexpired connect links (never the tokens). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;
  const links = await listActiveConnectLinks(getPrismaClient(), session.user.organizationId);
  return NextResponse.json({ links });
}

/** Owner-only: mint a link. The URL is returned once; only its hash is stored. */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const link = await createConnectLink(getPrismaClient(), {
    organizationId: session.user.organizationId,
    provider: parsed.data.provider,
    intendedFor: parsed.data.intendedFor,
    createdByUserId: session.user.id,
  });
  return NextResponse.json({ id: link.id, url: connectLinkUrl(link.token), expiresAt: link.expiresAt }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const ok = await revokeConnectLink(getPrismaClient(), session.user.organizationId, id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
