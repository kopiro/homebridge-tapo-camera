import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service,
} from "homebridge";
import fetch from "node-fetch";
import https from "https";

const pkg = {
  name: "TAPO-CAMERA",
  version: "1.0.0",
  author: "Flavio De Stefano",
};

let hap: HAP;

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  hap = api.hap;
  api.registerAccessory(
    "homebridge-tapo-camera",
    "TAPO-CAMERA",
    HomebridgeTapoCamera
  );
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

class HomebridgeTapoCamera {
  private readonly log: Logging;
  private readonly config: AccessoryConfig;
  private readonly api: API;

  private readonly switchService: Service;
  private readonly informationService: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.config = config;
    this.api = api;

    if (!this.config.name) throw new Error("Missing name");
    if (!this.config.password) throw new Error("Missing password");
    if (!this.config.ipAddress) throw new Error("Missing IP Address");

    this.log.debug("TAPO-CAMERA loaded", this.config);

    this.switchService = new hap.Service.Switch(this.config.name);

    this.switchService
      .getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, async (callback) => {
        try {
          const status = await this.getStatus();
          callback(null, status);
        } catch (err) {
          callback(err as Error);
        }
      })
      .on(CharacteristicEventTypes.SET, async (value, callback) => {
        try {
          await this.setStatus(Boolean(value));
          callback(null);
        } catch (err) {
          callback(err as Error);
        }
      });

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, pkg.author)
      .setCharacteristic(hap.Characteristic.Model, pkg.name)
      .setCharacteristic(
        hap.Characteristic.SerialNumber,
        this.config.serialNumber || `TAPO-${this.config.name}`
      )
      .setCharacteristic(hap.Characteristic.FirmwareRevision, pkg.version);
  }

  getServices() {
    return [this.informationService, this.switchService];
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
      result: { stok: string };
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
