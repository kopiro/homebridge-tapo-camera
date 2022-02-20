import {
  API,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  Service,
} from "homebridge";
import { StreamingDelegate } from "homebridge-camera-ffmpeg/dist/streamingDelegate";
import { Logger } from "homebridge-camera-ffmpeg/dist/logger";
import { TAPOCamera } from "./tapoCamera";
import { pkg } from "./pkg";
import { DeviceInformation } from "onvif";
import { CameraPlatform } from "./cameraPlatform";
import { VideoConfig } from "homebridge-camera-ffmpeg/dist/configTypes";

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

export class CameraAccessory {
  private readonly log: Logging = this.platform.log;
  private readonly api: API = this.platform.api;

  private readonly camera: TAPOCamera = new TAPOCamera(this.log, this.config);
  private cameraStatus: { lensMask: boolean; alert: boolean } | undefined;
  private cameraInfo: DeviceInformation | undefined;

  private pullIntervalTick: NodeJS.Timeout | undefined;

  private readonly accessory: PlatformAccessory =
    new this.api.platformAccessory(
      this.config.name,
      this.api.hap.uuid.generate(this.config.name),
      this.api.hap.Categories.CAMERA
    );

  private infoAccessory: Service | undefined;
  private alarmService: Service | undefined;
  private privacyService: Service | undefined;
  private motionService: Service | undefined;

  private readonly randomSeed = Math.random();

  constructor(private platform: CameraPlatform, private config: CameraConfig) {}

  private setupInfoAccessory(deviceInfo: DeviceInformation) {
    this.infoAccessory = this.accessory.getService(
      this.api.hap.Service.AccessoryInformation
    );
    if (!this.infoAccessory) return;

    this.infoAccessory
      .setCharacteristic(
        this.api.hap.Characteristic.Manufacturer,
        deviceInfo.manufacturer
      )
      .setCharacteristic(this.api.hap.Characteristic.Model, deviceInfo.model)
      .setCharacteristic(
        this.api.hap.Characteristic.SerialNumber,
        deviceInfo.serialNumber
      )
      .setCharacteristic(
        this.api.hap.Characteristic.FirmwareRevision,
        deviceInfo.firmwareVersion
      );
  }

  private setupAlarmAccessory() {
    const name = `${this.config.name} - Alarm`;
    this.alarmService = this.accessory.addService(
      this.api.hap.Service.Switch,
      name,
      "alarm"
    );
    this.alarmService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(() => {
        if (!this.cameraStatus) {
          throw new this.api.hap.HapStatusError(
            this.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST
          );
        }
        return this.cameraStatus.alert;
      })
      .onSet((status) => {
        this.log.debug(`Setting alarm to ${status ? "on" : "off"}`);
        this.camera.setAlertConfig(Boolean(status))
          .catch(err => {
            this.log.error(
              `[${this.config.name}]`,
              "Error at 'setAlertConfig'.",
              err
            );
            this.cameraStatus = undefined; // Home.app shows 'No Response'
          });
      });
  }

