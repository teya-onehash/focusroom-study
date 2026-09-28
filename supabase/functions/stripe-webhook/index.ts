import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@^22";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@^2";

type Plan = { tier: "basic" | "premium" | "buddy"; interval: "month" | "year" };

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function pricePlans() {
  const configured: Array<[string | undefined, Plan]> = [
    [Deno.env.get("STRIPE_PRICE_BASIC_MONTH"), { tier: "basic", interval: "month" }],
    [Deno.env.get("STRIPE_PRICE_PREMIUM_MONTH"), { tier: "premium", interval: "month" }],
    [Deno.env.get("STRIPE_PRICE_PREMIUM_YEAR"), { tier: "premium", interval: "year" }],
    [Deno.env.get("STRIPE_PRICE_BUDDY_MONTH"), { tier: "buddy", interval: "month" }],
  ];
  return new Map(configured.filter((entry): entry is [string, Plan] => Boolean(entry[0])));
}

function validUserId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function storedUserId(admin: SupabaseClient, subscription: Stripe.Subscription) {
  const metadataUser = subscription.metadata?.supabase_user_id;
  if (validUserId(metadataUser)) return metadataUser;

  const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  const bySubscription = await admin.from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  if (bySubscription.data?.user_id) return bySubscription.data.user_id as string;
  if (!customer) return null;
  const byCustomer = await admin.from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customer)
    .maybeSingle();
  return (byCustomer.data?.user_id as string | undefined) || null;
}

async function syncSubscription(
  admin: SupabaseClient,
  subscription: Stripe.Subscription,
  event: Stripe.Event,
  fallbackUserId?: string | null,
) {
  const item = subscription.items.data[0];
  const price = item && typeof item.price === "object" ? item.price.id : null;
  if (!price) throw new Error(`Subscription ${subscription.id} has no recurring price.`);

  const plan = pricePlans().get(price);
  const userId = validUserId(fallbackUserId) ? fallbackUserId : await storedUserId(admin, subscription);
  const belongsToMellow = subscription.metadata?.mellow_app === "mellow_commons" || Boolean(userId);
  if (!belongsToMellow) return false;
  if (!plan) throw new Error(`No Mellow Commons plan is configured for Stripe price ${price}.`);
  if (!userId) throw new Error(`Subscription ${subscription.id} is missing its Supabase user mapping.`);

  const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customer) throw new Error(`Subscription ${subscription.id} is missing its customer.`);
  const currentPeriodEnd = (item as Stripe.SubscriptionItem & { current_period_end?: number }).current_period_end
    ?? (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end;

  const result = await admin.rpc("sync_stripe_subscription", {
    p_user_id: userId,
    p_tier: plan.tier,
    p_billing_interval: plan.interval,
    p_status: subscription.status,
    p_customer_id: customer,
    p_subscription_id: subscription.id,
    p_price_id: price,
    p_current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
    p_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    p_event_created: new Date(event.created * 1000).toISOString(),
    p_event_id: event.id,
  });
  if (result.error) throw result.error;
  return Boolean(result.data);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Stripe webhook is missing required server configuration.");
    return response({ error: "Webhook is not configured." }, 503);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return response({ error: "Missing Stripe signature." }, 400);
  const rawBody = await req.text();
  const stripe = new Stripe(stripeSecret);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed", error);
    return response({ error: "Invalid Stripe signature." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    let handled = false;
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (session.mode === "subscription" && subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        handled = await syncSubscription(admin, subscription, event, session.client_reference_id);
      }
    } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const snapshot = event.data.object as Stripe.Subscription;
      const subscription = await stripe.subscriptions.retrieve(snapshot.id);
      handled = await syncSubscription(admin, subscription, event);
    } else if (event.type === "customer.subscription.deleted") {
      handled = await syncSubscription(admin, event.data.object as Stripe.Subscription, event);
    }
    return response({ received: true, handled });
  } catch (error) {
    console.error(`Stripe event ${event.id} failed`, error);
    return response({ error: "Webhook processing failed." }, 500);
  }
});
