// =============================================================================
// Giggle Billing & Entitlements — Token Economy
// =============================================================================
// This module is deliberately processor-agnostic.  The default preview
// processor simulates a purchase locally only outside production so the UI can
// be exercised without ever granting paid entitlements in a production build.
//
// TO USE STRIPE:
//   1. Implement a processor function that:
//      a. POSTs to your backend to create a Stripe Checkout Session
//      b. Redirects (or opens a popup) to session.url
//      c. Waits for your backend webhook to confirm payment and signal success
//   2. Call setProcessor(stripeProcessor) before your app renders.
//   Example:
//     import { setProcessor } from "@giggle/core";
//     setProcessor(async (productId) => {
//       const { sessionUrl } = await fetch("/api/checkout", { method: "POST", body: JSON.stringify({ productId }) }).then(r => r.json());
//       window.location.href = sessionUrl; // or open stripe.js modal
//       return { ok: true }; // resolved after redirect-back verification
//     });
//
// TO USE REVENUECAT (mobile/hybrid):
//   setProcessor(async (productId) => {
//     const result = await Purchases.purchaseProduct(productId);
//     return result.customerInfo ? { ok: true } : { ok: false, error: "Purchase failed" };
//   });
//
// TOKEN ECONOMY:
//   Users buy token packs (one-time). Tokens can be spent on cosmetic perks:
//   cover themes and vibe packs. Giggle+ subscription gives monthly token
//   stipend + premium cosmetics once checkout is live.
// =============================================================================

export type ProductType = "subscription" | "token_pack" | "consumable";

export interface Product {
  id: string;
  name: string;
  description: string;
  priceUsd: number;
  type: ProductType;
  icon: string;
  /** For token_pack: how many tokens this pack grants */
  tokens?: number;
  /** For token_pack: bonus tokens above base amount */
  bonusTokens?: number;
}

// ---------------------------------------------------------------------------
// Product catalog
// ---------------------------------------------------------------------------

export const PRODUCTS: Record<string, Product> = {
  // ── Subscriptions ──────────────────────────────────────────────────────────
  premium_monthly: {
    id: "premium_monthly",
    name: "Giggle+ Monthly",
    description: "200 tokens/month + exclusive cosmetics",
    priceUsd: 9.99,
    type: "subscription",
    icon: "✦",
    tokens: 200,
  },
  premium_yearly: {
    id: "premium_yearly",
    name: "Giggle+ Yearly",
    description: "200 tokens/month + exclusive cosmetics — save 20%",
    priceUsd: 95.88,
    type: "subscription",
    icon: "✦",
    tokens: 200,
  },

  // ── Token packs ────────────────────────────────────────────────────────────
  tokens_starter: {
    id: "tokens_starter",
    name: "Starter Pack",
    description: "100 tokens to spend on perks",
    priceUsd: 0.99,
    type: "token_pack",
    icon: "◈",
    tokens: 100,
    bonusTokens: 0,
  },
  tokens_plus: {
    id: "tokens_plus",
    name: "Plus Pack",
    description: "500 tokens + 50 bonus",
    priceUsd: 4.99,
    type: "token_pack",
    icon: "◈",
    tokens: 500,
    bonusTokens: 50,
  },
  tokens_pro: {
    id: "tokens_pro",
    name: "Pro Pack",
    description: "1200 tokens + 200 bonus",
    priceUsd: 9.99,
    type: "token_pack",
    icon: "◈",
    tokens: 1200,
    bonusTokens: 200,
  },
  tokens_mega: {
    id: "tokens_mega",
    name: "Mega Pack",
    description: "3000 tokens + 750 bonus",
    priceUsd: 19.99,
    type: "token_pack",
    icon: "◈",
    tokens: 3000,
    bonusTokens: 750,
  },

  // ── Cosmetic consumables ──────────────────────────────────────────────────
  vibe_pack: {
    id: "vibe_pack",
    name: "Premium Vibes Pack",
    description: "Exclusive animated vibe tags for your profile",
    priceUsd: 3.99,
    type: "consumable",
    icon: "✨",
  },
  squad_themes: {
    id: "squad_themes",
    name: "Squad Themes",
    description: "Cosmetic encounter backgrounds for your squad",
    priceUsd: 4.99,
    type: "consumable",
    icon: "🎭",
  },
};

// ---------------------------------------------------------------------------
// Token-priced perks
// ---------------------------------------------------------------------------

export interface TokenPerk {
  id: string;
  name: string;
  description: string;
  tokenCost: number;
  icon: string;
}

