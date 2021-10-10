import {
  AccessoryConfig,
  API,
  APIEvent,
  Characteristic,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
  Service,
} from "homebridge";
import fetch from "node-fetch";
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
};

export class CameraAccessory {
  private readonly log: Logging;
  private readonly config: CameraConfig;
  private readonly api: API;

  private readonly tapoCamera: TAPOCamera;

  private deviceInfo: TAPOCameraResponseDeviceInfo['result']['device_info']['basic_info']:

  private uuid: string;
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

    this.setupAccessory();
  }

  private async setupInfoAccessory() {
    const accInfo = this.accessory.getService(
      this.api.hap.Service.AccessoryInformation
    );
    if (!accInfo) return;

    accInfo.setCharacteristic(this.api.hap.Characteristic.Manufacturer, "TAPO");
    accInfo.setCharacteristic(
      this.api.hap.Characteristic.Model,
      this.deviceInfo.device_model
    );
    accInfo.setCharacteristic(
      this.api.hap.Characteristic.SerialNumber,
      this.deviceInfo.mac
    );
    accInfo.setCharacteristic(
      this.api.hap.Characteristic.FirmwareRevision,
      this.deviceInfo.sw_version
    );
  }

  private setupAlarmAccessory() {
    const switchService = new this.api.hap.Service.Switch(
      `Alarm: ${this.accessory.displayName}`,
      "Alarm"
    );
    switchService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        const status = await this.tapoCamera.getStatus();
        return !status.alert;
      })
      .onSet((status) => {
        this.log.debug("onSet", status);
        this.tapoCamera.setAlarmConfig(Boolean(status));
      });
    this.accessory.addService(switchService);
  }

  private setupPrivacyModeAccessory() {
    const switchService = new this.api.hap.Service.Switch(
      `Privacy: ${this.accessory.displayName}`,
      "Privacy"
    );
    switchService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        const status = await this.tapoCamera.getStatus();
        // Privacy switch works in reverse
        return !status.lensMask;
      })
      .onSet((status) => {
        this.log.debug("onSet Privacy", status);
        // Privacy switch works in reverse
        this.tapoCamera.setLensMaskConfig(!Boolean(status));
      });
    this.accessory.addService(switchService);
  }

  private setupCameraStreaming() {
    const streamUrl = this.tapoCamera.getStreamUrl();
    const delegate = new StreamingDelegate(
      new Logger(this.log),
      {
        name: this.config.name,
        manufacturer: "TAPO",
        model: this.deviceInfo.device_model,
        serialNumber: this.deviceInfo.mac,
        firmwareRevision: this.deviceInfo.sw_version,
        unbridge: true,
        videoConfig: {
          source: `-i ${streamUrl}`,
          audio: true,
          debug: this.config.videoDebug,
        },
      },
      this.api,
      this.api.hap
    );
    this.accessory.configureController(delegate.controller);
  }

  private async setupAccessory() {
    this.log.info("Setup camera ->", this.accessory.displayName);

    this.deviceInfo = await this.tapoCamera.getInfo();

    this.setupInfoAccessory();
    this.setupPrivacyModeAccessory();
    this.setupAlarmAccessory();

    this.setupCameraStreaming();

    this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info("Identify requested.", this.accessory.displayName);
    });
    this.api.publishExternalAccessories(pkg.pluginName, [this.accessory]);
  }
}
