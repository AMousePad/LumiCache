import type { SpindleAPI } from "lumiverse-spindle-types";
declare const spindle: SpindleAPI;
/** Backend only. The browser side uses ctx.uuid in ui/bridge.ts. */
export const uuid = () => spindle.uuid.v4();
