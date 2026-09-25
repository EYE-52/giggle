import { notFound } from "next/navigation";
import { CallStageHarness } from "./CallStageHarness";

/** Dev-only harness: the real AdaptiveVideoStage with synthetic camera streams of exact
 *  shapes, so rosters (1–8 per side) and mixed devices can be checked in a browser.
 *  Returns 404 in production builds. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CallStageHarness />;
}
