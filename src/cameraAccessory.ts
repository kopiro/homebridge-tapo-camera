import {
  API,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  Service,
} from "homebridge";
import { Status, TAPOCamera } from "./tapoCamera";
import { PLUGIN_ID } from "./pkg";
import { CameraPlatform } from "./cameraPlatform";
import type { VideoConfig } from "@homebridge-plugins/homebridge-camera-ffmpeg/dist/settings.js" with {
  "resolution-mode": "import",
};
import { TAPOBasicInfo } from "./types/tapo";

export type CameraConfig = {
  name: string;
  ipAddress: string;
  username: string;
  password: string;
  streamUser?: string;
  streamPassword?: string;

  pullInterval?: number;
  disableStreaming?: boolean;
  disableEyesToggleAccessory?: boolean;
  disableAlarmToggleAccessory?: boolean;
  disableNotificationsToggleAccessory?: boolean;
  disableMotionDetectionToggleAccessory?: boolean;
  disableLEDToggleAccessory?: boolean;
  enableFloodLightAccessory?: boolean;

  disableMotionSensorAccessory?: boolean;
  enableHKSV?: boolean;
  enableHKSVPrebuffer?: boolean;
  lowQuality?: boolean;

  videoMaxWidth?: number;
  videoMaxHeight?: number;
  videoMaxFPS?: number;
  videoForceMax?: boolean;
  videoMaxBitrate?: number;
  /** @deprecated misspelling of videoMaxBitrate, kept for configs that used it */
  videoMaxBirate?: number;
  videoPacketSize?: number;
  videoCodec?: string;

  videoConfig?: VideoConfig;

  eyesToggleAccessoryName?: string;
  alarmToggleAccessoryName?: string;
  notificationsToggleAccessoryName?: string;
  motionDetectionToggleAccessoryName?: string;
  ledToggleAccessoryName?: string;
  floodLightAccessoryName?: string;
};

export class CameraAccessory {
  private readonly log: Logging;
  private readonly api: API;

  private readonly camera: TAPOCamera;

  private pullIntervalTick: NodeJS.Timeout | undefined;

  private readonly accessory: PlatformAccessory;

  private infoAccessory: Service | undefined;
  private toggleAccessories: Partial<Record<keyof Status, Service>> = {};
  private cachedStatus: Partial<Status> = {};
  private isOffline = false;

  private motionSensorService: Service | undefined;

  private readonly randomSeed = Math.random();

  constructor(
    private readonly platform: CameraPlatform,
    private readonly config: CameraConfig
  ) {
    // @ts-expect-error - private property
    this.log = {
      ...this.platform.log,
      prefix: this.platform.log.prefix + `/${this.config.name}`,
    };

    this.api = this.platform.api;
    this.accessory = new this.api.platformAccessory(
      this.config.name,
      this.api.hap.uuid.generate(this.config.name),
      this.api.hap.Categories.CAMERA
    );
    this.camera = new TAPOCamera(this.log, this.config);
  }

  private hasStreamCredentials() {
    return Boolean(this.config.streamUser && this.config.streamPassword);
  }

  private isMotionSensorEnabled() {
    return (
      !this.config.disableMotionSensorAccessory && this.hasStreamCredentials()
    );
  }

