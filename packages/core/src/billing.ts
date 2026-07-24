// =============================================================================
// Giggle Billing & Entitlements — Token Economy
// =============================================================================
// ONE mental model, deliberately simple:
//
//   • TOKENS are the only spend currency. You spend tokens on cosmetic perks
//     (cover themes, vibe packs). Nothing cosmetic is priced in dollars.
//   • You get tokens two ways: buy a token pack (one-time), or subscribe to
//     Giggle+ (monthly token stipend + a bonus on every pack you buy).
//   • Giggle+ does NOT silently unlock cosmetics for free — members simply have
//     tokens flowing (stipend + pack bonus), and spend them like everyone else.
//     This keeps a single, honest pricing story instead of "why would a premium
//     user ever spend tokens?".
//
// This module is processor-agnostic. The default preview processor simulates a
// purchase locally OUTSIDE production only, so the UI can be exercised without
// ever granting paid entitlements in a production build.
//
// TO USE STRIPE:  implement a Processor that creates a Checkout Session on your
// backend, redirects to it, and resolves { ok: true } once your webhook has
// confirmed payment. Then call setProcessor(stripeProcessor) at app startup.
// =============================================================================

export type ProductType = "subscription" | "token_pack";

export interface Product {
  id: string;
  name: string;
  description: string;
  priceUsd: number;
  type: ProductType;
  icon: string;
  /** token_pack: base tokens granted. subscription: monthly stipend. */
  tokens?: number;
  /** token_pack: bonus tokens above the base amount (promotional). */
  bonusTokens?: number;
}

/** Giggle+ members get this fraction of extra tokens on every pack purchase. */
export const PREMIUM_PACK_BONUS_RATE = 0.15;

// ---------------------------------------------------------------------------
// Product catalog — two things to buy: Giggle+, or a token pack.
// ---------------------------------------------------------------------------

export const PRODUCTS: Record<string, Product> = {
  // ── Subscriptions ──────────────────────────────────────────────────────────
  premium_monthly: {
    id: "premium_monthly",
    name: "Giggle+ Monthly",
    description: "200 tokens/month + 15% bonus on every token pack",
    priceUsd: 9.99,
    type: "subscription",
    icon: "✦",
    tokens: 200,
  },
  premium_yearly: {
    id: "premium_yearly",
    name: "Giggle+ Yearly",
    description: "200 tokens/month + 15% pack bonus — save 20%",
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
};

// ---------------------------------------------------------------------------
// Token-priced perks — the ONLY way cosmetics are unlocked.
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
  /** Unlocked token perks (perkId -> 1 for owned; reserved for future expiry). */
  activePerks: Record<string, number>;
}

const STORAGE_KEY = "giggle.entitlements";
const TOKEN_KEY = "giggle.tokens";
// Tracks how much of the server-authoritative token balance has already been
// mirrored into the local wallet — so referral rewards sync without double-count.
const SERVER_SYNC_KEY = "giggle.tokens.serverSynced";

function safeRead(): Entitlements {
  try {
    if (typeof localStorage === "undefined") return { premium: false, activePerks: {} };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { premium: false, activePerks: {} };
    const parsed = JSON.parse(raw) as Partial<Entitlements>;
    return {
      premium: parsed.premium ?? false,
      premiumUntil: parsed.premiumUntil,
      activePerks: parsed.activePerks ?? {},
    };
  } catch {
    return { premium: false, activePerks: {} };
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
    return { ok: false, error: "Checkout is not configured for this build." };
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
    e.premiumUntil = Date.now() + (productId === "premium_yearly" ? 365 : 30) * 24 * 60 * 60 * 1000;
    safeWrite(e);
    // Monthly stipend on subscribe. addTokens() already notifies listeners; if
    // there's no stipend, notify once for the premium-flag change.
    if (product.tokens) addTokens(product.tokens);
    else _notify(e);
    return;
  }

  // token_pack: base + promotional bonus + member bonus (only while Giggle+ is
  // actually active — expired premium in storage must not still earn the bonus).
  const premiumActive = e.premium && (!e.premiumUntil || e.premiumUntil > Date.now());
  const base = (product.tokens ?? 0) + (product.bonusTokens ?? 0);
  const memberBonus = premiumActive ? Math.floor((product.tokens ?? 0) * PREMIUM_PACK_BONUS_RATE) : 0;
  addTokens(base + memberBonus);
}

// ---------------------------------------------------------------------------
// Token wallet (exported standalone for direct use)
// ---------------------------------------------------------------------------

/** Get current token balance. */
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

/** Add tokens to the wallet. */
export function addTokens(n: number): void {
  writeTokens(readTokens() + n);
  _notify(safeRead());
}

/** Spend tokens if sufficient balance. Returns true on success. */
export function spendTokens(n: number, _reason: string): boolean {
  const current = readTokens();
  if (current < n) return false;
  writeTokens(current - n);
  _notify(safeRead());
  return true;
}

/** Record a token perk as unlocked (activePerks[perkId] = 1), persist, notify. */
export function grantPerk(perkId: string): void {
  const e = safeRead();
  e.activePerks[perkId] = 1;
  safeWrite(e);
  _notify(e);
}

/**
 * Whether the user has unlocked the given perk. Unlocks are earned by spending
 * tokens — premium does NOT auto-grant cosmetics (see the module header).
 */
export function hasPerk(perkId: string): boolean {
  return (safeRead().activePerks[perkId] ?? 0) > 0;
}

/**
 * Local token perk redemption is a development preview until server-side
 * redemption exists. Production builds must not trust editable browser storage.
 */
export function canRedeemTokenPerksLocally(): boolean {
  return !isProductionRuntime();
}

/** Spend tokens to unlock a token perk by id (one-shot cosmetic unlock). */
function redeemPerk(perkId: string): boolean {
  if (!canRedeemTokenPerksLocally()) return false;
  if (hasPerk(perkId)) return true;
  const perk = TOKEN_PERKS.find(p => p.id === perkId);
  if (!perk) return false;
  const ok = spendTokens(perk.tokenCost, perkId);
  if (ok) grantPerk(perkId);
  return ok;
}

// ---------------------------------------------------------------------------
// The billing object
// ---------------------------------------------------------------------------

export const billing = {
  getEntitlements(): Entitlements {
    const e = safeRead();
    // Expire premium if past due.
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
  /** Spend 120 tokens to unlock Cover Themes. */
  spendOnCoverThemes(): boolean {
    return redeemPerk("cover_themes");
  },
  /** Spend 80 tokens to unlock Vibe Pack. */
  spendOnVibePack(): boolean {
    return redeemPerk("vibe_pack");
  },

  /** Record a perk unlock directly (e.g. granted by server/other flows). */
  grantPerk,
  /** True only if the perk has been explicitly unlocked with tokens. */
  hasPerk,

  async purchase(productId: string): Promise<{ ok: boolean; error?: string }> {
    const product = PRODUCTS[productId];
    if (!product) return { ok: false, error: "Unknown product" };
    const result = await _processor(productId);
    if (result.ok) _grantEntitlement(productId);
    return result;
  },

  subscribe(cb: Listener): () => void {
    _listeners.add(cb);
    return () => _listeners.delete(cb);
  },
};
