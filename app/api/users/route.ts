import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_EMAIL, forbidden, getSession, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  username: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(150),
  password: z.string().min(6),
  company: z.string().trim().max(150).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();

  try {
    const parsed = createUserSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid input", errors: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { username, email, password, company } = parsed.data;

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      return NextResponse.json({ message: "User already exists" }, { status: 409 });
    }

    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        company: company || null,
      },
      select: { userId: true, username: true, email: true, company: true },
    });

    return NextResponse.json(
      {
        message: "User created successfully",
        user: {
          id: String(user.userId),
          name: user.username,
          email: user.email,
          company: user.company,
          role: "USER",
          trackers: [],
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create user error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// Admin: every customer with the trackers assigned to them.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();

  try {
    const users = await prisma.user.findMany({
      where: { email: { not: ADMIN_EMAIL } },
      select: {
        userId: true,
        username: true,
        email: true,
        company: true,
        trackers: {
          select: { trackerId: true, name: true, licensePlate: true },
          orderBy: { trackerId: "asc" },
        },
      },
      orderBy: { userId: "asc" },
    });

    return NextResponse.json({
      users: users.map((user) => ({
        id: String(user.userId),
        name: user.username,
        email: user.email,
        company: user.company,
        role: "USER",
        trackers: user.trackers,
      })),
    });
  } catch (error) {
    console.error("Fetch users error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
