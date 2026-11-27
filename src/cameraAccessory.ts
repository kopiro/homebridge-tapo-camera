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
import { CameraPlatform } from "./cameraPlatform";
import { VideoConfig } from "homebridge-camera-ffmpeg/dist/configTypes";
import { TAPOBasicInfo } from "./types/tapo";
import { buildAudioFilter, NoiseReductionLevel } from "./audioFilters";
import { PresenceSensor } from "./presenceSensor";
import { DoorbellListener } from "./doorbellListener";
import { DetectionPoller } from "./detectionPoller";
import dns from "dns";
import net from "net";

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
  lowQuality?: boolean;
  rtspTransport?: "udp" | "tcp";

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

  // Sound
  /** Percent. 100 = unchanged, 300 = three times louder. */
  audioVolume?: number;
  audioNoiseReduction?: NoiseReductionLevel;

  // Picture
  /** Re-encode with noise reduction and better encoder settings (uses more CPU). */
  videoEnhance?: boolean;

  // Presence (occupancy) sensors. All are off unless turned on.
  enableMotionPresenceSensor?: boolean;
  motionPresenceSensorName?: string;
  enablePersonSensor?: boolean;
  personSensorName?: string;
  enableDoorbellSensor?: boolean;
  doorbellSensorName?: string;
  enableLightSensor?: boolean;
  lightSensorName?: string;
  /** Seconds a presence sensor stays on after the event ends. */
  presenceHoldTime?: number;
  /** Seconds between event-history checks (backup for person/doorbell). 0 = off. */
  eventPollInterval?: number;
  /** Seconds between checks of the camera's own light. */
  lightSensorPollInterval?: number;
};

// Previous libx264 settings, kept for anyone who already chose libx264.
const BASELINE_X264_OPTIONS =
  "-preset ultrafast -tune zerolatency -profile:v baseline -level:v 3.1 -g 30";
// Used with videoEnhance: High profile looks much better at the same bitrate.
// zerolatency and -bf 0 keep B-frames off, which HomeKit needs.
const ENHANCED_X264_OPTIONS =
  "-preset veryfast -tune zerolatency -profile:v high -level:v 4.0 -g 30 -bf 0";
// Mild spatial + temporal noise reduction (removes grain, mostly at night).
const ENHANCED_VIDEO_FILTER = "hqdn3d=2:1.5:4:3";

