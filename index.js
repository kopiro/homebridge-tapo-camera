const fetch = require("node-fetch");
const https = require("https");

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

    this.log.debug("TAPO-CAMERA loaded");

    this.switchService = new this.api.hap.Service.Switch(this.config.name);

    this.switchService
      .getCharacteristic(this.api.hap.Characteristic.On)
      .on("get", async (callback) => {
        const status = await this.getStatus();
        callback(null, status);
      })
      .on("set", async (value, callback) => {
        const status = await this.setStatus(value);
        callback(null, status);
      });

    this.informationService = new this.api.hap.Service.AccessoryInformation();
    this.informationService
      .setCharacteristic(
        this.api.hap.Characteristic.Manufacturer,
        "Flavio De Stefano"
      )
      .setCharacteristic(this.api.hap.Characteristic.Model, "TAPO Camera")
      .setCharacteristic(
        this.api.hap.Characteristic.SerialNumber,
        this.serialNumber || "TAPO"
      )
      .setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, "1.0.0");
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
    this.log.debug("getToken", json);

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
    this.log.debug("getStatus", json);

    return json.enabled === "on";
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
    this.log.debug("setStatus", json);
    return true;
  }
}

module.exports = function (homebridge) {
  homebridge.registerAccessory(
    "homebridge-tapo-camera",
    "TAPO-CAMERA",
    HomebridgeTapoCamera
  );
};
