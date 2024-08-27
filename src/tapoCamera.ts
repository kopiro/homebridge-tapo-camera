import { Logging } from "homebridge";
import { CameraConfig } from "./cameraAccessory";
import crypto from "crypto";
import { OnvifCamera } from "./onvifCamera";
import type {
  TAPOBasicInfo,
  TAPOCameraEncryptedRequest,
  TAPOCameraEncryptedResponse,
  TAPOCameraLoginResponse,
  TAPOCameraRefreshStokResponse,
  TAPOCameraRequest,
  TAPOCameraResponse,
  TAPOCameraResponseDeviceInfo,
  TAPOCameraSetRequest,
} from "./types/tapo";
import { Agent } from "undici";

const MAX_LOGIN_RETRIES = 2;
const AES_BLOCK_SIZE = 16;
const ERROR_CODES_MAP = {
  "-40401": "Invalid stok value",
  "-40210": "Function not supported",
  "-64303": "Action cannot be done while camera is in patrol mode.",
  "-64324": "Privacy mode is ON, not able to execute",
  "-64302": "Preset ID not found",
  "-64321": "Preset ID was deleted so no longer exists",
  "-40106": "Parameter to get/do does not exist",
  "-40105": "Method does not exist",
  "-40101": "Parameter to set does not exist",
  "-40209": "Invalid login credentials",
  "-64304": "Maximum Pan/Tilt range reached",
  "-71103": "User ID is not authorized",
};

export type Status = {
  eyes: boolean | undefined;
  alarm: boolean | undefined;
  notifications: boolean | undefined;
  motionDetection: boolean | undefined;
  led: boolean | undefined;
};

export class TAPOCamera extends OnvifCamera {
  private readonly kStreamPort = 554;
  private readonly fetchAgent: Agent;

  private readonly hashedMD5Password: string;
  private readonly hashedSha256Password: string;
  private passwordEncryptionMethod: "md5" | "sha256" | null = null;

  private isSecureConnectionValue: boolean | null = null;

  private stokPromise: (() => Promise<void>) | undefined;

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

