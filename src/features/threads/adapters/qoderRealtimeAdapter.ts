import type { RealtimeAdapter } from "../contracts/conversationCurtainContracts";
import { mapCommonRealtimeEvent } from "./sharedRealtimeAdapter";

export const qoderRealtimeAdapter: RealtimeAdapter = {
  engine: "qoder",
  mapEvent(input: unknown) {
    return mapCommonRealtimeEvent("qoder", input, {
      allowTextDeltaAlias: true,
    });
  },
};
