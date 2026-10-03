import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_EMAIL, forbidden, getSession, unauthorized } from "@/lib/auth";
import { MIN_DEVICE_TOKEN_LENGTH, hashDeviceToken } from "@/lib/deviceAuth";
import { generatePassword, hashPassword } from "@/lib/passwords";
import { listTrackers } from "@/lib/trackers";

export const dynamic = "force-dynamic";

const createTrackerSchema = z.object({
  // Must equal DEVICE_ID in the firmware.
  trackerId: z.string().trim().min(2).max(100),
  // Must equal AUTH_TOKEN in the firmware.
  secretToken: z.string().trim().min(MIN_DEVICE_TOKEN_LENGTH).max(200),
  name: z.string().trim().min(1).max(100),
  licensePlate: z.string().trim().max(50).optional(),
  customerEmail: z.string().trim().toLowerCase().email().max(150),
  customerName: z.string().trim().max(100).optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    return NextResponse.json({ trackers: await listTrackers(session) });
  } catch (error) {
    console.error("Fetch trackers error:", error);
    return NextResponse.json({ message: "Failed to fetch trackers" }, { status: 500 });
  }
}

// Admin registers a device for a customer. If no account exists for the
// customer's email, one is created with a generated password, returned once
// in the response so the admin can hand it over.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();

  try {
    const parsed = createTrackerSchema.safeParse(await req.json());

    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      const message = fields.secretToken
        ? `Device token must be at least ${MIN_DEVICE_TOKEN_LENGTH} characters`
        : fields.customerEmail
          ? "Enter a valid customer email"
          : "Tracker ID, vehicle name, device token and customer email are required";
      return NextResponse.json({ message, errors: fields }, { status: 400 });
    }

    const { trackerId, secretToken, name, licensePlate, customerEmail, customerName } = parsed.data;

    if (customerEmail === ADMIN_EMAIL) {
      return NextResponse.json(
        { message: "Use the customer's email, not the admin account" },
        { status: 400 }
      );
    }

    const existingTracker = await prisma.tracker.findUnique({ where: { trackerId } });
    if (existingTracker) {
      return NextResponse.json({ message: "A tracker with this ID already exists" }, { status: 409 });
    }

    let user = await prisma.user.findUnique({ where: { email: customerEmail } });
    let generatedPassword: string | null = null;

    if (!user) {
      if (!customerName) {
        return NextResponse.json(
          {
            code: "CUSTOMER_NAME_REQUIRED",
            message: "No customer has this email yet. Enter the customer's name to create the account.",
          },
          { status: 400 }
        );
      }

      generatedPassword = generatePassword();
      user = await prisma.user.create({
        data: {
          username: customerName,
          email: customerEmail,
          passwordHash: await hashPassword(generatedPassword),
        },
      });
    }

    await prisma.tracker.create({
      data: {
        trackerId,
        userId: user.userId,
        secretTokenHash: await hashDeviceToken(secretToken),
        name,
        licensePlate: licensePlate || null,
        status: "ACTIVE",
      },
    });

    return NextResponse.json(
      {
        message: "Tracker created successfully",
        tracker: { trackerId, name, licensePlate: licensePlate || null },
        customer: {
          id: String(user.userId),
          name: user.username,
          email: user.email,
          created: generatedPassword !== null,
          password: generatedPassword,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create tracker error:", error);
    return NextResponse.json({ message: "Failed to create tracker" }, { status: 500 });
  }
}
