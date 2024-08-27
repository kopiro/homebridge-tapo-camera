import {
  API,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  Service,
} from "homebridge";
import { StreamingDelegate } from "homebridge-camera-ffmpeg/dist/streamingDelegate";
import { Logger } from "homebridge-camera-ffmpeg/dist/logger";
import { Status, TAPOCamera } from "./tapoCamera";
import { PLUGIN_ID } from "./pkg";
import { DeviceInformation } from "./types/onvif";
import { CameraPlatform } from "./cameraPlatform";
import { VideoConfig } from "homebridge-camera-ffmpeg/dist/configTypes";
import { TAPOBasicInfo } from "./types/tapo";

export type CameraConfig = {
  name: string;
  ipAddress: string;
  username: string;
  password: string;
  streamUser: string;
  streamPassword: string;

  pullInterval?: number;
  disableStreaming?: boolean;
  disableEyesToggleAccessory?: boolean;
  disableAlarmToggleAccessory?: boolean;
  disableNotificationsToggleAccessory?: boolean;
  disableMotionDetectionToggleAccessory?: boolean;
  disableLEDToggleAccessory?: boolean;

  disableMotionSensorAccessory?: boolean;
  lowQuality?: boolean;

  videoConfig?: VideoConfig;

  eyesToggleAccessoryName?: string;
  alarmToggleAccessoryName?: string;
  notificationsToggleAccessoryName?: string;
  motionDetectionToggleAccessoryName?: string;
  ledToggleAccessoryName?: string;
};

export class CameraAccessory {
  private readonly log: Logging;
  private readonly api: API;

  private readonly camera: TAPOCamera;

  private pullIntervalTick: NodeJS.Timeout | undefined;

  private readonly accessory: PlatformAccessory;

  private infoAccessory: Service | undefined;
  private toggleAccessories: Partial<Record<keyof Status, Service>> = {};

  private motionSensorService: Service | undefined;

  private readonly randomSeed = Math.random();

  constructor(
    private readonly platform: CameraPlatform,
    private readonly config: CameraConfig
  ) {
    this.log = this.platform.log;
    this.log.prefix = this.config.name;

    this.api = this.platform.api;
    this.accessory = new this.api.platformAccessory(
      this.config.name,
      this.api.hap.uuid.generate(this.config.name),
      this.api.hap.Categories.CAMERA
    );
    this.camera = new TAPOCamera(this.log, this.config);
  }

