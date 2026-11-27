"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DetectionPoller = void 0;
exports.classifyAlarmType = classifyAlarmType;
// alarm_type values from the Tapo app's event history.
const PERSON_TYPES = new Set([6]);
const DOORBELL_TYPES = new Set([17, 18]);
// How far back to ask for, and how old an event can be and still count.
const SEARCH_WINDOW_SECONDS = 120;
const MAX_EVENT_AGE_SECONDS = 90;
const CLOCK_REFRESH_MS = 60 * 60 * 1000;
function classifyAlarmType(alarmType) {
    if (PERSON_TYPES.has(alarmType))
        return "person";
    if (DOORBELL_TYPES.has(alarmType))
        return "doorbell";
    return undefined;
}
class DetectionPoller {
    camera;
    log;
    intervalSeconds;
    onEvent;
    now;
    timer;
    clockOffset;
    clockCheckedAt = 0;
    seen = new Map();
    primed = false;
    busy = false;
    warned = false;
    constructor(camera, log, intervalSeconds, onEvent, now = Date.now) {
        this.camera = camera;
        this.log = log;
        this.intervalSeconds = intervalSeconds;
        this.onEvent = onEvent;
        this.now = now;
    }
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
    async poll() {
        if (this.busy) {
            return;
        }
        this.busy = true;
        try {
            if (this.clockOffset === undefined ||
                this.now() - this.clockCheckedAt > CLOCK_REFRESH_MS) {
                const offset = await this.camera.getClockOffsetSeconds();
                this.clockOffset = offset ?? this.clockOffset ?? 0;
                this.clockCheckedAt = this.now();
            }
            const cameraNow = Math.round(this.now() / 1000) - (this.clockOffset ?? 0);
            const events = await this.camera.getDetectionEvents(cameraNow - SEARCH_WINDOW_SECONDS, cameraNow + 60);
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
        }
        catch (err) {
            if (!this.warned) {
                this.warned = true;
                this.log.warn("Could not read the camera's event history (needs a microSD card with event recording on). Will keep trying.", err instanceof Error ? err.message : err);
            }
            else {
                this.log.debug("Event history poll failed", err);
            }
        }
        finally {
            this.busy = false;
        }
    }
}
exports.DetectionPoller = DetectionPoller;
//# sourceMappingURL=detectionPoller.js.map