import { getSocket, sendMemberMedia } from "@giggle/core";

type ShareLease = { socketId: string; mediaSessionId: string };
const shares = new Map<string, ShareLease>();

/** Bind each capture attempt to its own server lease, including delayed cleanup. */
export async function publishScreenPresence(
  squadId: string,
  encounterId: string | null,
  sharing: boolean,
  context?: { shareId: string },
) {
  if (!context) throw new Error("The screen-sharing session could not be identified.");
  const scope = { squadId, ...(encounterId ? { encounterId } : {}) };
  let lease = shares.get(context.shareId);
  if (!sharing) {
    shares.delete(context.shareId);
    if (lease) await sendMemberMedia({ ...scope, action:"end", mediaSessionId:lease.mediaSessionId });
    return;
  }

  const socketId = getSocket().id;
  if (!socketId) throw new Error("Reconnect your call, then share your screen again.");
  if (!lease || lease.socketId !== socketId) {
    const result = await sendMemberMedia({ ...scope, action:"begin" });
    if (!result.ok || !result.mediaSessionId) throw new Error("Screen sharing could not start. Please try again.");
    lease = { socketId, mediaSessionId:result.mediaSessionId };
    shares.set(context.shareId, lease);
  }
  const result = await sendMemberMedia({ ...scope, action:"update", mediaSessionId:lease.mediaSessionId, screenSharing:true });
  if (!result.ok) throw new Error("Screen sharing lost its connection. Please try again.");
}
