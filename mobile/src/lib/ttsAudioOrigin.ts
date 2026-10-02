export type RemoteTtsAudioOrigin =
  | "server_payload_prefetch"
  | "in_flight_prefetch"
  | "foreground_generation";

export interface RemoteTtsAudioResult {
  bytes: Uint8Array;
  contentType: string;
  audioOrigin: RemoteTtsAudioOrigin;
}

export function buildRemoteTtsAudioResult(params: {
  bytes: Uint8Array;
  contentType: string;
  audioSourceHeader: string | null;
}): RemoteTtsAudioResult {
  const normalizedAudioSource = params.audioSourceHeader?.trim().toLowerCase();
  const audioOrigin: RemoteTtsAudioOrigin =
    normalizedAudioSource === "server_payload_prefetch"
    || normalizedAudioSource === "in_flight_prefetch"
    || normalizedAudioSource === "foreground_generation"
      ? normalizedAudioSource
      : "foreground_generation";
  return {
    bytes: params.bytes,
    contentType: params.contentType,
    audioOrigin,
  };
}
