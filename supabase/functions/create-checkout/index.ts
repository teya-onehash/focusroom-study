import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@^22";
import { createClient } from "npm:@supabase/supabase-js@^2";
import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";

type PlanKey = "basic_month" | "premium_month" | "premium_year" | "buddy_month";

const planPrices: Record<PlanKey, string | undefined> = {
  basic_month: Deno.env.get("STRIPE_PRICE_BASIC_MONTH"),
  premium_month: Deno.env.get("STRIPE_PRICE_PREMIUM_MONTH"),
  premium_year: Deno.env.get("STRIPE_PRICE_PREMIUM_YEAR"),
  buddy_month: Deno.env.get("STRIPE_PRICE_BUDDY_MONTH"),
};

const terminalStatuses = new Set(["canceled", "incomplete_expired"]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Stripe checkout is missing required server configuration.");
    return json({ error: "Billing is not configured yet. No payment was taken." }, 503);
  }

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Please log in before choosing a plan." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userResult = await admin.auth.getUser(token);
  const user = userResult.data.user;
  if (userResult.error || !user) return json({ error: "Your session expired. Please log in again." }, 401);

  let payload: { plan?: string } = {};
  try { payload = await req.json(); } catch { return json({ error: "Invalid checkout request." }, 400); }
  const plan = String(payload.plan || "") as PlanKey;
  if (!Object.prototype.hasOwnProperty.call(planPrices, plan)) return json({ error: "That membership option is unavailable." }, 400);
  const price = planPrices[plan];
  if (!price) {
    console.error(`Stripe price is not configured for ${plan}.`);
    return json({ error: "That membership option is not ready yet. No payment was taken." }, 503);
  }

  const existingResult = await admin.from("subscriptions")
    .select("stripe_customer_id,status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingResult.error) {
    console.error("Subscription lookup failed", existingResult.error);
    return json({ error: "We could not check your membership. Please try again." }, 500);
  }
  const existing = existingResult.data;
  if (existing && !terminalStatuses.has(existing.status)) {
    return json({ error: "You already have a Stripe membership. Use Manage billing to change it." }, 409);
  }

  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://joinfocusroomlive.live").replace(/\/$/, "");
  const stripe = new Stripe(stripeSecret);
  try {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      allow_promotion_codes: true,
      success_url: `${siteUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/?billing=cancelled`,
      metadata: { mellow_app: "mellow_commons", supabase_user_id: user.id, plan_key: plan },
      subscription_data: { metadata: { mellow_app: "mellow_commons", supabase_user_id: user.id, plan_key: plan } },
    };
    if (existing?.stripe_customer_id) params.customer = existing.stripe_customer_id;
    else if (user.email) params.customer_email = user.email;

    const session = await stripe.checkout.sessions.create(params);
    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    return json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout session creation failed", error);
    return json({ error: "Secure checkout could not start. No payment was taken." }, 502);
  }
});
