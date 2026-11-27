"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PresenceSensor = void 0;
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
class PresenceSensor {
    api;
    holdSeconds;
    maxOnSeconds;
    service;
    active = false;
    offTimer;
    safetyTimer;
    constructor(api, accessory, name, subtype, holdSeconds, maxOnSeconds = 300) {
        this.api = api;
        this.holdSeconds = holdSeconds;
        this.maxOnSeconds = maxOnSeconds;
        this.service = accessory.addService(api.hap.Service.OccupancySensor, name, subtype);
        this.service.addOptionalCharacteristic(api.hap.Characteristic.ConfiguredName);
        this.service.setCharacteristic(api.hap.Characteristic.ConfiguredName, name);
        this.write(false);
    }
    get isActive() {
        return this.active;
    }
    set(active) {
        if (active) {
            this.clearOffTimer();
            this.startSafetyTimer();
            this.write(true);
            return;
        }
        if (!this.active || this.offTimer) {
            return;
        }
        this.scheduleOff(this.holdSeconds);
    }
    pulse(seconds = this.holdSeconds) {
        this.clearOffTimer();
        this.write(true);
        this.scheduleOff(seconds);
    }
    scheduleOff(seconds) {
        this.clearOffTimer();
        if (seconds <= 0) {
            this.turnOff();
            return;
        }
        this.offTimer = setTimeout(() => this.turnOff(), seconds * 1000);
    }
    startSafetyTimer() {
        if (this.safetyTimer) {
            clearTimeout(this.safetyTimer);
        }
        this.safetyTimer = setTimeout(() => this.turnOff(), this.maxOnSeconds * 1000);
    }
    turnOff() {
        this.clearOffTimer();
        if (this.safetyTimer) {
            clearTimeout(this.safetyTimer);
            this.safetyTimer = undefined;
        }
        this.write(false);
    }
    clearOffTimer() {
        if (this.offTimer) {
            clearTimeout(this.offTimer);
            this.offTimer = undefined;
        }
    }
    write(active) {
        this.active = active;
        const { OccupancyDetected } = this.api.hap.Characteristic;
        this.service.updateCharacteristic(OccupancyDetected, active
            ? OccupancyDetected.OCCUPANCY_DETECTED
            : OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    }
}
exports.PresenceSensor = PresenceSensor;
//# sourceMappingURL=presenceSensor.js.map