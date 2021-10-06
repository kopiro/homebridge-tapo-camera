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
  model: string;
  serialNumber: string;
  firmwareRevision: string;
  streamUser: string;
  streamPassword: string;
  videoDebug: boolean;
};

export class CameraAccessory {
  private readonly log: Logging;
  private readonly config: CameraConfig;
  private readonly api: API;
  private readonly tapoCamera: TAPOCamera;

  private uuid: string;
  private accessory: PlatformAccessory;

  constructor(log: Logging, config: CameraConfig, api: API) {
    this.log = log;
    this.config = config as unknown as CameraConfig;
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

    const deviceInfo = await this.tapoCamera.getInfo();

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

  private setupAlarmAccessory() {
    const switchService = new this.api.hap.Service.Switch(
      `Alarm: ${this.accessory.displayName}`,
      "Alarm"
    );
    switchService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        const response = await this.tapoCamera.getStatus();
        const r = response.find((r) => r.method === "getAlertConfig");
        // @ts-ignore
        return r?.result.msg_alarm.chn1_msg_alarm_info.enabled === "on";
      })
      .onSet((status) => {
        this.log.debug("onSet", status);
        this.tapoCamera.setAlarmConfig(!Boolean(status));
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
        const response = await this.tapoCamera.getStatus();
        const r = response.find((r) => r.method === "getLensMaskConfig");
        // @ts-ignore
        return r?.result.lens_mask.lens_mask_info.enabled === "off";
      })
      .onSet((status) => {
        this.log.debug("onSet Privacy", status);
        this.tapoCamera.setLensMaskConfig(!Boolean(status));
      });
    this.accessory.addService(switchService);
  }

  private setupCameraStreaming() {
    const delegate = new StreamingDelegate(
      new Logger(this.log),
      {
        name: this.config.name,
        manufacturer: "TAPO",
        model: this.config.model,
        serialNumber: this.config.serialNumber,
        firmwareRevision: this.config.firmwareRevision,
        unbridge: false,
        videoConfig: {
          source: `-i rtsp://${this.config.streamUser}:${this.config.streamPassword}@${this.config.ipAddress}:554/stream1`,
          audio: true,
          debug: this.config.videoDebug,
        },
      },
      this.api,
      this.api.hap
    );
    this.accessory.configureController(delegate.controller);
  }

  private setupAccessory(): void {
    this.log.info("Setup camera ->", this.accessory.displayName);

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
