import { createClient } from "npm:@supabase/supabase-js@2";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

type JsonRecord = Record<string, unknown>;

function corsHeaders(origin: string) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  return headers;
}

function jsonResponse(
  status: number,
  body: JsonRecord,
  headers: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    allowedOrigins.length === 0 ||
    allowedOrigins.some((value) => {
      try {
        const parsed = new URL(value);
        return !["http:", "https:"].includes(parsed.protocol) ||
          parsed.origin !== value;
      } catch {
        return true;
      }
    })
  ) {
    return jsonResponse(500, { error: "server_configuration_error" }, {});
  }

  const appUrl = Deno.env.get("APP_URL")?.trim() ?? "";
  let validAppUrl = false;
  try {
    const parsedAppUrl = new URL(appUrl);
    validAppUrl = parsedAppUrl.protocol === "https:" &&
      parsedAppUrl.origin === appUrl &&
      allowedOrigins.includes(appUrl);
  } catch {
    validAppUrl = false;
  }
  if (!validAppUrl) {
    return jsonResponse(500, { error: "server_configuration_error" }, {});
  }

  if (origin === null || !allowedOrigins.includes(origin)) {
    return jsonResponse(403, { error: "origin_not_allowed" }, {});
  }
  const headers = corsHeaders(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" }, headers);
  }

  try {
    const authorization = request.headers.get("authorization") ?? "";
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);
    if (!bearer) {
      return jsonResponse(401, { error: "missing_or_invalid_bearer_token" }, headers);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(500, { error: "server_configuration_error" }, headers);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(bearer[1]);
    if (authError || !authData.user) {
      return jsonResponse(401, { error: "invalid_or_expired_token" }, headers);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data: profile, error: profileError } = await adminClient
      .from("user_profiles")
      .select("role")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      return jsonResponse(500, { error: "role_lookup_failed" }, headers);
    }
    if (profile?.role !== "admin") {
      return jsonResponse(403, { error: "admin_role_required" }, headers);
    }

    if (
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
        "application/json"
    ) {
      return jsonResponse(415, { error: "content_type_must_be_json" }, headers);
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 8192) {
      return jsonResponse(413, { error: "request_body_too_large" }, headers);
    }

    let payload: unknown;
    try {
      const requestText = await request.text();
      if (new TextEncoder().encode(requestText).byteLength > 8192) {
        return jsonResponse(413, { error: "request_body_too_large" }, headers);
      }
      payload = JSON.parse(requestText);
    } catch {
      return jsonResponse(400, { error: "invalid_json" }, headers);
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      return jsonResponse(400, { error: "request_body_must_be_an_object" }, headers);
    }

    const body = payload as JsonRecord;
    if (Object.keys(body).some((key) => key !== "email")) {
      return jsonResponse(400, { error: "only_email_is_allowed" }, headers);
    }
    if (typeof body.email !== "string") {
      return jsonResponse(400, { error: "email_must_be_a_string" }, headers);
    }
    const email = body.email.trim();
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return jsonResponse(400, { error: "invalid_email" }, headers);
    }

    // The role is intentionally fixed here; callers cannot invite admins or choose roles.
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin
      .inviteUserByEmail(email, { redirectTo: `${appUrl}/admin.html` });
    if (inviteError || !inviteData.user) {
      const errorCode = (inviteError as { code?: string } | null)?.code;
      if (errorCode === "email_exists" || errorCode === "user_already_exists") {
        return jsonResponse(409, { error: "email_already_registered" }, headers);
      }
      return jsonResponse(502, { error: "invitation_failed" }, headers);
    }

    const invitedUserId = inviteData.user.id;
    const { data: invitedProfile, error: invitedProfileError } = await adminClient
      .from("user_profiles")
      .select("user_id,email,role")
      .eq("user_id", invitedUserId)
      .maybeSingle();

    if (invitedProfileError) {
      return jsonResponse(500, { error: "invited_profile_lookup_failed" }, headers);
    }
    if (invitedProfile?.role === "admin") {
      return jsonResponse(409, { error: "cannot_invite_an_existing_admin" }, headers);
    }
    if (invitedProfile?.role === "pending") {
      const { data: promotedProfile, error: promoteError } = await adminClient
        .from("user_profiles")
        .update({ email: inviteData.user.email ?? email, role: "owner" })
        .eq("user_id", invitedUserId)
        .eq("role", "pending")
        .select("user_id")
        .maybeSingle();
      if (promoteError) {
        return jsonResponse(500, { error: "owner_profile_activation_failed" }, headers);
      }
      if (!promotedProfile) {
        const { data: currentProfile, error: currentProfileError } = await adminClient
          .from("user_profiles")
          .select("role")
          .eq("user_id", invitedUserId)
          .maybeSingle();
        if (currentProfileError) {
          return jsonResponse(500, { error: "invited_profile_lookup_failed" }, headers);
        }
        if (currentProfile?.role === "admin") {
          return jsonResponse(409, { error: "cannot_invite_an_existing_admin" }, headers);
        }
        if (currentProfile?.role !== "owner") {
          return jsonResponse(500, { error: "owner_profile_activation_failed" }, headers);
        }
      }
    } else if (!invitedProfile) {
      const { error: insertProfileError } = await adminClient
        .from("user_profiles")
        .insert({
          user_id: invitedUserId,
          email: inviteData.user.email ?? email,
          role: "owner",
        });
      if (insertProfileError) {
        return jsonResponse(500, { error: "owner_profile_creation_failed" }, headers);
      }
    } else if (invitedProfile.role !== "owner") {
      return jsonResponse(500, { error: "invited_profile_has_invalid_role" }, headers);
    }

    return jsonResponse(201, {
      ok: true,
      invited: { user_id: invitedUserId, email: inviteData.user.email ?? email },
    }, headers);
  } catch (error) {
    console.error(
      "invite-owner: unexpected failure",
      error instanceof Error ? error.name : "UnknownError",
    );
    return jsonResponse(500, { error: "internal_server_error" }, headers);
  }
});
