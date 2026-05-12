import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

const createUserSchema = z.object({
  username: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

async function getCurrentAdmin() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("token")?.value;
    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: number;
      email: string;
    };

    if (decoded.email !== "admin@fleettrack.com") return null;
    return decoded;
  } catch {
    return null;   // ← handles expired/invalid token gracefully
  }
}

export async function POST(req: Request) {
  try {
    const admin = await getCurrentAdmin();

    if (!admin) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid input", errors: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { username, email, password } = parsed.data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "User already exists" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
      },
      select: {
        userId: true,
        username: true,
        email: true,
      },
    });

    return NextResponse.json(
      {
        message: "User created successfully",
        user: {
          id: String(user.userId),
          name: user.username,
          email: user.email,
          role: "USER",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create user error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      where: {
        email: {
          not: "admin@fleettrack.com",
        },
      },
      select: {
        userId: true,
        username: true,
        email: true,
      },
    });

    return NextResponse.json({
      users: users.map((user) => ({
        id: String(user.userId),
        name: user.username,
        email: user.email,
        role: "USER",
      })),
    });
  } catch (error) {
    console.error("Fetch users error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}