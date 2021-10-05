import fetch from "node-fetch";
import https from "https";

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

    this.homebridgeService = new this.api.hap.Service.Switch(this.config.name);
  }

  getServices() {
    if (!this.homebridgeService) return [];

    const informationService = new this.api.hap.Service.AccessoryInformation();
    informationService
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
    return [informationService, this.homebridgeService];
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
    this.log.debug("getToken", response.body);

    const json = await response.json();
    if (!json.result.stok) {
      throw new Error("Unable to find token in response");
    }

    return json.result.stok;
  }

  async getCameraUrl() {
    const token = await this.getToken();
    return `https://${this.config.ipAddress}/stok=${token}/ds`;
  }

  async getStatus(callback) {
    try {
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
      this.log.debug("getStatus", response.body);

      const json = await response.json();
      callback(response.enabled === "on");
    } catch (err) {
      callback(err);
    }
  }

  async setStatus(on, callback) {
    try {
      const url = await this.getCameraUrl();

      const response = await fetch(url, {
        agent: httpsAgent,
        method: "post",
        body: JSON.stringify({
          method: "multipleRequest",
          params: {
            requests: [setLensMaskConfigJSON(on)],
          },
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      this.log.debug("setStatus", response.body);
      const json = await response.json();
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

module.exports = function (homebridge) {
  homebridge.registerAccessory(
    "homebridge-tapo-camera",
    "TAPO-CAMERA",
    HomebridgeTapoCamera
  );
};
