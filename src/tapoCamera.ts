import { Logging } from "homebridge";
import fetch from "node-fetch";
import https from "https";
import { CameraConfig } from "./cameraAccessory";

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export class TAPOCamera {
  private readonly log: Logging;
  private readonly config: CameraConfig;

  constructor(log: Logging, config: CameraConfig) {
    this.log = log;
    this.config = config as unknown as CameraConfig;
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
      result: { stok: string; user_group: string };
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

  async makeRequest(req: TAPOCameraRequest) {
    const url = await this.getCameraUrl();
    const response = await fetch(url, {
      method: "post",
      agent: httpsAgent,
      body: JSON.stringify(req),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const json = (await response.json()) as TAPOCameraResponse;
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
    this.log.debug("setLensMaskConfig", JSON.stringify(json, null, 2));
    return json.error_code !== 0;
  }

  async setAlarmConfig(value: boolean) {
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
    this.log.debug("setAlarmConfig", JSON.stringify(json, null, 2));
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
    // @ts-ignore
    return json.result.responses[0].result.device_info.basic_info;
  }

  async getStatus() {
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
    this.log.debug("getStatus", JSON.stringify(json, null, 2));

    if (json.error_code !== 0) {
      throw new Error("Camera replied with error");
    }

    return json.result.responses;
  }
}
