const HTTP = require("homebridge-http-base");

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

    this.pullTimer = new HTTP.PullTimer(
      this.log,
      this.config.pullInterval,
      this.getStatus.bind(this),
      (value) => {
        this.homebridgeService
          .getCharacteristic(this.api.hap.Characteristic.On)
          .updateValue(value);
      }
    );
    this.pullTimer.start();
  }

  getServices() {
    if (!this.homebridgeService) return [];

    const informationService = new this.api.hap.Service.AccessoryInformation();
    informationService
      .setCharacteristic(
        this.api.HAP.Characteristic.Manufacturer,
        "Flavio De Stefano"
      )
      .setCharacteristic(this.api.HAP.Characteristic.Model, "TAPO Camera")
      .setCharacteristic(
        this.api.HAP.Characteristic.SerialNumber,
        this.serialNumber || "TAPO"
      )
      .setCharacteristic(this.api.HAP.Characteristic.FirmwareRevision, "1.0.0");
    return [informationService, this.homebridgeService];
  }

  getToken(callback) {
    HTTP.http.httpRequest(
      {
        url: `https://${this.config.ipAddress}/`,
        strictSSL: false,
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
      },
      (error, response, body) => {
        if (error) return callback(error);
        this.log.debug("getToken response", response, body);
        try {
          const json = JSON.parse(body);
          callback(null, json.stok);
        } catch (err) {
          callback(err);
        }
      }
    );
  }

  getCameraUrl(callback) {
    this.getToken((err, token) => {
      callback(null, `https://${this.config.ipAddress}/stok=${token}/ds`);
    });
  }

  getStatus(callback) {
    if (this.pullTimer) this.pullTimer.resetTimer();

    this.getCameraUrl((error, url) => {
      if (error) return callback(error);

      HTTP.http.httpRequest(
        {
          url,
          strictSSL: false,
          method: "post",
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
        },
        (error, response, body) => {
          if (error) return callback(error);
          this.log.debug("Response from getStatus", body);
          const json = JSON.parse(body);
          callback(json.enabled === "on");
        }
      );
    });
  }

  setStatus(on, callback) {
    if (this.pullTimer) this.pullTimer.resetTimer();

    this.getCameraUrl((error, url) => {
      if (error) return callback(error);

      HTTP.http.httpRequest(
        {
          url,
          strictSSL: false,
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
        },
        (error, response, body) => {
          if (error) return callback(error);
          this.log.debug("Response from setStatus", body);
          callback();
        }
      );
    });
  }
}

module.exports = function (homebridge) {
  homebridge.registerAccessory(
    "homebridge-tapo-camera",
    "TAPO-CAMERA",
    HomebridgeTapoCamera
  );
};
