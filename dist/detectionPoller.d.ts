import type { Logging } from "homebridge";
import type { TAPODetectionEvent } from "./types/tapo";
/**
 * Backup source for person and doorbell events.
 *
 * Some Tapo models (doorbells especially) only send motion over ONVIF, but they
 * still log person detections and doorbell presses in their event history. This
 * asks the camera for its recent history every few seconds and reports anything
 * new. It only works when the camera records events to a microSD card.
 */
export type DetectionKind = "person" | "doorbell";
export type DetectionSource = {
    getClockOffsetSeconds(): Promise<number | undefined>;
    getDetectionEvents(start: number, end: number): Promise<TAPODetectionEvent[]>;
};
export declare function classifyAlarmType(alarmType: number): DetectionKind | undefined;
export declare class DetectionPoller {
    private readonly camera;
    private readonly log;
    private readonly intervalSeconds;
    private readonly onEvent;
    private readonly now;
    private timer;
    private clockOffset;
    private clockCheckedAt;
    private readonly seen;
    private primed;
    private busy;
    private warned;
    constructor(camera: DetectionSource, log: Logging, intervalSeconds: number, onEvent: (kind: DetectionKind) => void, now?: () => number);
    start(): void;
    stop(): void;
    poll(): Promise<void>;
}
