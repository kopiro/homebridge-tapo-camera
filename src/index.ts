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
import https from "https";
import { StreamingDelegate } from "homebridge-camera-ffmpeg/dist/streamingDelegate";
import { Logger } from "homebridge-camera-ffmpeg/dist/logger";

const pkg = {
  pluginName: "homebridge-tapo-camera",
  name: "TAPO-CAMERA",
  version: "1.0.0",
  author: "Flavio De Stefano",
};

type CameraConfig = {
  accessory: string;
  name: string;
  ipAddress: string;
  password: string;
  model: string;
  serialNumber: string;
  firmwareRevision: string;
  streamUser: string;
  streamPassword: string;
};

type Config = {
  cameras: CameraConfig[];
};

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  api.registerPlatform(pkg.pluginName, pkg.name, HomebridgeTapoCameraPlatform);
};

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const setLensMaskConfigJSON = (enabled: boolean) => {
  return {
    method: "setLensMaskConfig",
    params: {
      lens_mask: {
        lens_mask_info: {
          enabled: enabled ? "on" : "off",
        },
      },
    },
  };
};

class TAPOCamera {
  private readonly log: Logging;
  private readonly config: CameraConfig;
  private readonly api: API;

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
    this.setupAccessory();
    this.api.publishExternalAccessories(pkg.pluginName, [this.accessory]);
  }

  setupAccessory(): void {
    this.log.info("Setup camera...", this.accessory.displayName);

    this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.info("Identify requested.", this.accessory.displayName);
    });

    const accInfo = this.accessory.getService(
      this.api.hap.Service.AccessoryInformation
    );
    if (accInfo) {
      accInfo.setCharacteristic(
        this.api.hap.Characteristic.Manufacturer,
        "TAPO"
      );
      accInfo.setCharacteristic(
        this.api.hap.Characteristic.Model,
        this.config.model || "Camera FFmpeg"
      );
      accInfo.setCharacteristic(
        this.api.hap.Characteristic.SerialNumber,
        this.config.serialNumber || "SerialNumber"
      );
      accInfo.setCharacteristic(
        this.api.hap.Characteristic.FirmwareRevision,
        this.config.firmwareRevision || "0.0.0"
      );
    }

    const delegate = new StreamingDelegate(
      this.log as unknown as Logger,
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
          debug: true,
        },
      },
      this.api,
      this.api.hap
    );
    this.accessory.configureController(delegate.controller);
  }

  async getToken() {
    const response = await fetch(`https://${this.config.ipAddress}/`, {
      method: "post",
      body: JSON.stringify({
        method: "login",
        params: {
          username: "admin",
          password: this.config.password,
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
      agent: httpsAgent,
    });

    const json = (await response.json()) as {
      result: { stok: string; user_group: string };
      error_code: number;
    };
    this.log.debug("getToken", JSON.stringify(json, null, 2));

    if (!json.result.stok) {
      throw new Error("Unable to find token in response");
    }

    return json.result.stok;
  }

  async getCameraUrl() {
    const token = await this.getToken();
    return `https://${this.config.ipAddress}/stok=${token}/ds`;
  }

  async getStatus() {
    const url = await this.getCameraUrl();

    const response = await fetch(url, {
      method: "post",
      agent: httpsAgent,
      body: JSON.stringify({
        method: "multipleRequest",
        params: {
          requests: [
            {
              method: "getLensMaskConfig",
              params: {
                lens_mask: {
                  name: "lens_mask_info",
                },
              },
            },
          ],
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const json = (await response.json()) as {
      error_code: number;
      result: {
        responses: Array<{
          method: string;
          result: { lens_mask: { lens_mask_info: { enabled: string } } };
        }>;
      };
    };
    this.log.debug("getStatus", JSON.stringify(json, null, 2));

    if (json.error_code !== 0) {
      throw new Error("Camera replied with error");
    }

    const maskConfig = json.result.responses.find(
      (r) => r.method === "getLensMaskConfig"
    );
    if (!maskConfig) {
      throw new Error("Camera didn't reply correctly");
    }

    return maskConfig.result.lens_mask.lens_mask_info.enabled === "off";
  }

  async setStatus(value: boolean) {
    const url = await this.getCameraUrl();

    const response = await fetch(url, {
      agent: httpsAgent,
      method: "post",
      body: JSON.stringify({
        method: "multipleRequest",
        params: {
          requests: [setLensMaskConfigJSON(!value)],
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const json = (await response.json()) as {
      error_code: number;
      result: { responses: Array<{ method: string; error_code: number }> };
    };
    this.log.debug("setStatus", JSON.stringify(json, null, 2));

    if (json.error_code !== 0) {
      throw new Error("Camera replied with error");
    }

    const maskConfig = json.result.responses.find(
      (r) => r.method === "setLensMaskConfig"
    );
    if (!maskConfig) {
      throw new Error("Camera didn't reply correctly");
    }

    return maskConfig.error_code === 0;
  }
}

class HomebridgeTapoCameraPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly config: Config;
  private readonly api: API;

  private cameras: TAPOCamera[];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.config = config as unknown as Config;
    this.api = api;
    this.cameras = [];

    api.on(APIEvent.DID_FINISH_LAUNCHING, this.didFinishLaunching.bind(this));
    this.log.debug("TAPO-CAMERA loaded", this.config);
  }

  didFinishLaunching() {
    this.cameras = this.config.cameras.map(
      (c) => new TAPOCamera(this.log, c, this.api)
    );
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info(
      "Configuring cached bridged accessory...",
      accessory.displayName
    );
  }
}
