export type TAPOCameraGetRequest =
  | {
      method: "getDeviceInfo";
      params: {
        device_info: {
          name: ["basic_info"];
        };
      };
    }
  | {
      method: "getLensMaskConfig";
      params: {
        lens_mask: {
          name: "lens_mask_info";
        };
      };
    }
  | {
      method: "getAlertConfig";
      params: {
        msg_alarm: {
          name: "chn1_msg_alarm_info";
        };
      };
    }
  | {
      method: "getMsgPushConfig";
      params: {
        msg_push: {
          name: "chn1_msg_push_info";
        };
      };
    }
  | {
      method: "getDetectionConfig";
      params: {
        motion_detection: {
          name: "motion_det";
        };
      };
    }
  | {
      method: "getLedStatus";
      params: {
        led_status: {
          config: {
            enabled: "on" | "off";
          };
        };
      };
    };

export type TAPOCameraSetRequest =
  | {
      method: "setLensMaskConfig";
      params: {
        lens_mask: {
          lens_mask_info: {
            enabled: "off" | "on";
          };
        };
      };
    }
  | {
      method: "setAlertConfig";
      params: {
        msg_alarm: {
          chn1_msg_alarm_info: {
            alarm_type?: "0" | "1";
            alarm_mode?: ["sound" | "light"];
            enabled: "on" | "off";
            light_type?: "0" | "1";
          };
        };
      };
    }
  | {
      method: "setMsgPushConfig";
      params: {
        msg_push: {
          chn1_msg_push_info: {
            notification_enabled: "on" | "off";
            rich_notification_enabled: "on" | "off";
          };
        };
      };
    }
  | {
      method: "setDetectionConfig";
      params: {
        motion_detection: {
          motion_det: {
            enabled: "on" | "off";
          };
        };
      };
    }
  | {
      method: "setLedStatus";
      params: {
        led: {
          config: {
            enabled: "on" | "off";
          };
        };
      };
    };

export type TAPOCameraUnencryptedRequest = {
  method: "multipleRequest";
  params: {
    requests: (TAPOCameraGetRequest | TAPOCameraSetRequest)[];
  };
};

export type TAPOCameraEncryptedRequest = {
  method: "securePassthrough";
  params: {
    request: string;
  };
};

export type TAPOCameraRequest =
  | TAPOCameraUnencryptedRequest
  | TAPOCameraEncryptedRequest;

export type TAPOCameraEncryptedResponse = {
  result?: {
    response: string;
  };
};

export type TAPOCameraResponseGetAlert = {
  method: "getAlertConfig";
  result: {
    msg_alarm: {
      chn1_msg_alarm_info: {
        light_type: "1";
        alarm_type: "1";
        alarm_mode: ["sound", "light"];
        enabled: "on" | "off";
      };
    };
  };
  error_code: number;
};

export type TAPOCameraResponseGetLensMask = {
  method: "getLensMaskConfig";
  result: {
    lens_mask: {
      lens_mask_info: {
        enabled: "on" | "off";
      };
    };
  };
  error_code: number;
};

export type TAPOCameraResponseGetNotifications = {
  method: "getMsgPushConfig";
  result: {
    msg_push: {
      chn1_msg_push_info: {
        notification_enabled: "on" | "off";
        rich_notification_enabled: "on" | "off";
      };
    };
  };
  error_code: number;
};

export type TAPOCameraResponseGetMotionDetection = {
  method: "getDetectionConfig";
  result: {
    motion_detection: {
      motion_det: {
        enabled: "on" | "off";
      };
    };
  };
  error_code: number;
};

export type TAPOCameraResponseGetLed = {
  method: "getLedStatus";
  result: {
    led_status: {
      config: {
        enabled: "on" | "off";
      };
    };
  };
  error_code: number;
};

export type TAPOCameraResponseSet = {
  method:
    | "setLensMaskConfig"
    | "setAlertConfig"
    | "setMsgPushConfig"
    | "setDetectionConfig"
    | "setLedStatus";
  result: object;
  error_code: number;
};

export type TAPOCameraResponseGet =
  | TAPOCameraResponseGetAlert
  | TAPOCameraResponseGetLensMask
  | TAPOCameraResponseGetNotifications
  | TAPOCameraResponseGetMotionDetection
  | TAPOCameraResponseGetLed;

export type TAPOCameraResponseDeviceInfo = {
  method: "getDeviceInfo";
  result: {
    device_info: {
      basic_info: {
        device_type: string;
        device_model: string;
        device_name: string;
        device_info: string;
        hw_version: string;
        sw_version: string;
        device_alias: string;
        features: string;
        barcode: string;
        mac: string;
        dev_id: string;
        oem_id: string;
        hw_desc: string;
      };
    };
  };
  error_code: number;
};

export type TAPOCameraLoginResponse = {
  error_code?: number;
  result?: {
    data?: {
      encrypt_type?: string;
    };
  };
};

export type TAPOCameraRefreshStokResponse = {
  error_code?: number;
  data?: {
    code?: number;
    sec_left?: number;
  };
  result?: {
    start_seq?: number;
    user_group?: string;
    stok?: string;
    data?: {
      code?: number;
      nonce?: string;
      device_confirm?: string;
      sec_left?: number;
    };
  };
};

export type TAPOCameraResponse = {
  result: {
    error_code: number;
    responses: Array<
      | TAPOCameraResponseGet
      | TAPOCameraResponseSet
      | TAPOCameraResponseDeviceInfo
    >;
  };
  error_code: number;
};
