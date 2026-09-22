import { notFound, redirect } from "next/navigation";

/** Keep design review on the approved Site, not an independently styled test page. */
export default function DesignCheckPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  redirect("https://giggle-design-playground.divyanx.chatgpt.site/?v=9#encounter");
}
