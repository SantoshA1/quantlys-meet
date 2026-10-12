"use client";
// Drop-in for @livekit/components-react's useDataChannel.
//
// Under React 19 the hook's `send` can run before its internal
// isSending observable has a subscriber, and throws
// "Cannot read properties of undefined (reading 'next')" BEFORE publishing,
// so the message is silently lost (seen in E2E: recording state broadcast).
// Receiving still goes through the library hook; sending publishes directly.
import { useCallback } from "react";
import { useDataChannel as useLkDataChannel, useRoomContext } from "@livekit/components-react";

type SendOpts = { reliable?: boolean; destinationIdentities?: string[]; topic?: string };

export function useDataChannel(topic: string, onMessage?: (msg: any) => void) {
  const lk = useLkDataChannel(topic, onMessage as any);
  const room = useRoomContext();
  const send = useCallback(
    async (payload: Uint8Array, opts: SendOpts = {}) => {
      await room.localParticipant.publishData(payload, { topic, ...opts });
    },
    [room, topic]
  );
  return { ...lk, send };
}
