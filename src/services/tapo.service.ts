import https, { Agent } from 'https';
import fetch from 'node-fetch';
import crypto from 'crypto';
import type { PlatformAccessory } from 'homebridge';
import type { TapoCameraPlatform } from '../platform';

export default class TapoService {
  private readonly kTokenExpiration = 1000 * 60 * 60; // 1h
  private readonly kStreamPort = 554;
  private readonly httpsAgent: Agent;

  private readonly hashedPassword: string;
  private token: [string, number] | undefined;

  private tokenPromise: (() => Promise<string>) | undefined;

  constructor(
        protected readonly platform: TapoCameraPlatform,
        protected readonly accessory: PlatformAccessory,
  ) {

    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });
    this.hashedPassword = crypto
      .createHash('md5')
      .update(platform.config.password)
      .digest('hex')
      .toUpperCase();
  }

  getTapoAPICredentials() {
    return {
      username: 'admin',
      password: this.hashedPassword,
    };
  }

  getAuthenticatedStreamUrl(lowQuality: boolean) {
    // eslint-disable-next-line max-len
    const prefix = `rtsp://${this.platform.config.streamUser}:${this.platform.config.streamPassword}@${this.platform.config.ipAddress}:${this.kStreamPort}`;
    return lowQuality ? `${prefix}/stream2` : `${prefix}/stream1`;
  }

  private async fetchToken(): Promise<string> {
    this.platform.log.debug(`[${this.platform.config.name}]`, 'Fetching new token');

    const response = await fetch(`https://${this.platform.config.ipAddress}/`, {
      method: 'post',
      body: JSON.stringify({
        method: 'login',
        params: this.getTapoAPICredentials(),
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const json = (await response.json()) as {
            result: { stok: string; user_group: string };
            error_code: number;
        };

    if (!json.result.stok) {
      throw new Error(
        'Unable to find token in response, probably your credentials are not valid. Please make sure you set your TAPO Cloud password',
      );
    }

    return json.result.stok;
  }

  async getToken(): Promise<string> {
    if (this.token && this.token[1] + this.kTokenExpiration > Date.now()) {
      return this.token[0];
    }

    if (this.tokenPromise) {
      return this.tokenPromise();
    }

    this.tokenPromise = async () => {
      try {
        this.platform.log.debug(
          `[${this.platform.config.name}]`,
          'Token is expired , requesting new one.',
        );

        const token = await this.fetchToken();
        this.token = [token, Date.now()];
        return token;
      } finally {
        this.tokenPromise = undefined;
      }
    };
    return this.tokenPromise();
  }

  private async getTAPOCameraAPIUrl() {
    const token = await this.getToken();
    return `https://${this.platform.config.ipAddress}/stok=${token}/ds`;
  }

  private pendingAPIRequests: Map<string, Promise<TAPOCameraResponse>> =
    new Map();

  private async makeTAPOAPIRequest(req: TAPOCameraRequest) {
    const reqJson = JSON.stringify(req);

    if (this.pendingAPIRequests.has(reqJson)) {
      return this.pendingAPIRequests.get(
        reqJson,
      ) as Promise<TAPOCameraResponse>;
    }

    this.platform.log.debug(
      `[${this.platform.config.name}]`,
      'Making new request req =',
      req.params.requests.map((e) => e.method),
    );

    this.pendingAPIRequests.set(
      reqJson,
      (async () => {
        try {
          const url = await this.getTAPOCameraAPIUrl();

          const response = await fetch(url, {
            method: 'post',
            body: JSON.stringify(req),
            headers: {
              'Content-Type': 'application/json',
            },
            agent: this.httpsAgent,
          });
          const json = (await response.json()) as TAPOCameraResponse;
          this.platform.log.debug(
            `makeTAPOAPIRequest url: ${url}, json: ${JSON.stringify(json)}`,
          );
          if (json.error_code !== 0) {
            // Because of the token error when the camera comes back from no response.
            this.platform.log.info('Reset token. error_code: ', json.error_code);
            this.token = undefined;
          }

          return json;
        } finally {
          this.pendingAPIRequests.delete(reqJson);
        }
      })(),
    );

    return this.pendingAPIRequests.get(reqJson) as Promise<TAPOCameraResponse>;
  }

  async setLensMaskConfig(value: boolean) {
    const json = await this.makeTAPOAPIRequest({
      method: 'multipleRequest',
      params: {
        requests: [
          {
            method: 'setLensMaskConfig',
            params: {
              lens_mask: {
                lens_mask_info: {
                  enabled: value ? 'on' : 'off',
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
      method: 'multipleRequest',
      params: {
        requests: [
          {
            method: 'setAlertConfig',
            params: {
              msg_alarm: {
                chn1_msg_alarm_info: {
                  enabled: value ? 'on' : 'off',
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
      method: 'multipleRequest',
      params: {
        requests: [
          {
            method: 'getDeviceInfo',
            params: {
              device_info: {
                name: ['basic_info'],
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
      method: 'multipleRequest',
      params: {
        requests: [
          {
            method: 'getAlertConfig',
            params: {
              msg_alarm: {
                name: 'chn1_msg_alarm_info',
              },
            },
          },
          {
            method: 'getLensMaskConfig',
            params: {
              lens_mask: {
                name: 'lens_mask_info',
              },
            },
          },
        ],
      },
    });

    if (json.error_code !== 0) {
      throw new Error('Camera replied with error');
    }

    const alertConfig = json.result.responses.find(
      (r) => r.method === 'getAlertConfig',
    ) as TAPOCameraResponseGetAlert;
    const lensMaskConfig = json.result.responses.find(
      (r) => r.method === 'getLensMaskConfig',
    ) as TAPOCameraResponseGetLensMask;

    return {
      alert: alertConfig.result.msg_alarm.chn1_msg_alarm_info.enabled === 'on',
      lensMask: lensMaskConfig.result.lens_mask.lens_mask_info.enabled === 'on',
    };
  }
}