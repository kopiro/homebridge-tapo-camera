import {
  API,
  APIEvent,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  Service,
} from "homebridge";
import { StreamingDelegate } from "homebridge-camera-ffmpeg/dist/streamingDelegate";
import { Logger } from "homebridge-camera-ffmpeg/dist/logger";
import { TAPOCamera } from "./tapoCamera";
import { pkg } from "./pkg";

export type CameraConfig = {
  name: string;
  ipAddress: string;
  password: string;
  streamUser: string;
  streamPassword: string;
  videoDebug: boolean;
  pullInterval: number;
  unbridge: boolean;
};

export class CameraAccessory {
  private readonly log: Logging;
  private readonly config: CameraConfig;
  private readonly api: API;
  private readonly tapoCamera: TAPOCamera;

  private readonly kDefaultPullInterval = 60000;

  private pullIntervalTick: NodeJS.Timeout | undefined;
  private alarmService: Service | undefined;
  private privacyService: Service | undefined;

  public uuid: string;
  private accessory: PlatformAccessory;

  constructor(log: Logging, config: CameraConfig, api: API) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.uuid = this.api.hap.uuid.generate(this.config.name);
    this.accessory = new this.api.platformAccessory(
      this.config.name,
      this.uuid
    );
    this.tapoCamera = new TAPOCamera(this.log, this.config);

    this.setup();
  }

  private async setupInfoAccessory(
    deviceInfo: TAPOCameraResponseDeviceInfo["result"]["device_info"]["basic_info"]
  ) {
    const accInfo = this.accessory.getService(
      this.api.hap.Service.AccessoryInformation
    );
    if (!accInfo) return;

    accInfo.setCharacteristic(this.api.hap.Characteristic.Manufacturer, "TAPO");
    accInfo.setCharacteristic(
      this.api.hap.Characteristic.Model,
      deviceInfo.device_model
    );
    accInfo.setCharacteristic(
      this.api.hap.Characteristic.SerialNumber,
      deviceInfo.mac
    );
    accInfo.setCharacteristic(
      this.api.hap.Characteristic.FirmwareRevision,
      deviceInfo.sw_version
    );
  }

  private getAlarmCharacteristic(status: {
    lensMask: boolean;
    alert: boolean;
  }) {
    return status.alert;
  }

  private getPrivacyCharacteristic(status: {
    lensMask: boolean;
    alert: boolean;
  }) {
    return !status.lensMask;
  }

  private setupAlarmAccessory() {
    this.alarmService = new this.api.hap.Service.Switch(
      `Alarm: ${this.accessory.displayName}`,
      "Alarm"
    );
    this.alarmService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        const status = await this.tapoCamera.getStatus();
        return this.getAlarmCharacteristic(status);
      })
      .onSet((status) => {
        this.log.debug("onSet", status);
        this.tapoCamera.setAlarmConfig(Boolean(status));
      });
    this.accessory.addService(this.alarmService);
  }

  private setupPrivacyModeAccessory() {
    this.privacyService = new this.api.hap.Service.Switch(
      `Privacy: ${this.accessory.displayName}`,
      "Privacy"
    );
    this.privacyService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        const status = await this.tapoCamera.getStatus();
        return this.getPrivacyCharacteristic(status);
      })
      .onSet((status) => {
        this.log.debug("onSet Privacy", status);
        // Privacy switch works in reverse
        this.tapoCamera.setLensMaskConfig(!Boolean(status));
      });
    this.accessory.addService(this.privacyService);
  }

  private setupCameraStreaming(
    deviceInfo: TAPOCameraResponseDeviceInfo["result"]["device_info"]["basic_info"]
  ) {
    const streamUrl = this.tapoCamera.getStreamUrl();
    const streamingConfig = {
      name: this.config.name,
      manufacturer: "TAPO",
      model: deviceInfo.device_model,
      serialNumber: deviceInfo.mac,
      firmwareRevision: deviceInfo.sw_version,
      unbridge: this.config.unbridge,
      videoConfig: {
        source: `-i ${streamUrl}`,
        audio: true,
        debug: this.config.videoDebug,
      },
    };
    const delegate = new StreamingDelegate(
      new Logger(this.log),
      streamingConfig,
      this.api,
      this.api.hap
    );
    this.accessory.configureController(delegate.controller);

    this.log.debug("Configured Camera Streaming", streamingConfig);
  }

  private async setup() {
    this.log.info("Setup camera ->", this.accessory.displayName);

    const deviceInfo = await this.tapoCamera.getInfo();

    this.setupInfoAccessory(deviceInfo);
    this.setupPrivacyModeAccessory();
    this.setupAlarmAccessory();

    this.setupCameraStreaming(deviceInfo);

    this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info("Identify requested.", this.accessory.displayName);
    });

    if (this.config.unbridge) {
      this.api.publishExternalAccessories(pkg.pluginName, [this.accessory]);
    } else {
      this.api.registerPlatformAccessories(pkg.pluginName, pkg.name, [
        this.accessory,
      ]);
    }

    this.pullIntervalTick = setInterval(async () => {
      this.log.debug("Pull Interval ticked!");

      const status = await this.tapoCamera.getStatus();
      this.alarmService
        ?.getCharacteristic(this.api.hap.Characteristic.On)
        .updateValue(this.getAlarmCharacteristic(status));
      this.privacyService
        ?.getCharacteristic(this.api.hap.Characteristic.On)
        .updateValue(this.getPrivacyCharacteristic(status));
    }, this.config.pullInterval || this.kDefaultPullInterval);
  }
}
