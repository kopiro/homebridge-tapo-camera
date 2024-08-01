import { Logging } from "homebridge";
import { CameraConfig } from "./cameraAccessory";
import crypto from "crypto";
import { OnvifCamera } from "./onvifCamera";
import type {
  TAPOCameraEncryptedRequest,
  TAPOCameraEncryptedResponse,
  TAPOCameraLoginResponse,
  TAPOCameraRefreshStokResponse,
  TAPOCameraRequest,
  TAPOCameraResponse,
  TAPOCameraResponseDeviceInfo,
  TAPOCameraSingleRequest,
} from "./types/tapo";
import { Agent } from "undici";

const MAX_LOGIN_RETRIES = 3;
const AES_BLOCK_SIZE = 16;

export type Status = {
  eyes: boolean;
  alarm: boolean;
  notifications: boolean;
  motionDetection: boolean;
};

export class TAPOCamera extends OnvifCamera {
  private readonly kStreamPort = 554;
  private readonly httpsAgent: Agent;

  private readonly hashedMD5Password: string;
  private readonly hashedSha256Password: string;
  private passwordEncryptionMethod: "md5" | "sha256" | null = "md5";

  private isSecureConnectionValue: boolean | null = null;

  private stokPromise: (() => Promise<string>) | undefined;

  private readonly cnonce: string;
  private lsk: Buffer | undefined;
  private ivb: Buffer | undefined;
  private seq: number | undefined;
  private stok: string | undefined;