    this.fetchAgent = new Agent({
      connectTimeout: 5_000,
      connect: {
        // TAPO devices have self-signed certificates
        rejectUnauthorized: false,
        ciphers: "AES256-SHA:AES128-GCM-SHA256",
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
      dispatcher: this.fetchAgent,
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
    this.passwordEncryptionMethod = null;

    const hashedNoncesWithSHA256 = crypto
      .createHash("sha256")
      .update(this.cnonce + this.hashedSha256Password + nonce)
      .digest("hex")
      .toUpperCase();
    if (deviceConfirm === hashedNoncesWithSHA256 + nonce + this.cnonce) {
      this.passwordEncryptionMethod = "sha256";
      return true;
    }

    const hashedNoncesWithMD5 = crypto
      .createHash("md5")
      .update(this.cnonce + this.hashedMD5Password + nonce)
      .digest("hex")
      .toUpperCase();
    if (deviceConfirm === hashedNoncesWithMD5 + nonce + this.cnonce) {
      this.passwordEncryptionMethod = "md5";
      return true;
    }

    this.log.debug(
      'Invalid device confirm, expected "sha256" or "md5" to match, but none found',
      {
        hashedNoncesWithMD5,
        hashedNoncesWithSHA256,
        deviceConfirm,
        nonce,
        cnonce: this,
      }
    );

    return this.passwordEncryptionMethod !== null;
  }

  async refreshStok(loginRetryCount = 0): Promise<void> {
    this.log.debug("refreshStok: Refreshing stok...");

    const isSecureConnection = await this.isSecureConnection();

    let fetchParams = {};
    if (isSecureConnection) {
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

    const responseLogin = await this.fetch(
      `https://${this.config.ipAddress}`,
      fetchParams
    );
    const responseLoginData =
      (await responseLogin.json()) as TAPOCameraRefreshStokResponse;

    let response, responseData;

    if (!responseLoginData) {
      this.log.debug(
        "refreshStok: empty response login data, raising exception",
        responseLogin.status
      );
      throw new Error("Empty response login data");
    }

    this.log.debug(
      "refreshStok: Login response",
      responseLogin.status,
      responseLoginData
    );

    if (
      responseLogin.status === 401 &&
      responseLoginData.result?.data?.code === -40411
    ) {
      this.log.debug(
        "refreshStok: invalid credentials, raising exception",
        responseLogin.status
      );
      throw new Error("Invalid credentials");
    }

    if (isSecureConnection) {
      const nonce = responseLoginData.result?.data?.nonce;
      const deviceConfirm = responseLoginData.result?.data?.device_confirm;
      if (
        nonce &&
        deviceConfirm &&
        this.validateDeviceConfirm(nonce, deviceConfirm)
      ) {
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

        this.log.debug("refreshStok: sending start_seq request");

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

        if (!responseData) {
          this.log.debug(
            "refreshStock: empty response start_seq data, raising exception",
            response.status
          );
          throw new Error("Empty response start_seq data");
        }

        this.log.debug(
          "refreshStok: start_seq response",
          response.status,
          JSON.stringify(responseData)
        );

        if (responseData.result?.start_seq) {
          if (responseData.result?.user_group !== "root") {
            this.log.debug("refreshStock: Incorrect user_group detected");

            // # encrypted control via 3rd party account does not seem to be supported
            // # see https://github.com/JurajNyiri/HomeAssistant-Tapo-Control/issues/456
            throw new Error("Incorrect user_group detected");
          }

          this.lsk = this.generateEncryptionToken("lsk", nonce);
          this.ivb = this.generateEncryptionToken("ivb", nonce);
          this.seq = responseData.result.start_seq;
        }
      } else {
        if (
          responseLoginData.error_code === -40413 &&
          loginRetryCount < MAX_LOGIN_RETRIES
        ) {
          this.log.debug(
            `refreshStock: Invalid device confirm, retrying: ${loginRetryCount}/${MAX_LOGIN_RETRIES}.`,
            responseLogin.status,
            responseLoginData
          );
          return this.refreshStok(loginRetryCount + 1);
        }

        this.log.debug(
          "refreshStock: Invalid device confirm and loginRetryCount exhausted, raising exception",
          loginRetryCount,
          responseLoginData
        );
        throw new Error("Invalid device confirm");
      }
    } else {
      this.passwordEncryptionMethod = "md5";
      response = responseLogin;
      responseData = responseLoginData;
    }

    if (
      responseData.result?.data?.sec_left &&
      responseData.result.data.sec_left > 0
    ) {
      this.log.debug("refreshStok: temporary suspension", responseData);

      throw new Error(
        `Temporary Suspension: Try again in ${responseData.result.data.sec_left} seconds`
      );
    }

    if (
      responseData?.data?.code === -40404 &&
      responseData?.data?.sec_left &&
      responseData.data.sec_left > 0
    ) {
      this.log.debug("refreshStok: temporary suspension", responseData);

      throw new Error(
        `refreshStok: Temporary Suspension: Try again in ${responseData.data.sec_left} seconds`
      );
    }

    if (responseData?.result?.stok) {
      this.stok = responseData.result.stok;
      this.log.debug("refreshStok: Success in obtaining STOK", this.stok);
      return;
    }

    if (
      responseData?.error_code === -40413 &&
      loginRetryCount < MAX_LOGIN_RETRIES
    ) {
      this.log.debug(
        `refreshStock: Unexpected response, retrying: ${loginRetryCount}/${MAX_LOGIN_RETRIES}.`,
        response.status,
        responseData
      );
      return this.refreshStok(loginRetryCount + 1);
    }

    this.log.debug("refreshStock: Unexpected end of flow, raising exception");
    throw new Error("Invalid authentication data");
  }

  async isSecureConnection() {
    if (this.isSecureConnectionValue === null) {
      this.log.debug("isSecureConnection: Checking secure connection...");

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
        "isSecureConnection response",
        response.status,
        JSON.stringify(responseData)
      );

      this.isSecureConnectionValue =
        responseData?.error_code == -40413 &&
        String(responseData.result?.data?.encrypt_type || "")?.includes("3");
    }

    return this.isSecureConnectionValue;
  }

  getStok(loginRetryCount = 0): Promise<string> {
    return new Promise((resolve) => {
      if (this.stok) {
        return resolve(this.stok);
      }

      if (!this.stokPromise) {
        this.stokPromise = () => this.refreshStok(loginRetryCount);
      }

      this.stokPromise()
        .then(() => {
          if (!this.stok) {
            throw new Error("STOK not found");
          }
          resolve(this.stok!);
        })
        .finally(() => {
          this.stokPromise = undefined;
        });
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
      this.log.debug("API request already pending", reqJson);
      return this.pendingAPIRequests.get(
        reqJson
      ) as Promise<TAPOCameraResponse>;
    } else {
      this.log.debug("New API request", reqJson);
    }

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

          // Apparently the Tapo C200 returns 500 on successful requests,
          // but it's indicating an expiring token, therefore refresh the token next time
          if (isSecureConnection && response.status === 500) {
            this.log.debug(
              "Stok expired, reauthenticating on next request, setting STOK to undefined"
            );
            this.stok = undefined;
          }

          let responseData: TAPOCameraResponse | null = null;

          if (isSecureConnection) {
            const encryptedResponse =
              responseDataTmp as TAPOCameraEncryptedResponse;
            if (encryptedResponse?.result?.response) {
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
            "API response",
            response.status,
            JSON.stringify(responseData)
          );

          // Log error codes
          if (responseData && responseData.error_code !== 0) {
            const errorCode = String(responseData.error_code);
            const errorMessage =
              errorCode in ERROR_CODES_MAP
                ? ERROR_CODES_MAP[errorCode as keyof typeof ERROR_CODES_MAP]
                : "Unknown error";
            this.log.debug(
              `API request failed with specific error code ${errorCode}: ${errorMessage}`
            );
          }

          if (
            !responseData ||
            responseData.error_code === -40401 ||
            responseData.error_code === -1
          ) {
            this.log.debug(
              "API request failed, reauth now and trying same request again",
              responseData
            );
            this.stok = undefined;
            return this.apiRequest(req, loginRetryCount + 1);
          }

          // Success
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
    (value: boolean) => TAPOCameraSetRequest
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
    led: (value) => ({
      method: "setLedStatus",
      params: {
        led: {
          config: {
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

  async getBasicInfo(): Promise<TAPOBasicInfo> {
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
          {
            method: "getLedStatus",
            params: {
              led: {
                name: "config",
              },
            },
          },
        ],
      },
    });

    const operations = responseData.result.responses;

    const alert = operations.find((r) => r.method === "getAlertConfig");
    const lensMask = operations.find((r) => r.method === "getLensMaskConfig");
    const notifications = operations.find(
      (r) => r.method === "getMsgPushConfig"
    );
    const motionDetection = operations.find(
      (r) => r.method === "getDetectionConfig"
    );
    const led = operations.find((r) => r.method === "getLedStatus");

    if (!alert) this.log.debug("No alert config found");
    if (!lensMask) this.log.debug("No lens mask config found");
    if (!notifications) this.log.debug("No notifications config found");
    if (!motionDetection) this.log.debug("No motion detection config found");
    if (!led) this.log.debug("No led config found");

    return {
      alarm: alert
        ? alert.result.msg_alarm.chn1_msg_alarm_info.enabled === "on"
        : undefined,
      // Watch out for the inversion
      eyes: lensMask
        ? lensMask.result.lens_mask.lens_mask_info.enabled === "off"
        : undefined,
      notifications: notifications
        ? notifications.result.msg_push.chn1_msg_push_info
            .notification_enabled === "on"
        : undefined,
      motionDetection: motionDetection
        ? motionDetection.result.motion_detection.motion_det.enabled === "on"
        : undefined,
      led: led ? led.result.led.config.enabled === "on" : undefined,
    };
  }
}