export const TOKEN_PERKS: TokenPerk[] = [
  {
    id: "cover_themes",
    name: "Cover Themes",
    description: "Unlock exclusive animated backgrounds for your squad lobby",
    tokenCost: 120,
    icon: "palette",
  },
  {
    id: "vibe_pack",
    name: "Vibe Pack",
    description: "Unlock exclusive animated vibe tags for your profile",
    tokenCost: 80,
    icon: "star",
  },
];

// ---------------------------------------------------------------------------
// Entitlements & wallet state
// ---------------------------------------------------------------------------

export interface Entitlements {
  premium: boolean;
  premiumUntil?: number; // unix ms
  boosts: Record<string, number>; // productId -> quantity (legacy compat)
  /** Active token-based perks (perkId -> expiry unix ms, or 1 for one-shot) */
  activePerks: Record<string, number>;
}

const STORAGE_KEY = "giggle.entitlements";
const TOKEN_KEY = "giggle.tokens";
// Tracks how much of the server-authoritative token balance has already been
// mirrored into the local wallet — so referral rewards sync without double-count.
const SERVER_SYNC_KEY = "giggle.tokens.serverSynced";

function safeRead(): Entitlements {
  try {
    if (typeof localStorage === "undefined") return { premium: false, boosts: {}, activePerks: {} };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { premium: false, boosts: {}, activePerks: {} };
    const parsed = JSON.parse(raw) as Partial<Entitlements>;
    return {
      premium: parsed.premium ?? false,
      premiumUntil: parsed.premiumUntil,
      boosts: parsed.boosts ?? {},
      activePerks: parsed.activePerks ?? {},
    };
  } catch {
    return { premium: false, boosts: {}, activePerks: {} };
  }
}

function safeWrite(e: Entitlements): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(e));
    }
  } catch {}
}

function readTokens(): number {
  try {
    if (typeof localStorage === "undefined") return 0;
    return parseInt(localStorage.getItem(TOKEN_KEY) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

function writeTokens(n: number): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TOKEN_KEY, String(Math.max(0, n)));
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export type Processor = (productId: string) => Promise<{ ok: boolean; error?: string }>;

function isProductionRuntime(): boolean {
  return Boolean(
    typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV === "production"
  );
}

/** Local preview processor. Real apps must call setProcessor at startup. */
const previewProcessor: Processor = async (_productId) => {
  await new Promise(r => setTimeout(r, 620));
  if (isProductionRuntime()) {
    return {
      ok: false,
      error: "Checkout is not configured for this build.",
    };
  }
  return { ok: true };
};

let _processor: Processor = previewProcessor;

/** Swap in a real Stripe / RevenueCat processor at app startup. */
export function setProcessor(fn: Processor): void {
  _processor = fn;
}

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

type Listener = (e: Entitlements) => void;
const _listeners: Set<Listener> = new Set();

function _notify(e: Entitlements): void {
  _listeners.forEach(cb => cb(e));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _grantEntitlement(productId: string): void {
  const e = safeRead();
  const product = PRODUCTS[productId];
  if (!product) return;

  if (product.type === "subscription") {
    e.premium = true;
    if (productId === "premium_monthly") {
      e.premiumUntil = Date.now() + 30 * 24 * 60 * 60 * 1000;
    } else if (productId === "premium_yearly") {
      e.premiumUntil = Date.now() + 365 * 24 * 60 * 60 * 1000;
    }
    // Grant monthly stipend on subscribe
    if (product.tokens) {
      addTokens(product.tokens);
    }
  } else if (product.type === "token_pack") {
    const total = (product.tokens ?? 0) + (product.bonusTokens ?? 0);
    addTokens(total);
  } else {
    // Legacy consumable path
    e.boosts[productId] = (e.boosts[productId] ?? 0) + 1;
  }

  safeWrite(e);
  _notify(e);
}

// ---------------------------------------------------------------------------
// Token wallet (exported standalone for direct use)
// ---------------------------------------------------------------------------

/** Get current token balance */
export function getTokenBalance(): number {
  return readTokens();
}

/**
 * Mirror the server-authoritative token balance into the local wallet.
 * The server tracks referral-earned tokens; this credits only the *increase*
 * since the last sync (idempotent across reloads). Returns tokens newly added.
 */
export function syncServerTokens(serverBalance: number): number {
  if (typeof serverBalance !== "number" || !isFinite(serverBalance)) return 0;
  let lastSynced = 0;
  try {
    if (typeof localStorage !== "undefined") {
      lastSynced = parseInt(localStorage.getItem(SERVER_SYNC_KEY) ?? "0", 10) || 0;
    }
  } catch {}
  const delta = serverBalance - lastSynced;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SERVER_SYNC_KEY, String(Math.max(lastSynced, serverBalance)));
    }
  } catch {}
  if (delta > 0) {
    addTokens(delta);
    return delta;
  }
  return 0;
}

