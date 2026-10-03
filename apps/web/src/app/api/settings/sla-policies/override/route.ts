import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import { overridePolicyTargets, PolicyNotFoundError } from "@sla/commitments";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { parseTargets, ValidationError } from "@/lib/sla-policy-validation";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { policyId?: unknown; targets?: unknown } | null;
  const policyId = body?.policyId;

  if (!policyId || typeof policyId !== "string") {
    return NextResponse.json({ error: "policyId is required" }, { status: 400 });
  }

  const prisma = getPrismaClient();
  try {
    const targets = parseTargets(body?.targets);
    const result = await overridePolicyTargets(prisma, session.user.organizationId, policyId, targets);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof PolicyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
