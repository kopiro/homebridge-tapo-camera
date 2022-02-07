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

  debug?: boolean;
  pullInterval?: number;
  disableStreaming?: boolean;
  disablePrivacyAccessory?: boolean;
  disableAlarmAccessory?: boolean;
  disableMotionAccessory?: boolean;
  lowQuality?: boolean;
};

export class CameraAccessory {
  private readonly log: Logging;
  private readonly config: CameraConfig;
  private readonly api: API;

  private readonly camera: TAPOCamera;

  private readonly kDefaultPullInterval = 60000;

  private pullIntervalTick: NodeJS.Timeout | undefined;

  private infoAccessory: Service | undefined;
  private alertService: Service | undefined;
  private privacyService: Service | undefined;
  private motionService: Service | undefined;

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

    this.camera = new TAPOCamera(this.log, this.config);

    try {
      this.setup();
    } catch (err) {
      this.log.error(
        `[${this.config.name}]`,
        "Error during setup",
        (err as Error)?.message
      );
    }
  }

  private async setupInfoAccessory() {
    const deviceInfo = await this.camera.getDeviceInfo();
    this.log.debug(
      `[${this.config.name}]`,
      "Info accessory",
      JSON.stringify(deviceInfo)
    );

    this.infoAccessory = this.accessory.getService(
      this.api.hap.Service.AccessoryInformation
    )!;

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
    this.alertService = this.accessory.addService(
      this.api.hap.Service.Switch,
      name,
      "alarm"
    );
    this.alertService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(async () => {
        this.resetPollingTimer();
        const status = await this.camera.getStatus();
        return status.alert;
      })
      .onSet((status) => {
        this.log.debug(`Setting alarm to ${status ? "on" : "off"}`);
        this.camera.setAlertConfig(Boolean(status));
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
        const status = await this.camera.getStatus();
        return !status.lensMask;
      })
      .onSet((status) => {
        this.log.debug(`Setting privacy to ${status ? "on" : "off"}`);
        this.camera.setLensMaskConfig(!Boolean(status));
      });
  }

  private getVideoConfig() {
    const streamUrl = this.camera.getAuthenticatedStreamUrl(
      Boolean(this.config.lowQuality)
    );

    return {
      source: `-i ${streamUrl}`,
      audio: true,
      debug: this.config.debug,
      videoFilter: "none",
      vcodec: "copy",
      maxWidth: this.config.lowQuality ? 640 : 1920,
      maxHeight: this.config.lowQuality ? 480 : 1080,
      maxFPS: 15,
      forceMax: true,
    };
  }

  private async setupCameraStreaming() {
    const deviceInfo = await this.camera.getDeviceInfo();

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

  private async resetPollingTimer() {
    if (this.pullIntervalTick) {
      clearInterval(this.pullIntervalTick);
    }

    this.pullIntervalTick = setInterval(async () => {
      this.log.debug(
        `[${this.config.name}]`,
        "Time to refresh characteristics"
      );

      const status = await this.camera.getStatus();
      this.alertService
        ?.getCharacteristic(this.api.hap.Characteristic.On)
        .updateValue(status.alert);
      this.privacyService
        ?.getCharacteristic(this.api.hap.Characteristic.On)
        .updateValue(!status.lensMask);
    }, this.config.pullInterval || this.kDefaultPullInterval);
  }

  private async setup() {
    this.log.info(`[${this.config.name}]`, `Setup camera`);

    this.setupInfoAccessory();

    if (!this.config.disableStreaming) {
      this.setupCameraStreaming();
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

    this.api.publishExternalAccessories(pkg.pluginName, [this.accessory]);

    this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info(`[${this.config.name}]`, "Identify requested");
    });
  }
}
