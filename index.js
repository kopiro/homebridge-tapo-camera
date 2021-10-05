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

  getToken(callback) {
    HTTP.http.httpRequest(
      {
        url: `https://${this.config.ipAddress}/`,
        method: "post",
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
        this.log.debug("getToken response", body);

        try {
          const json = response.toJSON();
          if (!json.result.stok) {
            return callback(new Error("Unable to find token in response"));
          }
          callback(null, json.result.stok);
        } catch (err) {
          callback(err);
        }
      }
    );
  }

  getCameraUrl(callback) {
    this.getToken((error, token) => {
      if (error) return callback(error);
      callback(null, `https://${this.config.ipAddress}/stok=${token}/ds`);
    });
  }

  getStatus(callback) {
    if (this.pullTimer) this.pullTimer.resetTimer();

    this.getCameraUrl((error, url) => {
      if (error) {
        this.log.error("getStatus", error);
        return callback(error);
      }

      this.log.debug("getStatusURL", url);

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
          try {
            const json = response.toJSON();
            callback(json.enabled === "on");
          } catch (err) {
            callback(err);
          }
        }
      );
    });
  }

  setStatus(on, callback) {
    if (this.pullTimer) this.pullTimer.resetTimer();

    this.getCameraUrl((error, url) => {
      if (error) {
        this.log.error("setStatus", error);
        return callback(error);
      }

      this.log.debug("setStatusURL", url);

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
