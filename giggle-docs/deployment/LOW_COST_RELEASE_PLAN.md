# Giggle Deployment Plan: "Colleague Release" (Low-Cost/Free)

This archived plan outlined an early low-cost Giggle MVP deployment. It is retained for historical context only.

Current production source of truth is [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md): deploy the frontend from `giggle-app/` with Vercel root directory `apps/desktop`, and deploy the backend from `giggle-server/` to Railway. Do not deploy the legacy top-level `giggle-web/` folder for the main product.

The original plan below may still be useful as a checklist for a throwaway friend-and-family test stack, but its service choices and frontend root are no longer canonical.

## Objective
Deploy the complete Giggle stack (Frontend, Backend, DB, Redis, RTC) to the public internet securely, allowing friends to test the "Squad-to-Squad" experience.

## Infrastructure Stack (The "Free Tier" Stack)

| Component | Provider | Cost | Notes |
| :--- | :--- | :--- | :--- |
| **Frontend (Next.js)** | **Vercel** | Free (Hobby Tier) | Seamless Next.js integration. Custom `.vercel.app` domain. |
| **Backend (Node.js)** | **Render** | Free | Supports WebSockets. *Note: Free instances spin down after 15 mins of inactivity. First request might take ~30s to wake up.* |
| **Database** | **MongoDB Atlas** | Free (M0 Cluster) | 512MB storage. Plenty for testing. |
| **Redis** | **Upstash** | Free | 10,000 requests/day. Extremely fast setup. |
| **Video/Audio** | **Agora** | Free | 10,000 free minutes per month. |

---

## Deployment Steps

### Phase 1: Preparation
1.  **Push to GitHub:** Ensure your `giggle-app` and `giggle-server` folders are pushed to a GitHub repository.

### Phase 2: Backend Deployment (Render & Upstash)
1.  **Set up Upstash Redis:**
    *   Go to [Upstash.com](https://upstash.com/), create a free Redis database.
    *   Copy the `REDIS_URL` (looks like `rediss://...`).
2.  **Set up Render (Backend):**
    *   Go to [Render.com](https://render.com/) and create a new **Web Service**.
    *   Connect your GitHub repo. Set the Root Directory to `giggle-server`.
    *   Build Command: `npm install`
    *   Start Command: `npm start`
    *   **Environment Variables:** Add your `MONGODB_URI`, `JWT_SECRET`, `AUTH_EXCHANGE_SECRET`, `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, and the new `REDIS_URL` from Upstash.
3.  **Note the Backend URL:** Once deployed, Render will give you a URL (e.g., `https://giggle-server.onrender.com`).

### Phase 3: Frontend Deployment (Vercel)
1.  **Set up Vercel:**
    *   Go to [Vercel.com](https://vercel.com/) and "Add New Project".
    *   Connect your GitHub repo. Set the Root Directory to `giggle-app/apps/desktop`.
2.  **Environment Variables:**
    *   `NEXT_PUBLIC_BACKEND_URL`: Set this to your new Render backend URL.
    *   `AUTH_EXCHANGE_SECRET`: Set this to the same value configured on the backend.
    *   `NEXTAUTH_URL`: Set this to the Vercel domain (you might need to guess it or update it after deployment, e.g., `https://giggle.vercel.app`).
    *   `NEXTAUTH_SECRET`: Generate a random string.
    *   `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: Your Google OAuth credentials.
3.  **Deploy:** Click Deploy.

### Phase 4: Finalizing Connections
1.  **Update Google OAuth:** 
    *   Go to your Google Cloud Console.
    *   Add your new Vercel domain to the "Authorized JavaScript origins".
    *   Add `https://your-vercel-domain.vercel.app/api/auth/callback/google` to the "Authorized redirect URIs".
2.  **CORS Update:**
    *   In your `giggle-server` code, ensure the `cors` configuration in `server.js` and `socketService.js` includes your new Vercel frontend URL. You will need to commit this change and let Render auto-deploy.

---

## Managing the "Colleague Release"

### 1. The "Wake Up" Rule
Because Render's free tier sleeps, tell your friends: *"The first time you load the app, the backend might take 30 seconds to wake up. Please be patient!"*

### 2. Testing Coordination
Coordinate a specific time (e.g., "Friday at 8 PM") for everyone to log on. This ensures:
1.  The backend is awake.
2.  There is enough "liquidity" in the matchmaking queue for squads to actually find each other.

### 3. Gathering Feedback
Create a simple Google Form or a shared Discord channel to collect feedback on:
*   Video quality (Agora limits).
*   Any UI glitches during the "Collision" animation.
*   General ease of use.
