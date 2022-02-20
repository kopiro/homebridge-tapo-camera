import { Logging } from "homebridge";
import { CameraConfig } from "./cameraAccessory";
import { Cam, DeviceInformation, NotificationMessage, Profile } from "onvif";
import { EventEmitter } from "stream";
import { promisify } from "util";

export class OnvifCamera {
  private events: EventEmitter | undefined;
  private _device: Cam | undefined;

  private readonly kOnvifPort = 2020;

  constructor(
    protected readonly log: Logging,
    protected readonly config: CameraConfig
  ) {}

  private async getDevice(): Promise<Cam> {
    if (this._device) return this._device;

    return new Promise((resolve, reject) => {
      const device: Cam = new Cam(
        {
          hostname: this.config.ipAddress,
          username: this.config.streamUser,
          password: this.config.streamPassword,
          port: this.kOnvifPort,
        },
        (err) => {
          if (err) return reject(err);
          this._device = device;
          return resolve(this._device);
        }
      );
    });
  }

  public async getProfiles(): Promise<Profile[]> {
    const device = await this.getDevice();
    return promisify(device.getProfiles).bind(device)();
  }

  public async getDeviceInformation(): Promise<DeviceInformation> {
    const device = await this.getDevice();
    return promisify(device.getDeviceInformation).bind(device)();
  }

  async getEventEmitter() {
    if (this.events) return this.events;

    const device = await this.getDevice();

    let lastMotionValue = false;

    this.events = new EventEmitter();
    this.log.debug(`[${this.config.name}]`, "Starting ONVIF listener");

    device.on("event", (event: NotificationMessage) => {
      if (event?.topic?._?.match(/RuleEngine\/CellMotionDetector\/Motion$/)) {
        const motion = Boolean(event.message.message.data.simpleItem.$.Value);
        if (motion !== lastMotionValue) {
          lastMotionValue = motion;
          this.events?.emit("motion", motion);
        }
      }
    });

    return this.events;
  }
}
