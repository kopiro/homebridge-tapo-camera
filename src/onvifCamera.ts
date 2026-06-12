import { Logging } from "homebridge";
import { CameraConfig } from "./cameraAccessory";
import {
  DeviceInformation,
  NotificationMessage,
  Cam as ICam,
} from "./types/onvif";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { Cam } from "onvif";
import { EventEmitter } from "stream";

export class OnvifCamera {
  private events: EventEmitter | undefined;
  private device: Cam | undefined;
  private lastMotionValue = false;

  private readonly kOnvifPort = 2020;

  constructor(
    protected readonly log: Logging,
    protected readonly config: CameraConfig
  ) {}

  private async getDevice(): Promise<ICam> {
    return new Promise((resolve, reject) => {
      if (this.device) {
        return resolve(this.device);
      }

      const device: ICam = new Cam(
        {
          hostname: this.config.ipAddress,
          username: this.config.streamUser,
          password: this.config.streamPassword,
          port: this.kOnvifPort,
        },
        (err: Error) => {
          if (err) return reject(err);
          this.device = device;
          return resolve(this.device);
        }
      );
    });
  }

  get onvifConnected(): boolean {
    return !!this.device;
  }

  async getEventEmitter() {
    if (this.events) {
      return this.events;
    }

    this.events = new EventEmitter();
    try {
      await this.startOnvifListener();
    } catch (err) {
      this.log.error("Failed to start ONVIF listener, will retry later", err);
    }

    return this.events;
  }

  async restartOnvifConnection(): Promise<boolean> {
    if (!this.events) {
      return false;
    }
    this.log.debug("Restarting ONVIF connection...");
    if (this.device) {
      this.device.removeAllListeners("event");
      this.device = undefined;
    }
    try {
      await this.startOnvifListener();
      return true;
    } catch (err) {
      this.log.error("Failed to restart ONVIF connection", err);
      return false;
    }
  }

  private async startOnvifListener() {
    const onvifDevice = await this.getDevice();

    this.log.debug("Starting ONVIF listener...");

    onvifDevice.on("event", (event: NotificationMessage) => {
      if (event?.topic?._?.match(/RuleEngine\/CellMotionDetector\/Motion$/)) {
        const motion = event.message.message.data.simpleItem.$.Value;
        if (motion !== this.lastMotionValue) {
          this.lastMotionValue = Boolean(motion);
          if (this.events) {
            this.events.emit("motion", motion);
          }
        }
      }
    });
  }

  async getDeviceInfo(): Promise<DeviceInformation> {
    const onvifDevice = await this.getDevice();
    return new Promise((resolve, reject) => {
      onvifDevice.getDeviceInformation((err, deviceInformation) => {
        if (err) return reject(err);
        resolve(deviceInformation);
      });
    });
  }
}
