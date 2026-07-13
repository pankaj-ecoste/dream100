// GET /api/zoho/users — powers the signup page's salesperson dropdown.
// Called pre-auth (signup happens before a session exists), so this
// route is intentionally unauthenticated: it only returns internal
// staff names/emails from Zoho, nothing about clients or accounts.
import { NextResponse } from "next/server";
import { getZohoUsers } from "@/lib/zoho";

export async function GET() {
  try {
    const users = await getZohoUsers();
    return NextResponse.json({ users });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("GET /api/zoho/users FAILED:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
