"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const node_fetch_1 = __importDefault(require("node-fetch"));
const https_1 = __importDefault(require("https"));
const pkg = {
    name: "TAPO-CAMERA",
    version: "1.0.0",
    author: "Flavio De Stefano",
};
let hap;
const httpsAgent = new https_1.default.Agent({
    rejectUnauthorized: false,
});
const setLensMaskConfigJSON = (enabled) => {
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
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        if (!this.config.name)
            throw new Error("Missing name");
        if (!this.config.password)
            throw new Error("Missing password");
        if (!this.config.ipAddress)
            throw new Error("Missing IP Address");
        this.log.debug("TAPO-CAMERA loaded", this.config);
        this.switchService = new hap.Service.Switch(this.config.name);
        this.switchService
            .getCharacteristic(hap.Characteristic.On)
            .on("get" /* GET */, async (callback) => {
            try {
                const status = await this.getStatus();
                callback(null, status);
            }
            catch (err) {
                callback(err);
            }
        })
            .on("set" /* SET */, async (value, callback) => {
            try {
                await this.setStatus(Boolean(value));
                callback(null);
            }
            catch (err) {
                callback(err);
            }
        });
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, pkg.author)
            .setCharacteristic(hap.Characteristic.Model, pkg.name)
            .setCharacteristic(hap.Characteristic.SerialNumber, this.config.serialNumber || `TAPO-${this.config.name}`)
            .setCharacteristic(hap.Characteristic.FirmwareRevision, pkg.version);
    }
    getServices() {
        return [this.informationService, this.switchService];
    }
    async getToken() {
        const response = await (0, node_fetch_1.default)(`https://${this.config.ipAddress}/`, {
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
        const json = (await response.json());
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
        const response = await (0, node_fetch_1.default)(url, {
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
        const json = (await response.json());
        this.log.debug("getStatus", JSON.stringify(json, null, 2));
        if (json.error_code !== 0) {
            throw new Error("Camera replied with error");
        }
        const maskConfig = json.result.responses.find((r) => r.method === "getLensMaskConfig");
        if (!maskConfig) {
            throw new Error("Camera didn't reply correctly");
        }
        return maskConfig.result.lens_mask.lens_mask_info.enabled === "off";
    }
    async setStatus(value) {
        const url = await this.getCameraUrl();
        const response = await (0, node_fetch_1.default)(url, {
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
        const json = (await response.json());
        this.log.debug("setStatus", JSON.stringify(json, null, 2));
        if (json.error_code !== 0) {
            throw new Error("Camera replied with error");
        }
        const maskConfig = json.result.responses.find((r) => r.method === "setLensMaskConfig");
        if (!maskConfig) {
            throw new Error("Camera didn't reply correctly");
        }
        return maskConfig.error_code === 0;
    }
}
module.exports = (api) => {
    hap = api.hap;
    api.registerAccessory("homebridge-tapo-camera", "TAPO-CAMERA", HomebridgeTapoCamera);
};
//# sourceMappingURL=index.js.map