  constructor(
    protected readonly log: Logging,
    protected readonly config: CameraConfig
  ) {
    super(log, config);

    this.httpsAgent = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    });

    this.cnonce = this.generateCnonce();

    this.hashedMD5Password = crypto
      .createHash("md5")
      .update(config.password)
      .digest("hex")
      .toUpperCase();
    this.hashedSha256Password = crypto
      .createHash("sha256")
      .update(config.password)
      .digest("hex")
      .toUpperCase();
  }

  private getUsername() {
    return this.config.username || "admin";
  }

  private getHeaders(): Record<string, string> {
    return {
      Host: `https://${this.config.ipAddress}`,
      Referer: `https://${this.config.ipAddress}`,
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "User-Agent": "Tapo CameraClient Android",
      Connection: "close",
      requestByApp: "true",
      "Content-Type": "application/json; charset=UTF-8",
    };
  }

  private getHashedPassword() {
    if (this.passwordEncryptionMethod === "md5") {
      return this.hashedMD5Password;
    } else if (this.passwordEncryptionMethod === "sha256") {
      return this.hashedSha256Password;
    } else {
      throw new Error("Unknown password encryption method");
    }
  }

  private fetch(url: string, data: RequestInit) {
    return fetch(url, {
      headers: this.getHeaders(),
      // @ts-expect-error Dispatcher type not there
      dispatcher: this.httpsAgent,
      ...data,
    });
  }

  private generateEncryptionToken(tokenType: string, nonce: string): Buffer {
    const hashedKey = crypto
      .createHash("sha256")
      .update(this.cnonce + this.getHashedPassword() + nonce)
      .digest("hex")
      .toUpperCase();
    return crypto
      .createHash("sha256")
      .update(tokenType + this.cnonce + nonce + hashedKey)
      .digest()
      .slice(0, 16);
  }

  getAuthenticatedStreamUrl(lowQuality = false) {
    const prefix = `rtsp://${this.config.streamUser}:${this.config.streamPassword}@${this.config.ipAddress}:${this.kStreamPort}`;
    return lowQuality ? `${prefix}/stream2` : `${prefix}/stream1`;
  }

  private generateCnonce() {
    return crypto.randomBytes(8).toString("hex").toUpperCase();
  }

  private validateDeviceConfirm(nonce: string, deviceConfirm: string) {
    const hashedNoncesWithSHA256 = crypto
      .createHash("sha256")
      .update(this.cnonce + this.hashedSha256Password + nonce)
      .digest("hex")
      .toUpperCase();
    const hashedNoncesWithMD5 = crypto
      .createHash("md5")
      .update(this.cnonce + this.hashedMD5Password + nonce)
      .digest("hex")
      .toUpperCase();

    if (deviceConfirm === hashedNoncesWithSHA256 + nonce + this.cnonce) {
      this.passwordEncryptionMethod = "sha256";
      return true;
    }

    if (deviceConfirm === hashedNoncesWithMD5 + nonce + this.cnonce) {
      this.passwordEncryptionMethod = "md5";
      return true;
    }

    return false;
  }

  async refreshStok(loginRetryCount = 0): Promise<string> {
    const isSecureConnection = await this.isSecureConnection();

    let response = null;
    let responseData = null;

    let fetchParams = {};
    if (isSecureConnection) {
      this.log.debug("StokRefresh: Using secure connection");
      fetchParams = {
        method: "post",
        body: JSON.stringify({
          method: "login",
          params: {
            cnonce: this.cnonce,
            encrypt_type: "3",
            username: this.getUsername(),
          },
        }),
      };
    } else {
      this.log.debug("StokRefresh: Using unsecure connection");
      fetchParams = {
        method: "post",
        body: JSON.stringify({
          method: "login",
          params: {
            username: this.getUsername(),
            password: this.getHashedPassword(),
            hashed: true,
          },
        }),
      };
    }

    response = await this.fetch(
      `https://${this.config.ipAddress}`,
      fetchParams
    );
    responseData = (await response.json()) as TAPOCameraRefreshStokResponse;

    this.log.debug(
      "StokRefresh: Login response :>> ",
      response.status,
      JSON.stringify(responseData)
    );

    if (response.status === 401) {
      if (responseData.result?.data?.code === 40411) {
        throw new Error("Invalid credentials");
      }
    }

    const nonce = responseData.result?.data?.nonce;
    const deviceConfirm = responseData.result?.data?.device_confirm;

    if (isSecureConnection && nonce && deviceConfirm) {
      if (!this.validateDeviceConfirm(nonce, deviceConfirm)) {
        throw new Error("Invalid device confirm");
      }

      const digestPasswd = crypto
        .createHash("sha256")
        .update(this.getHashedPassword() + this.cnonce + nonce)
        .digest("hex")
        .toUpperCase();

      const digestPasswdFull = Buffer.concat([
        Buffer.from(digestPasswd, "utf8"),
        Buffer.from(this.cnonce!, "utf8"),
        Buffer.from(nonce, "utf8"),
      ]).toString("utf8");

      response = await this.fetch(`https://${this.config.ipAddress}`, {
        method: "POST",
        body: JSON.stringify({
          method: "login",
          params: {
            cnonce: this.cnonce,
            encrypt_type: "3",
            digest_passwd: digestPasswdFull,
            username: this.getUsername(),
          },
        }),
      });

      responseData = (await response.json()) as TAPOCameraRefreshStokResponse;

      this.log.debug(
        "StokRefresh: Start_seq response :>>",
        response.status,
        JSON.stringify(responseData)
      );

      if (responseData?.result?.start_seq) {
        if (responseData?.result?.user_group !== "root") {
          // # encrypted control via 3rd party account does not seem to be supported
          // # see https://github.com/JurajNyiri/HomeAssistant-Tapo-Control/issues/456
          throw new Error("Incorrect user_group detected");
        }

        this.lsk = this.generateEncryptionToken("lsk", nonce);
        this.ivb = this.generateEncryptionToken("ivb", nonce);
        this.seq = responseData.result.start_seq;
      }
    }

    if (
      responseData?.result?.data?.sec_left &&
      responseData.result.data.sec_left > 0
    ) {
      throw new Error(
        `StokRefresh: Temporary Suspension: Try again in ${responseData.result.data.sec_left} seconds`
      );
    }

    if (
      responseData?.data?.code == -40404 &&
      responseData?.data?.sec_left &&
      responseData.data.sec_left > 0
    ) {
      throw new Error(
        `StokRefresh: Temporary Suspension: Try again in ${responseData.data.sec_left} seconds`
      );
    }

    if (responseData?.result?.stok) {
      this.stok = responseData.result.stok;
      this.log.debug("StokRefresh: Success :>>", this.stok);
      return this.stok!;
    }

    if (
      responseData?.error_code === -40413 &&
      loginRetryCount < MAX_LOGIN_RETRIES
    ) {
      this.log.debug(
        `Unexpected response, retrying: ${loginRetryCount}/${MAX_LOGIN_RETRIES}.`,
        response.status,
        JSON.stringify(responseData)
      );
      return this.refreshStok(loginRetryCount + 1);
    }

    throw new Error("Invalid authentication data");
  }

  async isSecureConnection() {
    if (this.isSecureConnectionValue === null) {
      const response = await this.fetch(`https://${this.config.ipAddress}`, {
        method: "post",
        body: JSON.stringify({
          method: "login",
          params: {
            encrypt_type: "3",
            username: this.getUsername(),
          },
        }),
      });
      const responseData = (await response.json()) as TAPOCameraLoginResponse;

      this.log.debug(
        "isSecureConnection response :>> ",
        response.status,
        responseData
      );

      this.isSecureConnectionValue =
        responseData?.error_code == -40413 &&
        (responseData.result?.data?.encrypt_type || "")?.includes("3");
    }

    return this.isSecureConnectionValue;
  }

  getStok(loginRetryCount = 0): Promise<string> {
    if (this.stok) {
      return new Promise((resolve) => resolve(this.stok!));
    }

    if (!this.stokPromise) {
      this.stokPromise = () => this.refreshStok(loginRetryCount);
    }

    return this.stokPromise()
      .then(() => {
        return this.stok!;
      })
      .finally(() => {
        this.stokPromise = undefined;
      });
  }

  private async getAuthenticatedAPIURL(loginRetryCount = 0) {
    const token = await this.getStok(loginRetryCount);
    return `https://${this.config.ipAddress}/stok=${token}/ds`;
  }

  encryptRequest(request: string) {
    const cipher = crypto.createCipheriv("aes-128-cbc", this.lsk!, this.ivb!);
    let ct_bytes = cipher.update(
      this.encryptPad(request, AES_BLOCK_SIZE),
      "utf-8",
      "hex"
    );
    ct_bytes += cipher.final("hex");
    return Buffer.from(ct_bytes, "hex");
  }

  private encryptPad(text: string, blocksize: number) {
    const padSize = blocksize - (text.length % blocksize);
    const padding = String.fromCharCode(padSize).repeat(padSize);
    return text + padding;
  }

  private decryptResponse(response: string): string {
    const decipher = crypto.createDecipheriv(
      "aes-128-cbc",
      this.lsk!,
      this.ivb!
    );
    let decrypted = decipher.update(response, "base64", "utf-8");
    decrypted += decipher.final("utf-8");
    return this.encryptUnpad(decrypted, AES_BLOCK_SIZE);
  }

  private encryptUnpad(text: string, blockSize: number): string {
    const paddingLength = Number(text[text.length - 1]) || 0;
    if (paddingLength > blockSize || paddingLength > text.length) {
      throw new Error("Invalid padding");
    }
    for (let i = text.length - paddingLength; i < text.length; i++) {
      if (text.charCodeAt(i) !== paddingLength) {
        throw new Error("Invalid padding");
      }
    }
    return text.slice(0, text.length - paddingLength).toString();
  }

  private getTapoTag(request: TAPOCameraEncryptedRequest) {
    const tag = crypto
      .createHash("sha256")
      .update(this.getHashedPassword() + this.cnonce)
      .digest("hex")
      .toUpperCase();
    return crypto
      .createHash("sha256")
      .update(tag + JSON.stringify(request) + this.seq!.toString())
      .digest("hex")
      .toUpperCase();
  }

  private pendingAPIRequests: Map<string, Promise<TAPOCameraResponse>> =
    new Map();

  private async apiRequest(
    req: TAPOCameraRequest,
    loginRetryCount = 0
  ): Promise<TAPOCameraResponse> {
    const reqJson = JSON.stringify(req);

    if (this.pendingAPIRequests.has(reqJson)) {
      return this.pendingAPIRequests.get(
        reqJson
      ) as Promise<TAPOCameraResponse>;
    }

    this.log.debug("API new request", reqJson);

    this.pendingAPIRequests.set(
      reqJson,
      (async () => {
        try {
          const isSecureConnection = await this.isSecureConnection();
          const url = await this.getAuthenticatedAPIURL(loginRetryCount);

          const fetchParams: RequestInit = {
            method: "post",
          };

          if (this.seq && isSecureConnection) {
            const encryptedRequest: TAPOCameraEncryptedRequest = {
              method: "securePassthrough",
              params: {
                request: Buffer.from(
                  this.encryptRequest(JSON.stringify(req))
                ).toString("base64"),
              },
            };
            fetchParams.headers = {
              ...this.getHeaders(),
              Tapo_tag: this.getTapoTag(encryptedRequest),
              Seq: this.seq.toString(),
            };
            fetchParams.body = JSON.stringify(encryptedRequest);
            this.seq += 1;
          } else {
            fetchParams.body = JSON.stringify(req);
          }

          const response = await this.fetch(url, fetchParams);
          const responseDataTmp = await response.json();
          let responseData: TAPOCameraResponse | null = null;

          if (isSecureConnection) {
            const encryptedResponse =
              responseDataTmp as TAPOCameraEncryptedResponse;
            if (encryptedResponse.result?.response) {
              const decryptedResponse = this.decryptResponse(
                encryptedResponse.result.response
              );
              responseData = JSON.parse(
                decryptedResponse
              ) as TAPOCameraResponse;
            }
          } else {
            responseData = responseDataTmp as TAPOCameraResponse;
          }

          this.log.debug(
            `API response`,
            response.status,
            JSON.stringify(responseData)
          );

          // Apparently the Tapo C200 returns 500 on successful requests,
          // but it's indicating an expiring token, therefore refresh the token next time
          if (isSecureConnection && response.status === 500) {
            this.stok = undefined;
          }

          if (responseData === null) {
            throw new Error("Invalid response data");
          }

          // Check if we have to refresh the token
          if (
            responseData.error_code === -40401 ||
            responseData.error_code === -1
          ) {
            this.log.debug("API request failed, reauthenticating");
            this.stok = undefined;
            return this.apiRequest(req, loginRetryCount + 1);
          }

          return responseData;
        } finally {
          this.pendingAPIRequests.delete(reqJson);
        }
      })()
    );

    return this.pendingAPIRequests.get(reqJson) as Promise<TAPOCameraResponse>;
  }

  static SERVICE_MAP: Record<
    keyof Status,
    (value: boolean) => TAPOCameraSingleRequest
  > = {
    eyes: (value) => ({
      method: "setLensMaskConfig",
      params: {
        lens_mask: {
          lens_mask_info: {
            // Watch out for the inversion
            enabled: value ? "off" : "on",
          },
        },
      },
    }),
    alarm: (value) => ({
      method: "setAlertConfig",
      params: {
        msg_alarm: {
          chn1_msg_alarm_info: {
            enabled: value ? "on" : "off",
          },
        },
      },
    }),
    notifications: (value) => ({
      method: "setMsgPushConfig",
      params: {
        msg_push: {
          chn1_msg_push_info: {
            notification_enabled: value ? "on" : "off",
            rich_notification_enabled: value ? "on" : "off",
          },
        },
      },
    }),
    motionDetection: (value) => ({
      method: "setDetectionConfig",
      params: {
        motion_detection: {
          motion_det: {
            enabled: value ? "on" : "off",
          },
        },
      },
    }),
  };

  async setStatus(service: keyof Status, value: boolean) {
    const responseData = await this.apiRequest({
      method: "multipleRequest",
      params: {
        requests: [TAPOCamera.SERVICE_MAP[service](value)],
      },
    });

    if (responseData.error_code !== 0) {
      throw new Error(`Failed to perform ${service} action`);
    }

    const method = TAPOCamera.SERVICE_MAP[service](value).method;
    const operation = responseData.result.responses.find(
      (e) => e.method === method
    );
    if (operation?.error_code !== 0) {
      throw new Error(`Failed to perform ${service} action`);
    }

    return operation.result;
  }

  async getBasicInfo() {
    const responseData = await this.apiRequest({
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

    const info = responseData.result
      .responses[0] as TAPOCameraResponseDeviceInfo;
    return info.result.device_info.basic_info;
  }

  async getStatus(): Promise<Status> {
    const responseData = await this.apiRequest({
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
          {
            method: "getMsgPushConfig",
            params: {
              msg_push: {
                name: "chn1_msg_push_info",
              },
            },
          },
          {
            method: "getDetectionConfig",
            params: {
              motion_detection: {
                name: "motion_det",
              },
            },
          },
        ],
      },
    });

    const operations = responseData.result.responses;

    const alertConfig = operations.find((r) => r.method === "getAlertConfig");
    const lensMaskConfig = operations.find(
      (r) => r.method === "getLensMaskConfig"
    );
    const notificationsConfig = operations.find(
      (r) => r.method === "getMsgPushConfig"
    );
    const motionDetectionConfig = operations.find(
      (r) => r.method === "getDetectionConfig"
    );

    if (!alertConfig) this.log.warn("No alert config found");
    if (!lensMaskConfig) this.log.warn("No lens mask config found");
    if (!notificationsConfig) this.log.warn("No notifications config found");
    if (!motionDetectionConfig)
      this.log.warn("No motion detection config found");

    return {
      alarm: alertConfig?.result.msg_alarm.chn1_msg_alarm_info.enabled === "on",
      // Watch out for the inversion
      eyes: lensMaskConfig?.result.lens_mask.lens_mask_info.enabled === "off",
      notifications:
        notificationsConfig?.result.msg_push.chn1_msg_push_info
          .notification_enabled === "on",
      motionDetection:
        motionDetectionConfig?.result.motion_detection.motion_det.enabled ===
        "on",
    };
  }
}
