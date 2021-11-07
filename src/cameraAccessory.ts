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

  private infoAccessory: Service | undefined;
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
      this.uuid,
      this.api.hap.Categories.CAMERA
    );

    this.tapoCamera = new TAPOCamera(this.log, this.config);

    this.setup();
  }

  private async setupInfoAccessory(
    deviceInfo: TAPOCameraResponseDeviceInfo["result"]["device_info"]["basic_info"]
  ) {
    this.infoAccessory = this.accessory.getService(
      this.api.hap.Service.AccessoryInformation
    )!;

    this.infoAccessory
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, "TAPO")
      .setCharacteristic(
        this.api.hap.Characteristic.Model,
        deviceInfo.device_model
      )
      .setCharacteristic(
        this.api.hap.Characteristic.SerialNumber,
        deviceInfo.mac
      )
      .setCharacteristic(
        this.api.hap.Characteristic.FirmwareRevision,
        deviceInfo.sw_version
      );
  }

  private setupAlarmAccessory() {
    const name = `${this.config.name} - Alarm`;
    this.alertService = this.accessory.addService(
      this.api.hap.Service.Switch,
      name,
      "alarm"
    );
    this.alertService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        this.resetPollingTimer();
        const status = await this.tapoCamera.getStatus();
        return status.alert;
      })
      .onSet((status) => {
        this.log.debug(`Setting alarm to ${status ? "on" : "off"}`);
        this.tapoCamera.setAlertConfig(Boolean(status));
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
        this.resetPollingTimer();
        const status = await this.tapoCamera.getStatus();
        return !status.lensMask;
      })
      .onSet((status) => {
        this.log.debug(`Setting privacy to ${status ? "on" : "off"}`);
        this.tapoCamera.setLensMaskConfig(!Boolean(status));
      });
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
      unbridge: true,
      videoConfig: {
        source: `-rtsp_transport tcp -re -i ${streamUrl}`,
        stillImageSource: `-i ${streamUrl}`,
        audio: true,
        debug: this.config.videoDebug,
        vcodec: "copy", // The RSTP stream is H264, so we need to use copy to pass it through
        videoFilter: "none", // We don't want to filter the video, since we're using copy,
        maxWidth: 640,
        maxHeight: 480,
        maxFPS: 15,
        maxBitrate: 384,
        forceMax: true,
      },
    };
    const delegate = new StreamingDelegate(
      new Logger(this.log),
      streamingConfig,
      this.api,
      this.api.hap
    );
    this.accessory.configureController(delegate.controller);
  }

  public async resetPollingTimer() {
    if (this.pullIntervalTick) {
      clearInterval(this.pullIntervalTick);
    }

    this.pullIntervalTick = setInterval(async () => {
      this.log.debug("Time to refresh characteristics");

      const status = await this.tapoCamera.getStatus();
      this.alertService
        ?.getCharacteristic(this.api.hap.Characteristic.On)
        .updateValue(status.alert);
      this.privacyService
        ?.getCharacteristic(this.api.hap.Characteristic.On)
        .updateValue(!status.lensMask);
    }, this.config.pullInterval || this.kDefaultPullInterval);
  }

  private async setup() {
    this.log.info(`Setup camera ${this.config.name}`);

    const deviceInfo = await this.tapoCamera.getInfo();

    this.setupInfoAccessory(deviceInfo);
    this.setupCameraStreaming(deviceInfo);

    this.setupPrivacyModeAccessory();
    this.setupAlarmAccessory();

    this.api.publishExternalAccessories(pkg.pluginName, [this.accessory]);

    this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info(`Identify requested for ${this.config.name}`);
    });
  }
}
