import { Logging } from "homebridge";
import fetch from "node-fetch";
import https, { Agent } from "https";
import { CameraConfig } from "./cameraAccessory";
import crypto from "crypto";
export class TAPOCamera {
  private readonly log: Logging;
  private readonly config: CameraConfig;
  private readonly kStreamPort = 554;
  private readonly kTokenExpiration = 1000 * 60 * 60;
  private readonly httpsAgent: Agent;

  private readonly hashedPassword: string;
  private token: [string, number] | undefined;

  constructor(log: Logging, config: CameraConfig) {
    this.log = log;
    this.config = config;
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });
    this.hashedPassword = crypto
      .createHash("md5")
      .update(this.config.password)
      .digest("hex")
      .toUpperCase();
  }

  getCredentials() {
    return {
      username: "admin",
      password: this.hashedPassword,
    };
  }

  async getToken() {
    if (this.token && this.token[1] + this.kTokenExpiration > Date.now()) {
      this.log.debug(
        `Token still has ${
          (this.token[1] + this.kTokenExpiration - Date.now()) / 1000
        }s to live, using it.`
      );
      return this.token[0];
    }

    this.log.debug(`Token is expired, requesting new one.`);

    const response = await fetch(`https://${this.config.ipAddress}/`, {
      method: "post",
      body: JSON.stringify({
        method: "login",
        params: this.getCredentials(),
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

    this.log.debug("Token response", JSON.stringify(json));

    if (!json.result.stok) {
      throw new Error(
        "Unable to find token in response, probably your credentials are not valid. Please make sure you set your TAPO Cloud password"
      );
    }

    // Store cache
    this.token = [json.result.stok, Date.now()];
    return json.result.stok;
  }

  async getCameraUrl() {
    const token = await this.getToken();
    return `https://${this.config.ipAddress}/stok=${token}/ds`;
  }

  async makeRequest(req: TAPOCameraRequest) {
    const url = await this.getCameraUrl();

    this.log.debug(`Making call to ${url} with req =`, JSON.stringify(req));

    const response = await fetch(url, {
      method: "post",
      agent: this.httpsAgent,
      body: JSON.stringify(req),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const json = (await response.json()) as TAPOCameraResponse;

    this.log.debug("response is", JSON.stringify(json));

    return json;
  }

  async setLensMaskConfig(value: boolean) {
    const json = await this.makeRequest({
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
    const json = await this.makeRequest({
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

  async getInfo() {
    const json = await this.makeRequest({
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
    const json = await this.makeRequest({
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

  getStreamUrl() {
    return `rtsp://${this.config.streamUser}:${this.config.streamPassword}@${this.config.ipAddress}:${this.kStreamPort}/stream1`;
  }

  getStreamDimensions() {
    return [1920, 1080, 15];
  }
}
