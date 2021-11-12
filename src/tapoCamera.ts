import { Logging } from "homebridge";
import fetch from "node-fetch";
import https, { Agent } from "https";
import { CameraConfig } from "./cameraAccessory";
import crypto from "crypto";
import { OnvifCamera } from "./onvifCamera";

export class TAPOCamera extends OnvifCamera {
  private readonly kTokenExpiration = 1000 * 60 * 60;
  private readonly httpsAgent: Agent;
  private readonly kStreamPort = 554;

  private readonly hashedPassword: string;
  private token: Promise<[string, number]> | undefined;

  constructor(log: Logging, config: CameraConfig) {
    super(log, config);

    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });
    this.hashedPassword = crypto
      .createHash("md5")
      .update(config.password)
      .digest("hex")
      .toUpperCase();
  }

  getTapoAPICredentials() {
    return {
      username: "admin",
      password: this.hashedPassword,
    };
  }

  getAuthenticatedStreamUrl(lowQuality: boolean) {
    const prefix = `rtsp://${this.config.streamUser}:${this.config.streamPassword}@${this.config.ipAddress}:${this.kStreamPort}`;
    return lowQuality ? `${prefix}/stream2` : `${prefix}/stream1`;
  }

  private async fetchToken(): Promise<[string, number]> {
    const response = await fetch(`https://${this.config.ipAddress}/`, {
      method: "post",
      body: JSON.stringify({
        method: "login",
        params: this.getTapoAPICredentials(),
      }),
      headers: {
        "Content-Type": "application/json",
      },
      agent: this.httpsAgent,
    });

    const json = (await response.json()) as {
      result: { stok: string; user_group: string };
      error_code: number;
    };

    this.log.debug(
      `[${this.config.name}]`,
      "Token response",
      JSON.stringify(json)
    );

    if (!json.result.stok) {
      throw new Error(
        "Unable to find token in response, probably your credentials are not valid. Please make sure you set your TAPO Cloud password"
      );
    }

    return [json.result.stok, Date.now()];
  }

  async getToken() {
    if (this.token) {
      const tok = await this.token;
      if (tok[1] + this.kTokenExpiration > Date.now()) {
        this.log.debug(
          `[${this.config.name}]`,
          `Token still has ${
            (tok[1] + this.kTokenExpiration - Date.now()) / 1000
          }s to live, using it.`
        );
        return tok[0];
      }
    }

    this.log.debug(
      `[${this.config.name}]`,
      `Token is expired, requesting new one.`
    );

    this.token = this.fetchToken();
    return this.token
      .then((token) => token[0])
      .finally(() => (this.token = undefined));
  }

  private async getTAPOCameraAPIUrl() {
    const token = await this.getToken();
    return `https://${this.config.ipAddress}/stok=${token}/ds`;
  }

  private pendingAPIRequests: Map<string, Promise<TAPOCameraResponse>> =
    new Map();

  private async makeTAPOAPIRequest(req: TAPOCameraRequest) {
    const reqJson = JSON.stringify(req);

    if (this.pendingAPIRequests.has(reqJson)) {
      return this.pendingAPIRequests.get(reqJson)!;
    }

    this.pendingAPIRequests.set(
      reqJson,
      (async () => {
        const url = await this.getTAPOCameraAPIUrl();

        this.log.debug(
          `[${this.config.name}]`,
          `Making call to ${url} with req =`,
          JSON.stringify(req)
        );

        const response = await fetch(url, {
          method: "post",
          agent: this.httpsAgent,
          body: JSON.stringify(req),
          headers: {
            "Content-Type": "application/json",
          },
        });
        const json = (await response.json()) as TAPOCameraResponse;

        this.log.debug(
          `[${this.config.name}]`,
          "response is",
          JSON.stringify(json)
        );

        this.pendingAPIRequests.delete(reqJson);

        return json;
      })()
    );

    return this.pendingAPIRequests.get(reqJson)!;
  }

  async setLensMaskConfig(value: boolean) {
    const json = await this.makeTAPOAPIRequest({
      method: "multipleRequest",
      params: {
        requests: [
          {
            method: "setLensMaskConfig",
            params: {
              lens_mask: {
                lens_mask_info: {
                  enabled: value ? "on" : "off",
                },
              },
            },
          },
        ],
      },
    });

    return json.error_code !== 0;
  }

  async setAlertConfig(value: boolean) {
    const json = await this.makeTAPOAPIRequest({
      method: "multipleRequest",
      params: {
        requests: [
          {
            method: "setAlertConfig",
            params: {
              msg_alarm: {
                chn1_msg_alarm_info: {
                  enabled: value ? "on" : "off",
                },
              },
            },
          },
        ],
      },
    });

    return json.error_code !== 0;
  }

  async getTAPODeviceInfo() {
    const json = await this.makeTAPOAPIRequest({
      method: "multipleRequest",
      params: {
        requests: [
          {
            method: "getDeviceInfo",
            params: {
              device_info: {
                name: ["basic_info"],
              },
            },
          },
        ],
      },
    });

    const info = json.result.responses[0] as TAPOCameraResponseDeviceInfo;
    return info.result.device_info.basic_info;
  }

  async getStatus(): Promise<{ lensMask: boolean; alert: boolean }> {
    const json = await this.makeTAPOAPIRequest({
      method: "multipleRequest",
      params: {
        requests: [
          {
            method: "getAlertConfig",
            params: {
              msg_alarm: {
                name: "chn1_msg_alarm_info",
              },
            },
          },
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
    });

    if (json.error_code !== 0) {
      throw new Error("Camera replied with error");
    }

    const alertConfig = json.result.responses.find(
      (r) => r.method === "getAlertConfig"
    ) as TAPOCameraResponseGetAlert;
    const lensMaskConfig = json.result.responses.find(
      (r) => r.method === "getLensMaskConfig"
    ) as TAPOCameraResponseGetLensMask;

    return {
      alert: alertConfig.result.msg_alarm.chn1_msg_alarm_info.enabled === "on",
      lensMask: lensMaskConfig.result.lens_mask.lens_mask_info.enabled === "on",
    };
  }
}