  private isHKSVEnabled() {
    return Boolean(
      this.config.enableHKSV &&
        !this.config.disableStreaming &&
        this.isMotionSensorEnabled()
    );
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

  private setupToggleAccessory(
    name: string,
    tapoServiceStr: keyof Status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serviceType: any = this.api.hap.Service.Switch
  ) {
    try {
      const toggleService = this.accessory.addService(
        serviceType,
        name,
        tapoServiceStr
      );
      this.toggleAccessories[tapoServiceStr] = toggleService;

      toggleService.addOptionalCharacteristic(
        this.api.hap.Characteristic.ConfiguredName
      );
      toggleService.setCharacteristic(
        this.api.hap.Characteristic.ConfiguredName,
        name
      );

      toggleService
        .getCharacteristic(this.api.hap.Characteristic.On)
        .onGet(async () => {
          try {
            this.log.debug(`Getting "${tapoServiceStr}" status...`);

            const cachedValue = this.cachedStatus[tapoServiceStr];
            if (cachedValue !== undefined) {
              return cachedValue;
            }

            const currentValue = toggleService.getCharacteristic(
              this.api.hap.Characteristic.On
            ).value;

            void this.getStatusAndNotify();

            if (typeof currentValue === "boolean") {
              this.log.debug(
                `No cached status for "${tapoServiceStr}", returning Homebridge cached value`
              );
              return currentValue;
            }

            this.log.debug(
              `No cached status for "${tapoServiceStr}", returning fallback value`
            );
            return false;
          } catch (err) {
            this.log.error("Error getting status:", err);
            return false;
          }
        })
        .onSet(async (newValue) => {
          try {
            const value = Boolean(newValue);
            this.log.debug(
              `Setting "${tapoServiceStr}" to ${value ? "on" : "off"}...`
            );
            await this.camera.setStatus(tapoServiceStr, value);
            this.cachedStatus[tapoServiceStr] = value;
            toggleService
              .getCharacteristic(this.api.hap.Characteristic.On)
              .updateValue(value);
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

    const vcodec = this.config.videoCodec ?? "copy";
    const config: VideoConfig = {
      audio: true, // Set audio as true as most of TAPO cameras have audio
      vcodec: vcodec,
      // libx264: force Baseline profile and 1s keyframe interval for HomeKit compatibility.
      ...(vcodec === "libx264" && {
        encoderOptions: "-preset ultrafast -tune zerolatency -profile:v baseline -level:v 3.1 -g 30",
      }),
      maxWidth: this.config.videoMaxWidth,
      maxHeight: this.config.videoMaxHeight,
      maxFPS: this.config.videoMaxFPS,
      maxBitrate: this.config.videoMaxBitrate ?? this.config.videoMaxBirate,
      packetSize: this.config.videoPacketSize,
      forceMax: this.config.videoForceMax,
      // async resampling prevents backward audio DTS from pcm_alaw packet jitter.
      mapaudio: "0:a:0 -af aresample=async=16000",
      ...(this.config.videoConfig || {}),
      // HKSV is intentionally controlled by the dedicated top-level option. A
      // raw videoConfig override could otherwise enable continuous recording
      // without the ONVIF motion service that HomeKit needs to trigger clips.
      recording: this.isHKSVEnabled(),
      prebuffer: Boolean(
        this.isHKSVEnabled() && this.config.enableHKSVPrebuffer
      ),
      // We add this at the end as the user must not be able to override it
      source: `-rtsp_transport tcp -i ${streamUrl}`,
    };

    this.log.debug("Video config", config);

    return config;
  }

  private async setupCameraStreaming(basicInfo: TAPOBasicInfo) {
    try {
      if (!this.hasStreamCredentials()) {
        this.log.error(
          "Camera streaming requires streamUser and streamPassword. Set disableStreaming to true for controls-only setups."
        );
        return;
      }

      if (this.config.enableHKSV && !this.isHKSVEnabled()) {
        this.log.error(
          "HomeKit Secure Video requires the ONVIF motion sensor and streamUser/streamPassword. HKSV recording will remain disabled."
        );
      }

      // camera-ffmpeg v4 is ESM while Homebridge still loads this plugin through
      // its CommonJS entry point. Native dynamic imports preserve that boundary
      // without converting every existing consumer-facing module in one release.
      const [{ StreamingDelegate }, { Logger }] = await Promise.all([
        import(
          "@homebridge-plugins/homebridge-camera-ffmpeg/dist/streamingDelegate.js"
        ),
        import("@homebridge-plugins/homebridge-camera-ffmpeg/dist/logger.js"),
      ]);

      const delegate = new StreamingDelegate(
        new Logger(this.log),
        {
          name: this.config.name,
          manufacturer: "TAPO",
          model: basicInfo.device_info,
          serialNumber: basicInfo.mac,
          firmwareRevision: basicInfo.sw_version,
          videoConfig: this.getVideoConfig(),
        },
        this.api,
        this.api.hap,
        this.accessory
      );

      this.accessory.configureController(delegate.controller);

      if (this.isHKSVEnabled() && this.motionSensorService) {
        const recordingManagement = delegate.controller.recordingManagement;

        // The generic camera delegate advertises motion-triggered recording but
        // cannot know which service carries this camera's ONVIF events. Linking
        // the exact service makes HomeKit use those events for HKSV clips and
        // mirrors the camera-active state back to the same sensor.
        recordingManagement?.recordingManagementService.addLinkedService(
          this.motionSensorService
        );
        if (
          recordingManagement &&
          !recordingManagement.sensorServices.includes(this.motionSensorService)
        ) {
          recordingManagement.sensorServices.push(this.motionSensorService);
        }
        this.motionSensorService.setCharacteristic(
          this.api.hap.Characteristic.StatusActive,
          true
        );
      }

      // Prebuffering must begin before the first motion event; starting it only
      // when HomeKit requests a clip would lose the seconds the option promises.
      if (this.isHKSVEnabled() && this.config.enableHKSVPrebuffer) {
        await delegate.recordingDelegate?.startPreBuffer();
      }

      this.log.debug("Camera streaming setup done");
    } catch (err) {
      this.log.error("Error setting up camera streaming:", err);
    }
  }

  private async setupMotionSensorAccessory() {
    try {
      if (!this.hasStreamCredentials()) {
        this.log.warn(
          "Motion sensor requires streamUser and streamPassword. Skipping motion sensor setup."
        );
        return;
      }

      // Reuse any restored sensor instead of publishing a second service. HKSV
      // later links this exact instance so ONVIF events and recordings cannot
      // drift onto separate motion characteristics after a restart.
      this.motionSensorService =
        this.accessory.getService(this.platform.api.hap.Service.MotionSensor) ||
        this.accessory.addService(
          this.platform.api.hap.Service.MotionSensor,
          "Motion Sensor",
          "motion"
        );

      this.motionSensorService.addOptionalCharacteristic(
        this.api.hap.Characteristic.ConfiguredName
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
      this.log.debug("Polling status...");
      this.getStatusAndNotify();
    }, this.config.pullInterval || this.platform.kDefaultPullInterval);
  }

  private async getStatusAndNotify() {
    try {
      const cameraStatus = await this.camera.getStatus();
      
      if (
        this.isOffline ||
        (this.isMotionSensorEnabled() && !this.camera.onvifConnected)
      ) {
        let onvifSuccess = true;
        if (this.isMotionSensorEnabled()) {
          this.log.info(
            "Camera is back online, restarting ONVIF connection..."
          );
          onvifSuccess = await this.camera.restartOnvifConnection();
        }

        if (onvifSuccess) {
          this.isOffline = false;
        } else {
          this.isOffline = true;
          this.log.error(
            "Failed to restart ONVIF connection, will retry next poll."
          );
        }
      }

      this.cachedStatus = {
        ...this.cachedStatus,
        ...cameraStatus,
      };
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
      this.isOffline = true;
    }
  }

  async setup() {
    const basicInfo = await this.camera.getBasicInfo();
    this.log.debug("Basic info", basicInfo);

    this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info("Identify requested", basicInfo);
    });

    this.setupInfoAccessory(basicInfo);

    if (!this.config.disableMotionSensorAccessory) {
      // The ONVIF service must exist before the HKSV controller is configured so
      // the recording management can link the exact service receiving events.
      await this.setupMotionSensorAccessory();
    }

    if (this.config.enableHKSV && this.config.disableStreaming) {
      this.log.error(
        "HomeKit Secure Video cannot be enabled when disableStreaming is true. HKSV recording will remain disabled."
      );
    }

    if (!this.config.disableStreaming) {
      await this.setupCameraStreaming(basicInfo);
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

    if (this.config.enableFloodLightAccessory) {
      this.setupToggleAccessory(
        this.config.floodLightAccessoryName || "Floodlight",
        "floodLight",
        this.api.hap.Service.Lightbulb
      );
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
