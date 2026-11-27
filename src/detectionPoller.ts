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

// alarm_type values from the Tapo app's event history.
const PERSON_TYPES = new Set([6]);
const DOORBELL_TYPES = new Set([17, 18]);

// How far back to ask for, and how old an event can be and still count.
const SEARCH_WINDOW_SECONDS = 120;
const MAX_EVENT_AGE_SECONDS = 90;
const CLOCK_REFRESH_MS = 60 * 60 * 1000;

export type DetectionSource = {
  getClockOffsetSeconds(): Promise<number | undefined>;
  getDetectionEvents(start: number, end: number): Promise<TAPODetectionEvent[]>;
};

export function classifyAlarmType(alarmType: number): DetectionKind | undefined {
  if (PERSON_TYPES.has(alarmType)) return "person";
  if (DOORBELL_TYPES.has(alarmType)) return "doorbell";
  return undefined;
}

export class DetectionPoller {
  private timer: NodeJS.Timeout | undefined;
  private clockOffset: number | undefined;
  private clockCheckedAt = 0;
  private readonly seen = new Map<string, number>();
  private primed = false;
  private busy = false;
  private warned = false;

  constructor(
    private readonly camera: DetectionSource,
    private readonly log: Logging,
    private readonly intervalSeconds: number,
    private readonly onEvent: (kind: DetectionKind) => void,
    private readonly now: () => number = Date.now
  ) {}

  start() {
    if (this.intervalSeconds <= 0 || this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.poll(), this.intervalSeconds * 1000);
    void this.poll();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async poll(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;

    try {
      if (
        this.clockOffset === undefined ||
        this.now() - this.clockCheckedAt > CLOCK_REFRESH_MS
      ) {
        const offset = await this.camera.getClockOffsetSeconds();
        this.clockOffset = offset ?? this.clockOffset ?? 0;
        this.clockCheckedAt = this.now();
      }

      const cameraNow = Math.round(this.now() / 1000) - (this.clockOffset ?? 0);
      const events = await this.camera.getDetectionEvents(
        cameraNow - SEARCH_WINDOW_SECONDS,
        cameraNow + 60
      );

      for (const event of events) {
        const key = `${event.alarm_type}:${event.start_time}`;
        if (this.seen.has(key)) {
          continue;
        }
        this.seen.set(key, event.start_time);

        // The first poll only records what is already there, so old events
        // don't fire when Homebridge starts.
        if (!this.primed) {
          continue;
        }
        if (cameraNow - event.start_time > MAX_EVENT_AGE_SECONDS) {
          continue;
        }

        const kind = classifyAlarmType(event.alarm_type);
        if (kind) {
          this.log.debug(`Event history: ${kind} (alarm_type ${event.alarm_type})`);
          this.onEvent(kind);
        }
      }

      this.primed = true;
      this.warned = false;

      for (const [key, startTime] of this.seen) {
        if (cameraNow - startTime > SEARCH_WINDOW_SECONDS * 5) {
          this.seen.delete(key);
        }
      }
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        this.log.warn(
          "Could not read the camera's event history (needs a microSD card with event recording on). Will keep trying.",
          err instanceof Error ? err.message : err
        );
      } else {
        this.log.debug("Event history poll failed", err);
      }
    } finally {
      this.busy = false;
    }
  }
}
