import type { API, PlatformAccessory, Service } from "homebridge";
/**
 * An occupancy ("presence") sensor service on the camera accessory.
 *
 * - `set(true/false)` follows a live signal (e.g. ONVIF person events). When it
 *   goes off, the sensor stays on for `holdSeconds` so automations don't flicker.
 * - `pulse()` is for one-off events (e.g. a doorbell press): on now, off after
 *   `holdSeconds`.
 *
 * If a live signal never sends "off" (for example the camera reboots mid-event),
 * the sensor clears itself after `maxOnSeconds` so it can trigger again.
 */
export declare class PresenceSensor {
    private readonly api;
    private readonly holdSeconds;
    private readonly maxOnSeconds;
    readonly service: Service;
    private active;
    private offTimer;
    private safetyTimer;
    constructor(api: API, accessory: PlatformAccessory, name: string, subtype: string, holdSeconds: number, maxOnSeconds?: number);
    get isActive(): boolean;
    set(active: boolean): void;
    pulse(seconds?: number): void;
    private scheduleOff;
    private startSafetyTimer;
    private turnOff;
    private clearOffTimer;
    private write;
}
