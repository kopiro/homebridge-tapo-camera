const fetch = require("node-fetch");
const https = require("https");
const pkg = require("./package.json");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

function setLensMaskConfigJSON(enabled) {
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
}

class HomebridgeTapoCamera {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    if (!this.config.name) throw new Error("Missing name");
    if (!this.config.password) throw new Error("Missing password");
    if (!this.config.ipAddress) throw new Error("Missing IP Address");

    this.log.debug("TAPO-CAMERA loaded", this.config);

    this.switchService = new this.api.hap.Service.Switch(this.config.name);

    this.switchService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .on("get", async (callback) => {
        try {
          const status = await this.getStatus();
          callback(null, status);
        } catch (err) {
          callback(err);
        }
      })
      .on("set", async (value, callback) => {
        try {
          await this.setStatus(value);
          callback(null);
        } catch (err) {
          callback(err);
        }
      });

    this.informationService = new this.api.hap.Service.AccessoryInformation();
    this.informationService
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, pkg.author)
      .setCharacteristic(this.api.hap.Characteristic.Model, pkg.name)
      .setCharacteristic(
        this.api.hap.Characteristic.SerialNumber,
        this.serialNumber || `TAPO-${this.config.name}`
      )
      .setCharacteristic(
        this.api.hap.Characteristic.FirmwareRevision,
        pkg.version
      );
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

    const json = await response.json();
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
    const json = await response.json();
    this.log.debug("getStatus", JSON.stringify(json, null, 2));

    if (json.error_code !== 0) {
      throw new Error("Camera replied with error");
    }

    const maskConfig = json.result.responses.find(
      (r) => r.method === "getLensMaskConfig"
    );
    return maskConfig.result.lens_mask.lens_mask_info.enabled === "on";
  }

  async setStatus(value) {
    const url = await this.getCameraUrl();

    const response = await fetch(url, {
      agent: httpsAgent,
      method: "post",
      body: JSON.stringify({
        method: "multipleRequest",
        params: {
          requests: [setLensMaskConfigJSON(value)],
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const json = await response.json();
    this.log.debug("setStatus", JSON.stringify(json, null, 2));

    if (json.error_code !== 0) {
      throw new Error("Camera replied with error");
    }

    const maskConfig = json.result.responses.find(
      (r) => r.method === "setLensMaskConfig"
    );
    return maskConfig.error_code === 0;
  }
}

module.exports = function (homebridge) {
  homebridge.registerAccessory(
    "homebridge-tapo-camera",
    "TAPO-CAMERA",
    HomebridgeTapoCamera
  );
};
