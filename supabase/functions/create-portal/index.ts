import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@^22";
import { createClient } from "npm:@supabase/supabase-js@^2";
import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";

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
    console.error("Stripe portal is missing required server configuration.");
    return json({ error: "Billing management is not configured yet." }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Please log in to manage billing." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userResult = await admin.auth.getUser(token);
  const user = userResult.data.user;
  if (userResult.error || !user) return json({ error: "Your session expired. Please log in again." }, 401);

  const subscriptionResult = await admin.from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (subscriptionResult.error) {
    console.error("Subscription lookup failed", subscriptionResult.error);
    return json({ error: "We could not load your billing account." }, 500);
  }
  const customer = subscriptionResult.data?.stripe_customer_id;
  if (!customer) return json({ error: "No Stripe billing account is connected to this membership." }, 404);

  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://joinfocusroomlive.live").replace(/\/$/, "");
  const stripe = new Stripe(stripeSecret);
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${siteUrl}/?billing=portal`,
    });
    return json({ url: session.url });
  } catch (error) {
    console.error("Stripe portal session creation failed", error);
    return json({ error: "Billing management could not open. Please try again." }, 502);
  }
});