/** Add tokens to the wallet */
export function addTokens(n: number): void {
  const current = readTokens();
  writeTokens(current + n);
  const e = safeRead();
  _notify(e);
}

/**
 * Spend tokens if sufficient balance.
 * Returns true on success, false if insufficient.
 */
export function spendTokens(n: number, reason: string): boolean {
  const current = readTokens();
  if (current < n) return false;
  writeTokens(current - n);
  const e = safeRead();
  _notify(e);
  return true;
}

/**
 * Record a one-shot cosmetic/feature perk as unlocked, persist it and notify.
 * Stored as `activePerks[perkId] = 1` (1 = owned, no expiry).
 */
export function grantPerk(perkId: string): void {
  const e = safeRead();
  e.activePerks[perkId] = 1;
  safeWrite(e);
  _notify(e);
}

/**
 * Whether the user has access to the given perk — true if it was explicitly
 * unlocked (present in activePerks) OR the user is premium (all cosmetics).
 */
export function hasPerk(perkId: string): boolean {
  if (billing.isPremium()) return true;
  return (safeRead().activePerks[perkId] ?? 0) > 0;
}

/**
 * Local token perk redemption is a development preview until server-side
 * redemption exists. Production builds must not trust editable browser storage.
 */
export function canRedeemTokenPerksLocally(): boolean {
  return !isProductionRuntime();
}

// ---------------------------------------------------------------------------
// The billing object
// ---------------------------------------------------------------------------

export const billing = {
  getEntitlements(): Entitlements {
    const e = safeRead();
    // Expire premium if past due
    if (e.premium && e.premiumUntil && Date.now() > e.premiumUntil) {
      e.premium = false;
      safeWrite(e);
    }
    return e;
  },

  isPremium(): boolean {
    return billing.getEntitlements().premium;
  },

  // ── Token wallet ────────────────────────────────────────────────────────
  getTokenBalance,
  addTokens,
  spendTokens,
  syncServerTokens,
  canRedeemTokenPerksLocally,

  // ── Token perk spenders ─────────────────────────────────────────────────

  /** Legacy no-op while queue priority is not sold in current checkout. */
  spendOnFastPass(): boolean {
    return false;
  },

  /** Spend 40 tokens for a Squad Boost 1h. Premium users get it free. */
  spendOnBoost(): boolean {
    if (!canRedeemTokenPerksLocally()) return false;
    if (billing.isPremium()) return true;
    return spendTokens(40, "squad_boost");
  },

  /** Spend 120 tokens to unlock Cover Themes (one-shot cosmetic unlock). */
  spendOnCoverThemes(): boolean {
    if (!canRedeemTokenPerksLocally()) return false;
    if (hasPerk("cover_themes")) return true;
    const ok = spendTokens(120, "cover_themes");
    if (ok) grantPerk("cover_themes");
    return ok;
  },

  /** Spend 80 tokens to unlock Vibe Pack (one-shot cosmetic unlock). */
  spendOnVibePack(): boolean {
    if (!canRedeemTokenPerksLocally()) return false;
    if (hasPerk("vibe_pack")) return true;
    const ok = spendTokens(80, "vibe_pack");
    if (ok) grantPerk("vibe_pack");
    return ok;
  },

  /** Record a perk unlock directly (e.g. granted by server/other flows). */
  grantPerk,

  /** True if the perk is unlocked OR the user is premium. */
  hasPerk,

  // ── Legacy compat ────────────────────────────────────────────────────────

  /**
   * boostCount — legacy API.
   * For fast_pass_5: always 0 while queue priority is not sold.
   * For other consumables: returns stored boost count.
   */
  boostCount(productId: string): number {
    if (productId === "fast_pass_5") {
      return 0;
    }
    return billing.getEntitlements().boosts[productId] ?? 0;
  },

  /**
   * consumeBoost — legacy API.
   * For fast_pass_5: no-op while queue priority is not sold.
   * For other consumables: decrements stored count.
   */
  consumeBoost(productId: string): boolean {
    if (productId === "fast_pass_5") {
      return billing.spendOnFastPass();
    }
    const e = safeRead();
    const qty = e.boosts[productId] ?? 0;
    if (qty <= 0) return false;
    e.boosts[productId] = qty - 1;
    safeWrite(e);
    _notify(e);
    return true;
  },

  async purchase(productId: string): Promise<{ ok: boolean; error?: string }> {
    const product = PRODUCTS[productId];
    if (!product) return { ok: false, error: "Unknown product" };

    const result = await _processor(productId);
    if (result.ok) {
      _grantEntitlement(productId);
    }
    return result;
  },

  subscribe(cb: Listener): () => void {
    _listeners.add(cb);
    return () => _listeners.delete(cb);
  },
};
