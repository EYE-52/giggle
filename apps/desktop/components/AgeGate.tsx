"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Logomark } from "@/components/Brand";
import { Button } from "@/components/Button";
import { api, session } from "@giggle/core";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MAX_STATUS_POLLS = 4;
const STATUS_POLL_MS = 2_000;

type GateState = "dob" | "checking" | "ready" | "pending" | "rejected" | "unavailable" | "restricted";

function makeValidDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
}

function ageFromDate(birth: Date, now: Date): number {
  let age = now.getFullYear() - birth.getFullYear();
  const month = now.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function DobSelect({
  label, value, placeholder, onChange, children,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative", display: "flex" }}>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          height: 48,
          padding: "0 34px 0 14px",
          borderRadius: "var(--radius-control, 12px)",
          border: focused ? "1px solid var(--accent, var(--violet))" : "1px solid var(--border-strong)",
          boxShadow: focused ? "0 0 0 3px color-mix(in srgb, var(--accent, var(--violet)) 16%, transparent)" : "none",
          background: "var(--surface-2)",
          color: value === "" ? "var(--text-muted)" : "var(--text)",
          fontSize: 15,
          fontFamily: "inherit",
          fontWeight: value === "" ? 400 : 600,
          cursor: "pointer",
          appearance: "none",
          WebkitAppearance: "none",
          MozAppearance: "none",
          outline: "none",
          transition: "border-color .15s ease, box-shadow .15s ease",
        }}
      >
        <option value="" disabled>{placeholder}</option>
        {children}
      </select>
      <span aria-hidden style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", display: "flex" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="m6 9 6 6 6-6" stroke="var(--text-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}

function AgeHelp() {
  return (
    <a
      href="mailto:support@gigglemeet.com?subject=Age%20verification%20help"
      style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: "var(--accent)", fontSize: 13, fontWeight: 600 }}
    >
      Get age verification help
    </a>
  );
}

