"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { session, api, formatSquadCodeInput, isValidSquadCode } from "@giggle/core";
import { Logomark } from "@/components/Brand";
import { AgeGate } from "@/components/AgeGate";

// Invite-link landing: /join/<CODE>. Someone opens a squad invite link →
// we join them to the squad and drop them straight into the lobby. If they're
// not signed in, we bounce through /signin (preserving this URL via ?next=) and
// come right back here after auth to complete the join.
type Phase = "working" | "age" | "requested" | "error";

export default function JoinByLinkPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const rawCode = Array.isArray(params?.code) ? params.code[0] : params?.code;
  const code = formatSquadCodeInput(String(rawCode || ""));

  const [phase, setPhase] = useState<Phase>("working");
  const [errorMsg, setErrorMsg] = useState("Something went wrong joining that squad.");
  // Bumped after the age gate is satisfied to re-run the join effect.
  const [proceed, setProceed] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!isValidSquadCode(code)) {
        if (!cancelled) { setErrorMsg("That invite link looks invalid or has expired."); setPhase("error"); }
        return;
      }

      // Not signed in → go authenticate, then return to this exact link.
      if (!session.isAuthed()) {
        if (process.env.NODE_ENV !== "production") {
          try { await session.devSignIn(); } catch { /* fall through to signin */ }
        }
        if (!session.isAuthed()) {
          router.replace(`/signin?next=${encodeURIComponent(`/join/${code}`)}`);
          return;
        }
      }

      // Age gate BEFORE the join — this route lives outside the (app) layout, so
      // its AgeGate never runs here. Without this a not-yet-confirmed (possibly
      // under-13) user would be added to the squad server-side before ever being
      // asked their age.
      if (!session.ageConfirmed) {
        if (!cancelled) setPhase("age");
        return;
      }

      try {
        const squad = await api.joinSquad({ squadCode: code });
        if (cancelled) return;
        // Request-to-join squads: the leader must approve before entry.
        if ("status" in squad && (squad as { status?: string }).status === "requested") {
          setPhase("requested");
          return;
        }
        const joinedId = (squad as { squadId?: string }).squadId;
        if (!joinedId) throw new Error("Couldn't open that squad's lobby.");
        router.replace(`/lobby?squad=${joinedId}`);
      } catch (e: unknown) {
        if (cancelled) return;
        setErrorMsg((e as { message?: string })?.message || "Couldn't join that squad — the code may be wrong or the squad is full.");
        setPhase("error");
      }
    }

    run();
    return () => { cancelled = true; };
  }, [code, router, proceed]);

  if (phase === "age") {
    return (
      <AgeGate
        onDone={() => {
          // Age confirmed → re-run the effect, which now passes the gate and joins.
          setPhase("working");
          setProceed((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "min(400px, 100%)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <Logomark size={40} />
        {phase === "working" && (
          <>
            <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 20, fontWeight: 700 }}>
              <span className="gg-spinner" aria-hidden /> Joining squad…
            </div>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>Hang tight — dropping you into <b style={{ fontFamily: "monospace", letterSpacing: "0.08em" }}>{code || "the squad"}</b>.</p>
          </>
        )}
        {phase === "requested" && (
          <>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700 }}>Request sent!</h1>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>This squad reviews new members. The leader will let you in shortly.</p>
            <Link href="/home" style={{ marginTop: 4, padding: "11px 22px", borderRadius: "var(--radius-btn, 999px)", background: "var(--accent, var(--violet))", color: "var(--on-accent, #fff)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Back to Home</Link>
          </>
        )}
        {phase === "error" && (
          <>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700 }}>Couldn&apos;t join</h1>
            <p role="alert" style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>{errorMsg}</p>
            <Link href="/home" style={{ marginTop: 4, padding: "11px 22px", borderRadius: "var(--radius-btn, 999px)", background: "var(--accent, var(--violet))", color: "var(--on-accent, #fff)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Back to Home</Link>
          </>
        )}
      </div>
    </div>
  );
}
