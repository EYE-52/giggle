/** Creation intent never updates an existing room. Matching uses video. */
export type CommunicationMode = "video" | "voice" | "chat";
export function readRoomCreateIntent(search: string): {
  requested: boolean;
  communicationMode: CommunicationMode;
  matching: boolean;
} {
  const params = new URLSearchParams(search);
  const requested = params.get("create") === "1";
  const matching = requested && params.get("match") === "1";
  const mode = params.get("mode");
  return {
    requested,
    matching,
    communicationMode: requested && !matching && (mode === "voice" || mode === "chat") ? mode : "video",
  };
}