  private setupPrivacyModeAccessory() {
    const name = `${this.config.name} - Eyes`;
    this.privacyService = this.accessory.addService(
      this.api.hap.Service.Switch,
      name,
      "eyes"
    );
    this.privacyService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        if (!this.cameraStatus) {
          throw new this.api.hap.HapStatusError(
            this.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST
          );
        }
        return !this.cameraStatus.lensMask;
      })
      .onSet((status) => {
        this.log.debug(`Setting privacy to ${status ? "on" : "off"}`);
        this.camera.setLensMaskConfig(!status)
          .catch(err => {
            this.log.error(
              `[${this.config.name}]`,
              "Error at 'setLensMaskConfig'.",
              err
            );
            this.cameraStatus = undefined; // Home.app shows 'No Response'
          });
      });
  }

  private getVideoConfig(): VideoConfig {
    const streamUrl = this.camera.getAuthenticatedStreamUrl(
      Boolean(this.config.lowQuality)
    );

    const config: VideoConfig = {
      source: `-i ${streamUrl}`,
      audio: true,
      videoFilter: "none",
      vcodec: "copy",
      maxWidth: this.config.lowQuality ? 640 : 1920,
      maxHeight: this.config.lowQuality ? 480 : 1080,
      maxFPS: 15,
      forceMax: true,
      ...(this.config.videoConfig || {}),
    };
    return config;
  }

  private async setupCameraStreaming(deviceInfo: DeviceInformation) {
    const delegate = new StreamingDelegate(
      new Logger(this.log),
      {
        name: this.config.name,
        manufacturer: deviceInfo.manufacturer,
        model: deviceInfo.model,
        serialNumber: deviceInfo.serialNumber,
        firmwareRevision: deviceInfo.firmwareVersion,
        unbridge: true,
        videoConfig: this.getVideoConfig(),
      },
      this.api,
      this.api.hap
    );

    this.accessory.configureController(delegate.controller);
  }

  private async setupMotionDetectionAccessory() {
    const name = `${this.config.name} - Motion`;
    this.motionService = this.accessory.addService(
      this.api.hap.Service.MotionSensor,
      name,
      "alarm"
    );

    const eventEmitter = await this.camera.getEventEmitter();
    eventEmitter.addListener("motion", (motionDetected) => {
      this.log.info(`[${this.config.name}]`, "Motion detected", motionDetected);

      this.motionService?.updateCharacteristic(
        this.api.hap.Characteristic.MotionDetected,
        motionDetected
      );
    });
  }

  private setupPolling() {
    if (this.pullIntervalTick) {
      clearInterval(this.pullIntervalTick);
    }

    this.pullIntervalTick = setInterval(async () => {
      await this.getStatusAndUpdateCharacteristics();
    }, this.config.pullInterval || this.platform.kDefaultPullInterval);
  }

  private updateCharacteristics({
    alert,
    lensMask,
  }: {
    alert: boolean;
    lensMask: boolean;
  }) {
    this.platform.log.debug("Updating characteristics", { alert, lensMask });
    this.alarmService
      ?.getCharacteristic(this.api.hap.Characteristic.On)
      .updateValue(alert);
    this.privacyService
      ?.getCharacteristic(this.api.hap.Characteristic.On)
      .updateValue(!lensMask);
  }

  private async getStatusAndUpdateCharacteristics() {
    try {
      this.cameraStatus = await this.camera.getStatus();
      this.updateCharacteristics(this.cameraStatus);
    } catch (err) {
      // When the camera stops responding or a token error occurs.
      this.log.error("Error at 'getStatusAndUpdateCharacteristics'.", err);
      this.cameraStatus = undefined; // Home.app shows 'No Response'
    }
  }

  async setup() {
    this.cameraInfo = await this.camera.getDeviceInfo();
    this.setupInfoAccessory(this.cameraInfo);

    if (!this.config.disableStreaming) {
      this.setupCameraStreaming(this.cameraInfo);
    }

    if (!this.config.disablePrivacyAccessory) {
      this.setupPrivacyModeAccessory();
    }

    if (!this.config.disableAlarmAccessory) {
      this.setupAlarmAccessory();
    }

    if (!this.config.disableMotionAccessory) {
      this.setupMotionDetectionAccessory();
    }

    // Only setup the polling if needed
    if (this.privacyService || this.alarmService) {
      await this.getStatusAndUpdateCharacteristics();

      // Setup the polling by giving a 3s random delay
      // to avoid all the cameras starting at the same time
      setTimeout(() => {
        this.platform.log.debug(`[${this.config.name}]`, "Setup polling");
        this.setupPolling();
      }, this.randomSeed * 3000);
    }

    this.api.publishExternalAccessories(pkg.pluginId, [this.accessory]);

    this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info(
        `[${this.config.name}]`,
        "Identify requested",
        this.cameraInfo
      );
    });
  }
}
