import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth";
import {
  FIRMWARE_VERSION_PATTERN,
  MAX_FIRMWARE_BYTES,
  listFirmwareReleases,
} from "@/lib/firmware";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();
  return null;
}

// Admin: uploaded firmware images, newest version first.
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const releases = await listFirmwareReleases();
    return NextResponse.json({
      success: true,
      releases: releases.map((r) => ({
        version: r.version,
        filename: r.filename,
        size: r.size,
        sha256: r.sha256,
        uploadedAt: r.uploadedAt,
      })),
    });
  } catch (error) {
    console.error("List firmware error:", error);
    return NextResponse.json({ message: "Failed to load firmware" }, { status: 500 });
  }
}

// Admin: POST /api/firmware?version=3.6.3 with the raw .bin as the body.
export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const version = (url.searchParams.get("version") || "").trim();
    const force = url.searchParams.get("force") === "1";

    if (!FIRMWARE_VERSION_PATTERN.test(version)) {
      return NextResponse.json(
        { message: "Version must be three numbers, e.g. 3.6.3" },
        { status: 400 }
      );
    }

    const image = Buffer.from(await req.arrayBuffer());

    if (image.length === 0) {
      return NextResponse.json({ message: "Empty upload" }, { status: 400 });
    }
    if (image.length > MAX_FIRMWARE_BYTES) {
      return NextResponse.json(
        {
          message:
            "File is larger than one OTA slot allows (1,200 KB). Upload <sketch>.ino.bin, not the merged .bin.",
        },
        { status: 413 }
      );
    }
    // Every ESP32 application image starts with the magic byte 0xE9.
    if (image[0] !== 0xe9) {
      return NextResponse.json(
        { message: "This is not an ESP32 application image (.ino.bin)." },
        { status: 400 }
      );
    }
    // FW_VERSION is a string inside the image. If the label typed here differs
    // from it, the tracker reinstalls the same image at every check.
    if (!force && !image.includes(Buffer.from(version, "ascii"))) {
      return NextResponse.json(
        {
          code: "VERSION_NOT_IN_IMAGE",
          message: `"${version}" was not found inside this file. The version must equal FW_VERSION in the sketch it was built from.`,
        },
        { status: 422 }
      );
    }

    const filename = `firmware-${version}.bin`;
    const sha256 = crypto.createHash("sha256").update(image).digest("hex");

    const release = { filename, size: image.length, sha256, data: image, uploadedAt: new Date() };
    await prisma.firmwareRelease.upsert({
      where: { version },
      create: { version, ...release },
      update: release,
    });

    return NextResponse.json({ success: true, version, filename, size: image.length, sha256 });
  } catch (error) {
    console.error("Upload firmware error:", error);
    return NextResponse.json({ message: "Failed to store firmware" }, { status: 500 });
  }
}

// Admin: DELETE /api/firmware?version=3.6.3
export async function DELETE(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const version = new URL(req.url).searchParams.get("version") || "";
    await prisma.firmwareRelease.deleteMany({ where: { version } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete firmware error:", error);
    return NextResponse.json({ message: "Failed to delete firmware" }, { status: 500 });
  }
}
