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
  private alertService: Service | undefined;
  private privacyService: Service | undefined;

  public uuid: string;
  public accessory: PlatformAccessory;

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

  private setupAlarmAccessory() {
    this.alertService = new this.api.hap.Service.Switch(
      `${this.accessory.displayName} (Alert)`,
      "Alarm"
    );
    this.alertService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        this.resetPollingTimer();
        const status = await this.tapoCamera.getStatus();
        return status.alert;
      })
      .onSet((status) => {
        this.log.debug("onSet", status);
        this.tapoCamera.setAlertConfig(Boolean(status));
      });
    this.accessory.addService(this.alertService);
  }

  private setupPrivacyModeAccessory() {
    this.privacyService = new this.api.hap.Service.Switch(
      `${this.accessory.displayName} (Privacy mode)`,
      "Privacy"
    );
    this.privacyService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        this.resetPollingTimer();
        const status = await this.tapoCamera.getStatus();
        return status.lensMask;
      })
      .onSet((status) => {
        this.log.debug("onSet Privacy", status);
        this.tapoCamera.setLensMaskConfig(Boolean(status));
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

  public async resetPollingTimer() {
    if (this.pullIntervalTick) {
      clearInterval(this.pullIntervalTick);
    }

    this.pullIntervalTick = setInterval(async () => {
      this.log.debug("Pull Interval ticked!");

      const status = await this.tapoCamera.getStatus();
      this.alertService
        ?.getCharacteristic(this.api.hap.Characteristic.On)
        .updateValue(status.alert);
      this.privacyService
        ?.getCharacteristic(this.api.hap.Characteristic.On)
        .updateValue(status.lensMask);
    }, this.config.pullInterval || this.kDefaultPullInterval);
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
  }
}
