/** Creation intent never updates an existing room. Unknown modes keep video. */
export type CommunicationMode = "video" | "voice" | "chat";
export function readRoomCreateIntent(search: string): { requested: boolean; communicationMode: CommunicationMode } {
  const params = new URLSearchParams(search);
  const requested = params.get("create") === "1";
  const mode = params.get("mode");
  return { requested, communicationMode: requested && (mode === "voice" || mode === "chat") ? mode : "video" };
}
