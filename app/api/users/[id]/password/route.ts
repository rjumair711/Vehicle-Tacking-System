import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth";
import { generatePassword, hashPassword } from "@/lib/passwords";

export const dynamic = "force-dynamic";

// Admin: give a customer who forgot their password a new generated one. It
// is returned once; the customer can then change it in Settings.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();

  try {
    const { id } = await params;
    const userId = Number(id);

    if (!Number.isInteger(userId) || userId === session.userId) {
      return NextResponse.json({ message: "Invalid user ID" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) {
      return NextResponse.json({ message: "Customer not found" }, { status: 404 });
    }

    const password = generatePassword();
    await prisma.user.update({
      where: { userId },
      data: { passwordHash: await hashPassword(password) },
    });

    return NextResponse.json({ success: true, email: user.email, password });
  } catch (error) {
    console.error("Generate password error:", error);
    return NextResponse.json({ message: "Failed to generate a new password" }, { status: 500 });
  }
}
