"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, session } from "@giggle/core";
import { Button } from "./Button";
import { Logomark } from "./Brand";
import { Modal } from "./Modal";

export function IdentityOnlyAccount({ onReturnToVerification }: { onReturnToVerification?: () => void }) {
  const router = useRouter();
  const pendingDeletion = session.accountStatus === "pending_deletion";
  const unavailable = session.accountStatus === "unavailable";
  const user = session.user;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  function signOut() {
    session.signOut();
    router.replace("/signin");
  }

  async function downloadAccountData() {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    let url = "";
    try {
      const data = await api.exportAccount();
      url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `giggle-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
    } catch {
      setExportError("Couldn't export your data. Please try again.");
    } finally {
      if (url) URL.revokeObjectURL(url);
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteAccount();
      signOut();
    } catch {
      setDeleteError("Couldn't start account deletion. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <>
      <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20, background: "var(--bg)", color: "var(--text)" }}>
        <section aria-labelledby="account-access-title" style={{ width: "min(100%, 520px)", padding: 28, borderRadius: "var(--radius-card, 20px)", border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--elev)" }}>
          <Logomark size={38} />
          <div style={{ marginTop: 22, color: "var(--accent)", fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {pendingDeletion ? "Deletion pending" : unavailable ? "Account unavailable" : "Account & data"}
          </div>
          <h1 id="account-access-title" style={{ margin: "8px 0", fontSize: 30, lineHeight: 1.12 }}>Your account controls remain available</h1>
          <p style={{ margin: "0 0 18px", color: "var(--text-muted)", lineHeight: 1.55 }}>
            {pendingDeletion
              ? "Your deletion request is being processed. Social features stay disabled while cleanup finishes."
              : unavailable
                ? "Social features are disabled for this account. You can still contact support, export your data, or delete your account."
                : "Social features stay disabled until age verification is complete. Your account controls remain available."}
          </p>
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--surface-2)", color: "var(--text-muted)", fontSize: 14, overflowWrap: "anywhere" }}>
            {user?.email || "Signed-in account"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
            <a href="/support" style={{ minHeight: 44, display: "inline-flex", alignItems: "center", padding: "0 16px", borderRadius: 12, border: "1px solid var(--border)", color: "var(--text)", fontWeight: 700, textDecoration: "none" }}>
              Contact support
            </a>
            <Button variant="secondary" loading={exporting} disabled={deleting} onClick={downloadAccountData}>Download my data</Button>
            <Button variant="danger" disabled={exporting || deleting} onClick={() => setDeleteStep(1)}>Delete account</Button>
          </div>
          {exportError && <p role="alert" style={{ margin: "12px 0 0", color: "var(--coral)", fontSize: 13 }}>{exportError}</p>}
          {onReturnToVerification && <Button variant="secondary" fullWidth onClick={onReturnToVerification}>Return to age verification</Button>}
          <button onClick={signOut} style={{ marginTop: 22, minHeight: 44, padding: 0, border: 0, background: "none", color: "var(--text-muted)", font: "inherit", fontWeight: 700, cursor: "pointer" }}>Sign out</button>
        </section>
      </main>

      {deleteStep === 1 && (
        <Modal onClose={() => setDeleteStep(0)} title="Delete account?" subtitle="Deletion revokes access immediately and may finish in the background.">
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setDeleteStep(0)}>Cancel</Button>
            <Button variant="danger" onClick={() => setDeleteStep(2)}>Continue</Button>
          </div>
        </Modal>
      )}
      {deleteStep === 2 && (
        <Modal onClose={() => { if (!deleting) setDeleteStep(0); }} title="Delete permanently?" subtitle="Your account cannot be restored after cleanup completes.">
          {deleteError && <p role="alert" style={{ color: "var(--coral)", fontSize: 13 }}>{deleteError}</p>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button variant="ghost" disabled={deleting} onClick={() => setDeleteStep(0)}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={deleteAccount}>Delete account</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