  private setupInfoAccessory(basicInfo: TAPOBasicInfo) {
    this.infoAccessory =
      this.accessory.getService(this.api.hap.Service.AccessoryInformation) ||
      this.accessory.addService(this.api.hap.Service.AccessoryInformation);
    this.infoAccessory
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, "TAPO")
      .setCharacteristic(
        this.api.hap.Characteristic.Model,
        basicInfo.device_info
      )
      .setCharacteristic(
        this.api.hap.Characteristic.SerialNumber,
        basicInfo.mac
      )
      .setCharacteristic(
        this.api.hap.Characteristic.FirmwareRevision,
        basicInfo.sw_version
      );
  }

  private setupToggleAccessory(name: string, tapoServiceStr: keyof Status) {
    try {
      const toggleService = this.accessory.addService(
        this.api.hap.Service.Switch,
        name,
        tapoServiceStr
      );
      this.toggleAccessories[tapoServiceStr] = toggleService;

      // Add name
      toggleService.setCharacteristic(this.api.hap.Characteristic.Name, name);
      toggleService.setCharacteristic(
        this.api.hap.Characteristic.ConfiguredName,
        name
      );

      toggleService
        .getCharacteristic(this.api.hap.Characteristic.On)
        .onGet(async () => {
          try {
            this.log.debug(`Getting "${tapoServiceStr}" status...`);

            const cameraStatus = await this.camera.getStatus();
            const value = cameraStatus[tapoServiceStr];
            if (value !== undefined) {
              return value;
            }

            this.log.debug(
              `Status "${tapoServiceStr}" not found in status`,
              cameraStatus
            );
            return null;
          } catch (err) {
            this.log.error("Error getting status:", err);
            return null;
          }
        })
        .onSet(async (newValue) => {
          try {
            this.log.debug(
              `Setting "${tapoServiceStr}" to ${newValue ? "on" : "off"}...`
            );
            this.camera.setStatus(tapoServiceStr, Boolean(newValue));
          } catch (err) {
            this.log.error("Error setting status:", err);
            throw new this.api.hap.HapStatusError(
              this.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST
            );
          }
        });
    } catch (err) {
      this.log.error(
        "Error setting up toggle accessory",
        name,
        tapoServiceStr,
        err
      );
    }
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

  private async setupCameraStreaming(basicInfo: TAPOBasicInfo) {
    try {
      const delegate = new StreamingDelegate(
        new Logger(this.log),
        {
          name: this.config.name,
          manufacturer: "TAPO",
          model: basicInfo.device_info,
          serialNumber: basicInfo.mac,
          firmwareRevision: basicInfo.sw_version,
          unbridge: true,
          videoConfig: this.getVideoConfig(),
        },
        this.api,
        this.api.hap
      );

      this.accessory.configureController(delegate.controller);
    } catch (err) {
      this.log.error("Error setting up camera streaming:", err);
    }
  }

  private async setupMotionSensorAccessory() {
    try {
      this.motionSensorService = this.accessory.addService(
        this.platform.api.hap.Service.MotionSensor,
        "Motion Sensor",
        "motion"
      );

      this.motionSensorService.setCharacteristic(
        this.api.hap.Characteristic.Name,
        "Motion Sensor"
      );
      this.motionSensorService.setCharacteristic(
        this.api.hap.Characteristic.ConfiguredName,
        "Motion Sensor"
      );

      const eventEmitter = await this.camera.getEventEmitter();
      eventEmitter.addListener("motion", (motionDetected) => {
        this.log.debug("Motion detected", motionDetected);

        this.motionSensorService?.updateCharacteristic(
          this.api.hap.Characteristic.MotionDetected,
          motionDetected
        );
      });
    } catch (err) {
      this.log.error("Error setting up motion sensor accessory:", err);
    }
  }

  private setupPolling() {
    if (this.pullIntervalTick) {
      clearInterval(this.pullIntervalTick);
    }

    this.pullIntervalTick = setInterval(() => {
      this.getStatusAndNotify();
    }, this.config.pullInterval || this.platform.kDefaultPullInterval);
  }

  private async getStatusAndNotify() {
    try {
      const cameraStatus = await this.camera.getStatus();
      this.log.debug("Notifying new values...", cameraStatus);

      for (const [key, value] of Object.entries(cameraStatus)) {
        const toggleService = this.toggleAccessories[key as keyof Status];
        if (toggleService && value !== undefined) {
          toggleService
            .getCharacteristic(this.api.hap.Characteristic.On)
            .updateValue(value);
        }
      }
    } catch (err) {
      this.log.error("Error getting status:", err);
    }
  }

  async setup() {
    const basicInfo = await this.camera.getBasicInfo();
    this.log.debug("Basic info", basicInfo);

    this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info("Identify requested", basicInfo);
    });

    this.setupInfoAccessory(basicInfo);

    if (!this.config.disableStreaming) {
      this.setupCameraStreaming(basicInfo);
    }

    if (!this.config.disableEyesToggleAccessory) {
      this.setupToggleAccessory(
        this.config.eyesToggleAccessoryName || "Eyes",
        "eyes"
      );
    }

    if (!this.config.disableAlarmToggleAccessory) {
      this.setupToggleAccessory(
        this.config.alarmToggleAccessoryName || "Alarm",
        "alarm"
      );
    }

    if (!this.config.disableNotificationsToggleAccessory) {
      this.setupToggleAccessory(
        this.config.notificationsToggleAccessoryName || "Notifications",
        "notifications"
      );
    }

    if (!this.config.disableMotionDetectionToggleAccessory) {
      this.setupToggleAccessory(
        this.config.motionDetectionToggleAccessoryName || "Motion Detection",
        "motionDetection"
      );
    }

    if (!this.config.disableLEDToggleAccessory) {
      this.setupToggleAccessory(
        this.config.ledToggleAccessoryName || "LED",
        "led"
      );
    }

    if (!this.config.disableMotionSensorAccessory) {
      this.setupMotionSensorAccessory();
    }

    // // Publish as external accessory
    this.log.debug("Publishing accessory...");
    this.api.publishExternalAccessories(PLUGIN_ID, [this.accessory]);

    // Setup the polling by giving a random delay
    // to avoid all the cameras starting at the same time
    this.log.debug("Setting up polling...");
    setTimeout(() => {
      this.setupPolling();
    }, this.randomSeed * 3_000);

    this.log.debug("Notifying initial values...");
    await this.getStatusAndNotify();
  }
}
