
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ADMIN_EMAIL,
  forbidden,
  getSession,
  unauthorized,
} from '@/lib/auth';
import {
  MIN_DEVICE_TOKEN_LENGTH,
  hashDeviceToken,
} from '@/lib/deviceAuth';
import { hashPassword } from '@/lib/passwords';
import { listTrackers } from '@/lib/trackers';

export const dynamic = 'force-dynamic';

const createTrackerSchema = z.object({
  trackerId: z.string().trim().min(2).max(100),
  secretToken: z
    .string()
    .trim()
    .min(MIN_DEVICE_TOKEN_LENGTH)
    .max(200),
  name: z.string().trim().min(1).max(100),
  licensePlate: z.string().trim().max(50).optional(),
  customerMode: z.enum(['existing', 'new']),
  customerId: z.number().int().positive().optional(),
  customerName: z.string().trim().min(2).max(100).optional(),
  customerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(150)
    .optional(),
  customerPassword: z.string().min(8).max(128).optional(),
  customerCompany: z.string().trim().max(150).optional(),
}).superRefine((data, ctx) => {
  if (data.customerMode === 'existing' && !data.customerId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customerId'],
      message: 'Select an existing customer',
    });
  }

  if (data.customerMode === 'new') {
    if (!data.customerName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerName'],
        message: 'Enter customer name',
      });
    }

    if (!data.customerEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerEmail'],
        message: 'Enter a valid email',
      });
    }

    if (!data.customerPassword || data.customerPassword.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerPassword'],
        message: 'Enter a password of at least 8 characters',
      });
    }
  }
});

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    return NextResponse.json({
      trackers: await listTrackers(session),
    });
  } catch (error) {
    console.error('Fetch trackers error:', error);
    return NextResponse.json(
      { message: 'Failed to fetch trackers' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid JSON' },
      { status: 400 }
    );
  }

  const parsed = createTrackerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: 'Check the device and customer fields',
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const d = parsed.data;

  if (
    d.customerMode === 'new' &&
    d.customerEmail === ADMIN_EMAIL.toLowerCase()
  ) {
    return NextResponse.json(
      {
        message:
          'The administrator email cannot be used as a customer account',
      },
      { status: 400 }
    );
  }

  try {
    const deviceHash = await hashDeviceToken(d.secretToken);

    const passwordHash =
      d.customerMode === 'new'
        ? await hashPassword(d.customerPassword!)
        : null;

    const result = await prisma.$transaction(async (tx) => {
      let user;
      let created = false;

      if (d.customerMode === 'existing') {
        user = await tx.user.findUnique({
          where: { userId: d.customerId! },
        });

        if (
          !user ||
          user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
        ) {
          throw new Error('CUSTOMER_NOT_FOUND');
        }
      } else {
        const existing = await tx.user.findUnique({
          where: { email: d.customerEmail! },
        });

        if (existing) {
          throw new Error('CUSTOMER_EXISTS');
        }

        user = await tx.user.create({
          data: {
            username: d.customerName!,
            email: d.customerEmail!,
            passwordHash: passwordHash!,
            company: d.customerCompany || null,
          },
        });

        created = true;
      }

      const tracker = await tx.tracker.create({
        data: {
          trackerId: d.trackerId,
          userId: user.userId,
          secretTokenHash: deviceHash,
          name: d.name,
          licensePlate: d.licensePlate || null,
          status: 'ACTIVE',
        },
      });

      return { tracker, user, created };
    });

    return NextResponse.json(
      {
        message: 'Device registered successfully',
        tracker: {
          trackerId: result.tracker.trackerId,
          name: result.tracker.name,
          licensePlate: result.tracker.licensePlate,
        },
        customer: {
          id: String(result.user.userId),
          name: result.user.username,
          email: result.user.email,
          created: result.created,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error?.message === 'CUSTOMER_NOT_FOUND') {
      return NextResponse.json(
        { message: 'Selected customer no longer exists' },
        { status: 404 }
      );
    }

    if (error?.message === 'CUSTOMER_EXISTS') {
      return NextResponse.json(
        {
          message:
            'This email already belongs to a customer. Choose Existing Customer.',
        },
        { status: 409 }
      );
    }

    if (error?.code === 'P2002') {
      return NextResponse.json(
        { message: 'Tracker ID or customer email already exists' },
        { status: 409 }
      );
    }

    console.error('Create tracker error:', error);

    return NextResponse.json(
      { message: 'Failed to register device' },
      { status: 500 }
    );
  }
}
