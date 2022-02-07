import { Logging } from "homebridge";
import { CameraConfig } from "./cameraAccessory";
import {
  Cam,
  DeviceInformation,
  VideoSource,
  NotificationMessage,
} from "onvif";
import { Camera } from "./camera";
import { EventEmitter } from "stream";

export class OnvifCamera extends Camera {
  private events: EventEmitter | undefined;
  private device: Cam | undefined;
  private readonly kOnvifPort = 2020;

  constructor(log: Logging, config: CameraConfig) {
    super(log, config);
  }

  private async getDevice(): Promise<Cam> {
    return new Promise((resolve, reject) => {
      if (this.device) return resolve(this.device);

      const device: Cam = new Cam(
        {
          hostname: this.config.ipAddress,
          username: this.config.streamUser,
          password: this.config.streamPassword,
          port: this.kOnvifPort,
        },
        (err) => {
          if (err) return reject(err);
          this.device = device;
          return resolve(this.device);
        }
      );
    });
  }

  async getEventEmitter() {
    if (this.events) return this.events;

    const onvifDevice = await this.getDevice();

    let lastMotionValue = false;

    this.events = new EventEmitter();
    this.log.debug(`[${this.config.name}]`, "Starting event listener");

    onvifDevice.on("event", (event: NotificationMessage) => {
      if (event?.topic?._?.match(/RuleEngine\/CellMotionDetector\/Motion$/)) {
        const motion = event.message.message.data.simpleItem.$.Value;
        if (motion !== lastMotionValue) {
          lastMotionValue = motion;
          this.events!.emit("motion", motion);
        }
      }
    });

    return this.events;
  }

  async getVideoSource(): Promise<VideoSource> {
    const onvifDevice = await this.getDevice();
    return onvifDevice.videoSources[0];
  }

  async getDeviceInfo(): Promise<DeviceInformation> {
    const onvifDevice = await this.getDevice();
    return new Promise(async (resolve, reject) => {
      onvifDevice.getDeviceInformation((err, deviceInformation) => {
        if (err) return reject(err);
        resolve(deviceInformation);
      });
    });
  }
}
