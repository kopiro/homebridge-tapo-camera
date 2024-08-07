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

  private setupInfoAccessory(deviceInfo: DeviceInformation) {
    this.infoAccessory = this.accessory.getService(
      this.api.hap.Service.AccessoryInformation
    );
    if (!this.infoAccessory) {
      this.infoAccessory = new this.api.hap.Service.AccessoryInformation();
      this.accessory.addService(this.infoAccessory);
    }
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

  private setupToggleAccessory(name: string, tapoServiceStr: keyof Status) {
    const toggleService = new this.api.hap.Service.Switch(name, tapoServiceStr);

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
          if (value !== undefined) return value;

          return null;
        } catch (err) {
          this.log.error("Error getting status:", err);
          return null;
        }
      })
      .onSet(async (newValue) => {
        try {
          this.log.info(
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

    this.accessory.addService(toggleService);
    this.toggleAccessories[tapoServiceStr] = toggleService;
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

  private async setupMotionSensorAccessory() {
    this.motionSensorService = new this.api.hap.Service.MotionSensor(
      "Motion Sensor",
      "motion"
    );

    const eventEmitter = await this.camera.getEventEmitter();
    eventEmitter.addListener("motion", (motionDetected) => {
      this.log.debug("Motion detected", motionDetected);

      this.motionSensorService?.updateCharacteristic(
        this.api.hap.Characteristic.MotionDetected,
        motionDetected
      );
    });

    this.accessory.addService(this.motionSensorService);
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
      this.log.debug("Notifying new values", JSON.stringify(cameraStatus));

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
    const cameraInfo = await this.camera.getDeviceInfo();

    this.setupInfoAccessory(cameraInfo);

    if (!this.config.disableStreaming) {
      this.setupCameraStreaming(cameraInfo);
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

    // Publish as external accessory
    this.api.publishExternalAccessories(PLUGIN_ID, [this.accessory]);
    this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info("Identify requested", cameraInfo);
    });

    setImmediate(() => {
      this.getStatusAndNotify();
    });

    // Setup the polling by giving a 3s random delay
    // to avoid all the cameras starting at the same time
    setTimeout(() => {
      this.setupPolling();
    }, this.randomSeed * 3000);
  }
}
