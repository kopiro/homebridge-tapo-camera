const { HTTP, PullTimer } = require("homebridge-http-base");
let HAP;

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
  constructor(log, config) {
    this.log = log;
    this.config = config;
    this.homebridgeService = new HAP.Service.Switch(this.config.name);

    this.pullTimer = new PullTimer(
      this.log,
      this.config.pullInterval,
      this.getStatus.bind(this),
      (value) => {
        this.homebridgeService
          .getCharacteristic(HAP.Characteristic.On)
          .updateValue(value);
      }
    );
    this.pullTimer.start();
  }

  getServices() {
    if (!this.homebridgeService) return [];

    const informationService = new HAP.Service.AccessoryInformation();
    informationService
      .setCharacteristic(HAP.Characteristic.Manufacturer, "Flavio De Stefano")
      .setCharacteristic(HAP.Characteristic.Model, "TAPO Camera")
      .setCharacteristic(
        HAP.Characteristic.SerialNumber,
        this.serialNumber || "TAPO"
      )
      .setCharacteristic(HAP.Characteristic.FirmwareRevision, "1.0.0");
    return [informationService, this.homebridgeService];
  }

  getToken(callback) {
    HTTP.httpRequest(
      {
        url: `https://${this.config.ipAddress}`,
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
        const json = JSON.parse(body);
        callback(null, json.stok);
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

      HTTP.httpRequest(
        {
          url,
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
          this.log("Response from getStatus", body);
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

      HTTP.httpRequest(
        {
          url,
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
          this.log("Response from setStatus", body);
          callback();
        }
      );
    });
  }
}

module.exports = function (homebridge) {
  HAP = homebridge.hap;

  homebridge.registerAccessory(
    "homebridge-tapo-camera",
    "TAPO-CAMERA",
    HomebridgeTapoCamera
  );
};
