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
export class PresenceSensor {
  readonly service: Service;

  private active = false;
  private offTimer: NodeJS.Timeout | undefined;
  private safetyTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly api: API,
    accessory: PlatformAccessory,
    name: string,
    subtype: string,
    private readonly holdSeconds: number,
    private readonly maxOnSeconds = 300
  ) {
    this.service = accessory.addService(
      api.hap.Service.OccupancySensor,
      name,
      subtype
    );
    this.service.addOptionalCharacteristic(
      api.hap.Characteristic.ConfiguredName
    );
    this.service.setCharacteristic(api.hap.Characteristic.ConfiguredName, name);
    this.write(false);
  }

  get isActive(): boolean {
    return this.active;
  }

  set(active: boolean) {
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

  private scheduleOff(seconds: number) {
    this.clearOffTimer();
    if (seconds <= 0) {
      this.turnOff();
      return;
    }
    this.offTimer = setTimeout(() => this.turnOff(), seconds * 1000);
  }

  private startSafetyTimer() {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
    }
    this.safetyTimer = setTimeout(
      () => this.turnOff(),
      this.maxOnSeconds * 1000
    );
  }

  private turnOff() {
    this.clearOffTimer();
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = undefined;
    }
    this.write(false);
  }

  private clearOffTimer() {
    if (this.offTimer) {
      clearTimeout(this.offTimer);
      this.offTimer = undefined;
    }
  }

  private write(active: boolean) {
    this.active = active;
    const { OccupancyDetected } = this.api.hap.Characteristic;
    this.service.updateCharacteristic(
      OccupancyDetected,
      active
        ? OccupancyDetected.OCCUPANCY_DETECTED
        : OccupancyDetected.OCCUPANCY_NOT_DETECTED
    );
  }
}