export function AgeGate({ onDone, onManageAccount }: { onDone: () => void; onManageAccount?: () => void }) {
  const now = useMemo(() => new Date(), []);
  const years = useMemo(
    () => Array.from({ length: 108 }, (_, index) => now.getFullYear() - 13 - index),
    [now],
  );
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [state, setState] = useState<GateState>(() => {
    if (!session.ageConfirmed) return "dob";
    return session.isAdult ? "checking" : "restricted";
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const operationGeneration = useRef(0);
  const reconcileInFlight = useRef<Promise<void> | null>(null);
  const completed = useRef(false);

  const daysInMonth = useMemo(() => {
    if (month === "") return 31;
    return new Date(year === "" ? 2000 : Number(year), Number(month) + 1, 0).getDate();
  }, [month, year]);

  useEffect(() => {
    if (day !== "" && Number(day) > daysInMonth) setDay("");
  }, [day, daysInMonth]);

  const finishVerified = useCallback(async (operation: number) => {
    const synced = await session.syncAgeFromServer();
    if (!mounted.current || operation !== operationGeneration.current) return false;
    if (synced && session.hasAdultAccess && !completed.current) {
      completed.current = true;
      onDone();
      return true;
    }
    setState("unavailable");
    setError("We couldn't confirm the completed check. Please try again.");
    setBusy(false);
    return false;
  }, [onDone]);

  const reconcile = useCallback(() => {
    if (!mounted.current || !session.ageConfirmed || !session.isAdult || completed.current) {
      return Promise.resolve();
    }
    if (reconcileInFlight.current) return reconcileInFlight.current;

    const operation = ++operationGeneration.current;
    const request = (async () => {
      setBusy(true);
      setError(null);

      for (let attempt = 0; attempt < MAX_STATUS_POLLS; attempt += 1) {
        try {
          const result = await api.getAgeVerificationStatus();
          if (!mounted.current || operation !== operationGeneration.current) return;
          if (result.status === "verified") {
            await finishVerified(operation);
            return;
          }
          if (result.status === "restricted") {
            setState("restricted");
            setBusy(false);
            return;
          }
          if (result.status === "rejected") {
            setState("rejected");
            setBusy(false);
            return;
          }
          if (result.status === "not_started") {
            setState("ready");
            setBusy(false);
            return;
          }

          setState("pending");
          setBusy(false);
          if (attempt + 1 < MAX_STATUS_POLLS) {
            await new Promise((resolve) => window.setTimeout(resolve, STATUS_POLL_MS));
            if (!mounted.current || operation !== operationGeneration.current) return;
          }
        } catch (cause) {
          if (!mounted.current || operation !== operationGeneration.current) return;
          setState("unavailable");
          setError((cause as { message?: string })?.message || "Age verification is temporarily unavailable.");
          setBusy(false);
          return;
        }
      }

      if (mounted.current && operation === operationGeneration.current) setBusy(false);
    })();

    reconcileInFlight.current = request;
    void request.finally(() => {
      if (reconcileInFlight.current === request) reconcileInFlight.current = null;
    });
    return request;
  }, [finishVerified]);

  useEffect(() => {
    mounted.current = true;
    if (session.ageConfirmed && session.isAdult) void reconcile();
    const onReturn = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      mounted.current = false;
      operationGeneration.current += 1;
      reconcileInFlight.current = null;
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [reconcile]);

  async function submitDob(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (month === "" || day === "" || year === "") {
      setError("Please pick your full date of birth.");
      return;
    }

    const birth = makeValidDate(Number(year), Number(month), Number(day));
    if (!birth) {
      setError("That date doesn't look right — check the day and month.");
      return;
    }
    const age = ageFromDate(birth, now);
    if (birth.getTime() > now.getTime() || age > 120) {
      setError("That date doesn't look right — check your birth year.");
      return;
    }
    if (age < 13) {
      setState("restricted");
      return;
    }

    const iso = `${birth.getFullYear()}-${String(birth.getMonth() + 1).padStart(2, "0")}-${String(birth.getDate()).padStart(2, "0")}`;
    const operation = ++operationGeneration.current;
    reconcileInFlight.current = null;
    setBusy(true);
    try {
      await session.setAge(iso);
      if (!mounted.current || operation !== operationGeneration.current) return;
      setState("checking");
      await reconcile();
    } catch (cause) {
      if (!mounted.current || operation !== operationGeneration.current) return;
      if ((cause as { code?: string })?.code === "AGE_RESTRICTED") {
        await session.syncAgeFromServer();
        if (!mounted.current || operation !== operationGeneration.current) return;
        setState("restricted");
        setBusy(false);
        return;
      }
      setError((cause as { message?: string })?.message || "Couldn't save that right now. Please try again.");
      setBusy(false);
    }
  }

  async function startVerification() {
    const operation = ++operationGeneration.current;
    reconcileInFlight.current = null;
    setBusy(true);
    setError(null);
    try {
      const result = await api.startAgeVerification();
      if (!mounted.current || operation !== operationGeneration.current || !session.isAuthed()) return;
      if (result.status === "verified") {
        await finishVerified(operation);
        return;
      }
      if (result.status === "restricted") {
        setState("restricted");
      } else if (result.status === "rejected") {
        setState("rejected");
      } else if (result.url) {
        let providerUrl: URL;
        try {
          providerUrl = new URL(result.url);
        } catch {
          setState("unavailable");
          setError("Age verification returned an invalid provider link.");
          setBusy(false);
          return;
        }
        if (
          providerUrl.protocol !== "https:" ||
          providerUrl.hostname !== "age.yoti.com" ||
          providerUrl.port !== "" ||
          providerUrl.username !== "" ||
          providerUrl.password !== ""
        ) {
          setState("unavailable");
          setError("Age verification returned an invalid provider link.");
          setBusy(false);
          return;
        }
        setState("pending");
        window.location.assign(providerUrl.toString());
        return;
      } else if (result.status === "pending") {
        setState("unavailable");
        setError("Age verification returned an invalid provider link.");
      } else {
        setState("ready");
      }
    } catch (cause) {
      if (!mounted.current || operation !== operationGeneration.current) return;
      setState("unavailable");
      setError((cause as { message?: string })?.message || "Age verification is temporarily unavailable.");
    }
    setBusy(false);
  }

  function signOut() {
    mounted.current = false;
    operationGeneration.current += 1;
    reconcileInFlight.current = null;
    session.signOut();
    window.location.assign("/signin");
  }

  if (state === "restricted") {
    return (
      <Shell>
        <Logomark size={44} />
        <h1 style={headingStyle}>Giggle is for adults 18+</h1>
        <p style={bodyStyle}>This account can&apos;t access squads, matching, chat, or video calls.</p>
        <AgeHelp />
        {onManageAccount && <Button variant="secondary" fullWidth onClick={onManageAccount}>Account &amp; data</Button>}
        <Button variant="secondary" fullWidth onClick={signOut}>Sign out</Button>
      </Shell>
    );
  }

  if (state !== "dob") {
    const content = {
      checking: ["Checking your verification", "Confirming your status with Giggle."],
      ready: ["Verify you're 18 or older", "Complete a quick hosted Yoti check to continue."],
      pending: ["Verification pending", "Finish the hosted check, then return here. Giggle will update automatically."],
      rejected: ["We couldn't verify your age", "Try the hosted check again or contact support for help."],
      unavailable: ["Verification unavailable", "Your access stays protected while the age service is unavailable."],
    }[state];

    return (
      <Shell>
        <Logomark size={44} />
        <h1 style={headingStyle}>{content[0]}</h1>
        <p role={state === "unavailable" ? "alert" : undefined} style={bodyStyle}>{error || content[1]}</p>
        {state === "ready" && (
          <Button fullWidth loading={busy} onClick={startVerification}>Verify with Yoti</Button>
        )}
        {state === "pending" && (
          <>
            <Button fullWidth loading={busy} onClick={startVerification}>Continue with Yoti</Button>
            <Button variant="secondary" fullWidth loading={busy} onClick={reconcile}>Check again</Button>
          </>
        )}
        {state === "rejected" && (
          <Button fullWidth loading={busy} onClick={startVerification}>Try verification again</Button>
        )}
        {state === "unavailable" && (
          <Button variant="secondary" fullWidth loading={busy} onClick={reconcile}>Try again</Button>
        )}
        {state === "checking" && <span className="gg-spinner" role="status" aria-label="Checking verification" />}
        <AgeHelp />
        {onManageAccount && <Button variant="secondary" fullWidth onClick={onManageAccount}>Account &amp; data</Button>}
        <Button variant="ghost" fullWidth onClick={signOut}>Sign out</Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <Logomark size={44} />
      <h1 style={headingStyle}>Confirm your age</h1>
      <p style={bodyStyle}>Giggle is for adults 18+. Enter your date of birth to continue.</p>
      <form onSubmit={submitDob} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", padding: 0, marginBottom: 2 }}>Date of birth</legend>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 1.1fr", gap: 10 }}>
            <DobSelect label="Birth month" value={month} placeholder="Month" onChange={setMonth}>
              {MONTHS.map((label, index) => <option key={label} value={index}>{label}</option>)}
            </DobSelect>
            <DobSelect label="Birth day" value={day} placeholder="Day" onChange={setDay}>
              {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
            </DobSelect>
            <DobSelect label="Birth year" value={year} placeholder="Year" onChange={setYear}>
              {years.map((value) => <option key={value} value={value}>{value}</option>)}
            </DobSelect>
          </div>
        </fieldset>
        {error && <div role="alert" style={{ fontSize: 13, color: "var(--coral, #FF5C5C)", lineHeight: 1.4 }}>{error}</div>}
        <Button type="submit" fullWidth loading={busy}>Continue</Button>
      </form>
      <AgeHelp />
      {onManageAccount && <Button variant="secondary" fullWidth onClick={onManageAccount}>Account &amp; data</Button>}
      <Button variant="ghost" fullWidth onClick={signOut}>Sign out</Button>
    </Shell>
  );
}

const headingStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-display, var(--font-space-grotesk))",
  fontSize: 26,
  lineHeight: 1.1,
  letterSpacing: "-0.02em",
  color: "var(--text)",
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.55,
  color: "var(--text-muted)",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px 16px", background: "var(--bg)" }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm your age"
        aria-live="polite"
        style={{
          width: "100%",
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 16,
          padding: "32px 26px",
          borderRadius: 22,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          boxShadow: "var(--shadow-card, var(--elev))",
          animation: "gg-reveal 0.32s var(--ease-out) both",
        }}
      >
        {children}
      </div>
    </div>
  );
}
