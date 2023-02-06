import { Logger } from 'homebridge-camera-ffmpeg/dist/logger';
import { StreamingDelegate } from 'homebridge-camera-ffmpeg/dist/streamingDelegate';
import TapoService from '../services/tapo.service';
import OnvifService from '../services/onvif.service';
import type {
  Service,
  PlatformAccessory,
  Logging,
} from 'homebridge';
import type { DeviceInformation } from 'onvif';
import type { VideoConfig } from 'homebridge-camera-ffmpeg/dist/configTypes';
import type { TapoCameraPlatform } from '../platform';

export type CameraConfig = {
  name: string;
  ipAddress: string;
  password: string;
  streamUser: string;
  streamPassword: string;

  pullInterval?: number;
  disableStreaming?: boolean;
  disablePrivacyAccessory?: boolean;
  disableAlarmAccessory?: boolean;
  disableMotionAccessory?: boolean;
  lowQuality?: boolean;

  videoConfig?: VideoConfig;
};

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CameraAccessory {

  private tapoService: TapoService | undefined;
  private onvifService: OnvifService | undefined;

  private alarmService: Service | undefined;
  private privacyService: Service | undefined;
  private motionService: Service | undefined;

  private cameraStatus: { lensMask: boolean; alert: boolean } | undefined;
  private cameraInfo: DeviceInformation | undefined;

  private pullIntervalTick: NodeJS.Timeout | undefined;
  private readonly randomSeed = Math.random();

  constructor(
    private readonly platform: TapoCameraPlatform,
    private readonly accessory: PlatformAccessory<CameraConfig>,
  ) {

    this.tapoService = new TapoService(platform, accessory);
    this.onvifService = new OnvifService(platform, accessory);

    this.onvifService.getDeviceInfo().then((deviceInfo) => {

      // add services
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, deviceInfo.manufacturer)
        .setCharacteristic(this.platform.Characteristic.Model, deviceInfo.model)
        .setCharacteristic(this.platform.Characteristic.SerialNumber, deviceInfo.serialNumber)
        .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '1.0');

      this.alarmService = this.accessory.addService(
        this.platform.Service.Switch,
        `${this.accessory.context.name} - alarm`,
        'alarm',
      );
      this.privacyService = this.accessory.addService(
        this.platform.Service.Switch,
        `${this.accessory.context.name} - Eyes`,
        'eyes',
      );
      this.motionService = this.accessory.addService(
        this.platform.Service.MotionSensor,
        `${this.accessory.context.name} - Motion`,
        'motion',
      );

      // add handlers
      this.alarmService
        .getCharacteristic(this.platform.api.hap.Characteristic.On)
        .onGet(() => {
          if (!this.cameraStatus) {
            throw new this.platform.api.hap.HapStatusError(
              this.platform.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST,
            );
          }
          return this.cameraStatus.alert;
        })
        .onSet((status) => {
          this.platform.log.debug(`Setting alarm to ${status ? 'on' : 'off'}`);
          this.tapoService?.setAlertConfig(Boolean(status))
            .catch(err => {
              this.platform.log.error(
                `[${this.accessory.context.name}]`,
                'Error at \'setAlertConfig\'.',
                err,
              );
              this.cameraStatus = undefined; // Home.app shows 'No Response'
            });
        });

      this.privacyService
        .getCharacteristic(this.platform.api.hap.Characteristic.On)
        .onGet(async () => {
          if (!this.cameraStatus) {
            throw new this.platform.api.hap.HapStatusError(
              this.platform.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST,
            );
          }
          return !this.cameraStatus.lensMask;
        })
        .onSet((status) => {
          this.platform.log.debug(`Setting privacy to ${status ? 'on' : 'off'}`);
          this.tapoService?.setLensMaskConfig(!status)
            .catch(err => {
              this.platform.log.error(
                `[${this.accessory.context.name}]`,
                'Error at \'setLensMaskConfig\'.',
                err,
              );
              this.cameraStatus = undefined; // Home.app shows 'No Response'
            });
        });

      this.onvifService?.getEventEmitter().then((eventEmitter) => {
        eventEmitter.addListener('motion', (motionDetected) => {
          this.platform.log.info(`[${this.accessory.context.name}]`, 'Motion detected', motionDetected);

          this.motionService?.updateCharacteristic(
            this.platform.api.hap.Characteristic.MotionDetected,
            motionDetected,
          );
        });
      });

      // Only setup the polling if needed
      if (this.privacyService || this.alarmService) {
        this.getStatusAndUpdateCharacteristics().then(() => {


          // Setup the polling by giving a 3s random delay
          // to avoid all the cameras starting at the same time
          setTimeout(() => {
            this.platform.log.debug(`[${this.accessory.context.name}]`, 'Setup polling');
            if (this.pullIntervalTick) {
              clearInterval(this.pullIntervalTick);
            }

            this.pullIntervalTick = setInterval(async () => {
              await this.getStatusAndUpdateCharacteristics();
            }, this.accessory.context.pullInterval || this.platform.kDefaultPullInterval);
          }, this.randomSeed * 3000);
        });
      }

      const streamingDelegate = new StreamingDelegate(
        new Logger(this.platform.log as Logging /* I'm unsure of this cast */),
        {
          name: this.accessory.context.name,
          manufacturer: deviceInfo.manufacturer,
          model: deviceInfo.model,
          serialNumber: deviceInfo.serialNumber,
          firmwareRevision: deviceInfo.firmwareVersion,
          unbridge: true,
          videoConfig: this.getVideoConfig(),
        },
        this.platform.api,
        this.platform.api.hap,
      );

      this.accessory.configureController(streamingDelegate.controller);
    });
  }

  private getVideoConfig(): VideoConfig {
    const streamUrl = this.tapoService?.getAuthenticatedStreamUrl(
      Boolean(this.accessory.context.lowQuality),
    );

    const config: VideoConfig = {
      source: `-i ${streamUrl}`,
      audio: true,
      videoFilter: 'none',
      vcodec: 'copy',
      maxWidth: this.accessory.context.lowQuality ? 640 : 1920,
      maxHeight: this.accessory.context.lowQuality ? 480 : 1080,
      maxFPS: 15,
      forceMax: true,
      ...(this.accessory.context.videoConfig || {}),
    };
    return config;
  }

  private updateCharacteristics({
    alert,
    lensMask,
  }: {
    alert: boolean;
    lensMask: boolean;
  }) {
    this.platform.log.debug('Updating characteristics', { alert, lensMask });
    this.alarmService
      ?.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .updateValue(alert);
    this.privacyService
      ?.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .updateValue(!lensMask);
  }

  private async getStatusAndUpdateCharacteristics() {

    this.tapoService?.getStatus().then((cameraStatus) => {
      this.cameraStatus = cameraStatus;
      this.updateCharacteristics(this.cameraStatus);
    }).catch((err) => {
      // When the camera stops responding or a token error occurs.
      this.platform.log.error('Error at \'getStatusAndUpdateCharacteristics\'.', err);
      this.cameraStatus = undefined; // Home.app shows 'No Response'
    });
  }
}
