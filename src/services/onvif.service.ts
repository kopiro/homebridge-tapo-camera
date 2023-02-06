import { EventEmitter } from 'stream';
import { Cam } from 'onvif';
import type { PlatformAccessory } from 'homebridge';
import type {
  DeviceInformation,
  VideoSource,
  NotificationMessage,
} from 'onvif';
import type { CameraConfig } from '../accessories/cameraAccessory';
import type { TapoCameraPlatform } from '../platform';

export default class OnvifService {
  private events: EventEmitter | undefined;
  private device: Cam | undefined;

  private readonly kOnvifPort = 2020;

  constructor(
    protected readonly platform: TapoCameraPlatform,
    protected readonly accessory: PlatformAccessory<CameraConfig>,
  ) { }

  private async getDevice(): Promise<Cam> {
    return new Promise((resolve, reject) => {
      if (this.device) {
        return resolve(this.device);
      }

      const device: Cam = new Cam(
        {
          hostname: this.accessory.context.ipAddress,
          username: this.accessory.context.streamUser,
          password: this.accessory.context.streamPassword,
          port: this.kOnvifPort,
        },
        (err) => {
          if (err) {
            return reject(err);
          }
          this.device = device;
          return resolve(this.device);
        },
      );
    });
  }

  async getEventEmitter() {
    if (this.events) {
      return this.events;
    }

    const onvifDevice = await this.getDevice();

    let lastMotionValue = false;

    this.events = new EventEmitter();
    this.platform.log.debug(`[${this.accessory.context.name}]`, 'Starting ONVIF listener');

    onvifDevice.on('event', (event: NotificationMessage) => {
      if (event?.topic?._?.match(/RuleEngine\/CellMotionDetector\/Motion$/)) {
        const motion = event.message.message.data.simpleItem.$.Value;
        if (motion !== lastMotionValue) {
          lastMotionValue = Boolean(motion);
          this.events = this.events || new EventEmitter();
          this.events.emit('motion', motion);
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
    return new Promise((resolve, reject) => {
      onvifDevice.getDeviceInformation((err, deviceInformation) => {
        if (err) {
          return reject(err);
        }
        resolve(deviceInformation);
      });
    });
  }
}
