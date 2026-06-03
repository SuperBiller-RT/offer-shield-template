import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { sql, migrate } from "@/lib/cdp/db";
import { emailIsSuperadminReserved } from "@/lib/cdp/auth";

export const runtime = "nodejs";

// Public endpoint — does not require auth. Anti-enumeration: same 401 message
// whether the email is unknown, the user has no key on file, or the key
// doesn't match. Timing equalised by always running a bcrypt round.
const DUMMY_BCRYPT = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function normalizeKey(input: string): string {
  return (input || "").toUpperCase().replace(/[^0-9A-F]/g, "");
}

export async function POST(req: Request) {
  await migrate();
  let body: { email?: string; recoveryKey?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const recoveryKey = normalizeKey(body.recoveryKey || "");
  const newPassword = body.newPassword || "";

  if (!email || !recoveryKey || !newPassword) {
    return NextResponse.json({ ok: false, error: "Email, recovery key, and new password are all required" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ ok: false, error: "New password must be at least 8 characters" }, { status: 400 });
  }
  if (recoveryKey.length !== 16) {
    return NextResponse.json({ ok: false, error: "Recovery key looks invalid. Check the format your admin gave you." }, { status: 400 });
  }

  // Superadmin emails are reserved for /super-login on the admin app — never
  // resettable as a product-app account. Burn a bcrypt round on the dummy
  // hash so timing matches the unknown-email path.
  if (await emailIsSuperadminReserved(email)) {
    await bcrypt.compare(recoveryKey, DUMMY_BCRYPT);
    return NextResponse.json(
      { ok: false, error: "Email or recovery key is incorrect." },
      { status: 401 },
    );
  }

  const rows = (await sql`
    SELECT id, email, recovery_key_hash
    FROM cdp_users WHERE email = ${email}
  `) as Array<{ id: string; email: string; recovery_key_hash: string | null }>;

  const stored = rows[0]?.recovery_key_hash ?? null;
  const matches = await bcrypt.compare(recoveryKey, stored || DUMMY_BCRYPT);

  if (!rows.length || !stored || !matches) {
    return NextResponse.json(
      { ok: false, error: "Email or recovery key is incorrect." },
      { status: 401 },
    );
  }

  const user = rows[0];
  const newHash = await bcrypt.hash(newPassword, 10);

  await sql`UPDATE cdp_users SET password_hash = ${newHash} WHERE id = ${user.id}`;
  // Kill every existing session so the old password can't be replayed from
  // any other device.
  await sql`UPDATE cdp_auth_sessions SET revoked_at = NOW() WHERE user_id = ${user.id} AND revoked_at IS NULL`;

  // Best-effort audit row. Schema mirrored from admin so missing table is
  // never a hard failure.
  try {
    await sql`
      INSERT INTO cdp_admin_actions (admin_user_id, admin_email, action, target_user_id, before_state, after_state)
      VALUES (${user.id}, ${user.email}, ${"reset_password_with_recovery_key"}, ${user.id},
              ${JSON.stringify({ via: "offer_shield" })}::jsonb,
              ${JSON.stringify({ password_rotated: true })}::jsonb)
    `;
  } catch {
    // No-op — audit table may not exist on a fresh DB.
  }

  return NextResponse.json({ ok: true });
}
