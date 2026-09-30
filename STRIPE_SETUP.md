# Stripe production setup

Mellow Commons uses authenticated Supabase Edge Functions for Checkout and the billing portal, plus a signature-verified webhook for subscription state. Stripe secret keys and price IDs never enter the static website.

## 1. Create recurring Stripe prices

Create three Stripe products: **Mellow Commons Basic**, **Mellow Commons Premium**, and **Mellow Commons Buddy**. Premium has monthly and yearly prices; the other products have one monthly price each. This keeps each plan name and entitlement clear on Checkout, receipts, invoices, and the customer portal.

For every paid product, set the Stripe Tax product category to **Software as a service (SaaS) - personal use** (`txcd_10103000`). Mellow Commons is accessed in the browser and nothing is downloaded, so do **not** select **Downloadable Software - personal use** or **SaaS - electronic download - personal use**.

Create these recurring prices in the Stripe account and copy each `price_...` ID:

| Secret | Plan | Price | Interval |
| --- | --- | ---: | --- |
| `STRIPE_PRICE_BASIC_MONTH` | Basic | $1.99 USD | monthly |
| `STRIPE_PRICE_PREMIUM_MONTH` | Premium | $6.99 USD | monthly |
| `STRIPE_PRICE_PREMIUM_YEAR` | Premium | $69.96 USD | yearly |
| `STRIPE_PRICE_BUDDY_MONTH` | Buddy | $12.99 USD | monthly |

Use separate test and live price IDs. Do not change an existing price amount; archive it and deploy the replacement ID.

## 2. Configure server-only Supabase secrets

Set these in **Supabase Dashboard → Edge Functions → Secrets** or with the Supabase CLI:

```sh
supabase secrets set \
  STRIPE_SECRET_KEY=sk_live_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_BASIC_MONTH=price_... \
  STRIPE_PRICE_PREMIUM_MONTH=price_... \
  STRIPE_PRICE_PREMIUM_YEAR=price_... \
  STRIPE_PRICE_BUDDY_MONTH=price_... \
  PUBLIC_SITE_URL=https://joinfocusroomlive.live
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied to Edge Functions by Supabase. Never copy any of these secrets into `config.js`, GitHub Pages, logs, or browser code.

## 3. Configure the Stripe webhook

Create a webhook endpoint at:

`https://fhexyiexginuzriwmfol.supabase.co/functions/v1/stripe-webhook`

Subscribe only to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copy its signing secret to `STRIPE_WEBHOOK_SECRET`. The webhook Edge Function intentionally has gateway JWT verification disabled because it verifies Stripe's raw-body signature itself.

## 4. Configure the customer portal

Activate the Stripe Customer Portal. Allow customers to update payment methods and cancel subscriptions. If plan switching is enabled, offer only the four price IDs above and verify Stripe's proration behavior before launch.

Add Mellow Commons business details, statement descriptor, support contact, logo, brand colors, Privacy URL, and Terms URL in Stripe. Stripe Checkout can offer Apple Pay automatically on eligible devices after the live account and payment methods are ready.

## 5. Deploy and verify

Apply `supabase/migrations/20260928164134_stripe_subscription_sync.sql`, then deploy:

```sh
supabase functions deploy create-checkout
supabase functions deploy create-portal
supabase functions deploy stripe-webhook --no-verify-jwt
```

Test the full flow in Stripe test mode before substituting live secrets:

1. Start each plan's Checkout from a signed-in account.
2. Complete payment with Stripe's test card.
3. Confirm the subscription row updates and the correct allowance appears.
4. Open Manage billing, cancel at period end, and confirm access remains until the paid period ends.
5. Simulate `past_due`, cancellation, duplicate webhook delivery, and out-of-order delivery.
6. Confirm a logged-out caller cannot create Checkout or portal sessions.
