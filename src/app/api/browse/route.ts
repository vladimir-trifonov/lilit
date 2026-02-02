/**
 * Browse for a folder using the native OS file picker.
 * macOS: osascript, Linux: zenity
 */

import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { platform } from "os";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const os = platform();
    let selected: string;

    if (os === "darwin") {
      selected = execSync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select project directory")'`,
        { timeout: 60_000, encoding: "utf-8" },
      ).trim();
    } else if (os === "linux") {
      selected = execSync(
        `zenity --file-selection --directory --title="Select project directory" 2>/dev/null`,
        { timeout: 60_000, encoding: "utf-8" },
      ).trim();
    } else {
      return NextResponse.json(
        { error: "Folder picker not supported on this OS" },
        { status: 400 },
      );
    }

    if (!selected) {
      return NextResponse.json({ cancelled: true });
    }

    // Remove trailing slash if present
    const cleanPath = selected.replace(/\/+$/, "");

    return NextResponse.json({ path: cleanPath });
  } catch {
    // User cancelled the dialog or command failed
    return NextResponse.json({ cancelled: true });
  }
}