function seconds(value: unknown, fallback: number, max = 3600): number {
  const n = Number(value);
  if (value === undefined || value === null || !Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.min(max, n);
}

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

  private motionPresenceSensor: PresenceSensor | undefined;
  private personSensor: PresenceSensor | undefined;
  private doorbellSensor: PresenceSensor | undefined;
  private lightSensor: PresenceSensor | undefined;
  private onvifPersonActive = false;
  private lastDoorbellPressAt = 0;
  private detectionPoller: DetectionPoller | undefined;
  private lightPollTick: NodeJS.Timeout | undefined;
  private lightCheckTimeout: NodeJS.Timeout | undefined;
  private lightUnsupportedWarned = false;
  private unsubscribeDoorbell: (() => void) | undefined;

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

  /** ONVIF events are needed by the motion sensor and the new presence sensors. */
  private needsOnvif() {
    return (
      this.isMotionSensorEnabled() ||
      (this.hasStreamCredentials() &&
        Boolean(
          this.config.enableMotionPresenceSensor ||
            this.config.enablePersonSensor
        ))
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
            if (tapoServiceStr === "floodLight") {
              this.lightSensor?.set(value);
            }
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

    const enhance = Boolean(this.config.videoEnhance);
    // videoEnhance needs to re-encode, so "copy" (the default) becomes libx264.
    // A hardware codec the user picked is kept.
    const vcodec =
      enhance && (!this.config.videoCodec || this.config.videoCodec === "copy")
        ? "libx264"
        : this.config.videoCodec ?? "copy";
    const config: VideoConfig = {
      audio: true, // Set audio as true as most of TAPO cameras have audio
      vcodec: vcodec,
      // libx264: force Baseline profile and 1s keyframe interval for HomeKit compatibility.
      ...(vcodec === "libx264" && {
        encoderOptions: enhance ? ENHANCED_X264_OPTIONS : BASELINE_X264_OPTIONS,
      }),
      ...(enhance && { videoFilter: ENHANCED_VIDEO_FILTER }),
      maxWidth: this.config.videoMaxWidth,
      maxHeight: this.config.videoMaxHeight,
      maxFPS: this.config.videoMaxFPS,
      maxBitrate: this.config.videoMaxBitrate ?? this.config.videoMaxBirate,
      packetSize: this.config.videoPacketSize,
      forceMax: this.config.videoForceMax,
      // async resampling prevents backward audio DTS from pcm_alaw packet jitter.
      // Volume boost and noise reduction are added after it when turned on.
      mapaudio: `0:a:0 -af ${buildAudioFilter(
        this.config.audioVolume,
        this.config.audioNoiseReduction
      )}`,
      ...(this.config.videoConfig || {}),
      // We add this at the end as the user must not be able to override it
      source: `-rtsp_transport ${this.config.rtspTransport ?? "udp"} -i ${streamUrl}`,
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

      this.motionSensorService = this.accessory.addService(
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

  /**
   * Adds the optional presence (occupancy) sensors. Services are added here,
   * before the accessory is published; the event sources start afterwards in
   * startPresenceSources(). Existing services and their IDs are not touched.
   */
  private setupPresenceSensors() {
    const hold = seconds(this.config.presenceHoldTime, 30);

    try {
      if (this.config.enableMotionPresenceSensor) {
        if (!this.hasStreamCredentials()) {
          this.log.warn(
            "Motion presence sensor needs streamUser and streamPassword (ONVIF). Skipping it."
          );
        } else {
          this.motionPresenceSensor = new PresenceSensor(
            this.api,
            this.accessory,
            this.config.motionPresenceSensorName || "Motion Presence",
            "presence-motion",
            hold
          );
        }
      }

      if (this.config.enablePersonSensor) {
        this.personSensor = new PresenceSensor(
          this.api,
          this.accessory,
          this.config.personSensorName || "Person",
          "presence-person",
          hold
        );
      }

      if (this.config.enableDoorbellSensor) {
        this.doorbellSensor = new PresenceSensor(
          this.api,
          this.accessory,
          this.config.doorbellSensorName || "Doorbell Pressed",
          "presence-doorbell",
          hold
        );
      }

      if (this.config.enableLightSensor) {
        // No hold time: this follows the light exactly.
        this.lightSensor = new PresenceSensor(
          this.api,
          this.accessory,
          this.config.lightSensorName || "Light On",
          "presence-light",
          0
        );
      }
    } catch (err) {
      this.log.error("Error setting up presence sensors:", err);
    }
  }

  private startPresenceSources() {
    if (this.needsOnvif() && (this.motionPresenceSensor || this.personSensor || this.lightSensor)) {
      void this.connectOnvifPresence();
    }

    if (this.doorbellSensor) {
      void this.listenForDoorbell();
    }

    const pollSeconds = seconds(this.config.eventPollInterval, 5, 300);
    if ((this.personSensor || this.doorbellSensor) && pollSeconds > 0) {
      this.detectionPoller = new DetectionPoller(
        this.camera,
        this.log,
        pollSeconds,
        (kind) => {
          if (kind === "person" && this.personSensor) {
            // ONVIF already reports this person live; don't cut it short.
            if (!this.onvifPersonActive) {
              this.personSensor.pulse();
            }
          } else if (kind === "doorbell" && this.doorbellSensor) {
            // Already caught by the instant UDP signal.
            if (Date.now() - this.lastDoorbellPressAt > 60_000) {
              this.onDoorbellPress("event history");
            }
          }
        }
      );
      setTimeout(() => this.detectionPoller?.start(), this.randomSeed * 3_000);
    }

    if (this.lightSensor) {
      const lightSeconds = Math.max(2, seconds(this.config.lightSensorPollInterval, 10, 600));
      this.lightPollTick = setInterval(
        () => void this.checkLight(),
        lightSeconds * 1000
      );
      void this.checkLight();
    }

    this.api.on("shutdown", () => this.stopPresenceSources());
  }

  private stopPresenceSources() {
    this.detectionPoller?.stop();
    if (this.lightPollTick) clearInterval(this.lightPollTick);
    if (this.lightCheckTimeout) clearTimeout(this.lightCheckTimeout);
    this.unsubscribeDoorbell?.();
  }

  private async connectOnvifPresence() {
    try {
      const eventEmitter = await this.camera.getEventEmitter();

      eventEmitter.addListener("motion", (motionDetected) => {
        this.motionPresenceSensor?.set(Boolean(motionDetected));
        // At night the camera's light usually comes on with motion, so check
        // it straight away instead of waiting for the next poll.
        if (motionDetected && this.lightSensor) {
          if (this.lightCheckTimeout) clearTimeout(this.lightCheckTimeout);
          this.lightCheckTimeout = setTimeout(() => void this.checkLight(), 3_000);
        }
      });

      eventEmitter.addListener("person", (personDetected) => {
        this.onvifPersonActive = Boolean(personDetected);
        this.log.debug("Person detected", personDetected);
        this.personSensor?.set(Boolean(personDetected));
      });
    } catch (err) {
      this.log.error("Error connecting presence sensors to ONVIF events:", err);
    }
  }

  private async listenForDoorbell() {
    try {
      let ip = this.config.ipAddress;
      if (!net.isIP(ip)) {
        ip = (await dns.promises.lookup(ip, { family: 4 })).address;
      }
      this.unsubscribeDoorbell = DoorbellListener.getShared(
        this.platform.log
      ).subscribe(ip, () => this.onDoorbellPress("doorbell signal"));
    } catch (err) {
      this.log.error("Error setting up doorbell press listener:", err);
    }
  }

  private onDoorbellPress(source: string) {
    this.lastDoorbellPressAt = Date.now();
    this.log.info(`Doorbell pressed (${source})`);
    this.doorbellSensor?.pulse();
  }

  private async checkLight() {
    try {
      const on = await this.camera.getLightOn();
      if (on === undefined) {
        if (!this.lightUnsupportedWarned) {
          this.lightUnsupportedWarned = true;
          this.log.warn(
            "This camera did not report the state of its light. The light sensor will stay off."
          );
        }
        return;
      }
      this.lightSensor?.set(on);
    } catch (err) {
      this.log.debug("Error checking light status:", err);
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
        (this.needsOnvif() && !this.camera.onvifConnected)
      ) {
        let onvifSuccess = true;
        if (this.needsOnvif()) {
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

      if (cameraStatus.floodLight !== undefined) {
        this.lightSensor?.set(cameraStatus.floodLight);
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

    if (this.config.enableFloodLightAccessory) {
      this.setupToggleAccessory(
        this.config.floodLightAccessoryName || "Floodlight",
        "floodLight",
        this.api.hap.Service.Lightbulb
      );
    }

    if (!this.config.disableMotionSensorAccessory) {
      this.setupMotionSensorAccessory();
    }

    this.setupPresenceSensors();

    // // Publish as external accessory
    this.log.debug("Publishing accessory...");
    this.api.publishExternalAccessories(PLUGIN_ID, [this.accessory]);

    this.startPresenceSources();

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
