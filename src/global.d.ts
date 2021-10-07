declare type TAPOCameraRequest = {
  method: "multipleRequest";
  params: {
    requests: Array<
      | {
          method: "getDeviceInfo";
          params: {
            device_info: {
              name: ["basic_info"];
            };
          };
        }
      | {
          method: "getDayNightModeConfig";
          params: {
            image: {
              name: "common";
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
          method: "getAudioConfig";
          params: {
            audio_config: {
              name: ["speaker", "microphone", "record_audio"];
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
    >;
  };
};

declare type TAPOCameraResponseGetAlert = {
  method: "getAlertConfig";
  result: {
    msg_alarm: {
      chn1_msg_alarm_info: {
        ".name": "chn1_msg_alarm_info";
        ".type": "info";
        light_type: "1";
        alarm_type: "1";
        alarm_mode: ["sound", "light"];
        enabled: "on";
      };
    };
  };
  error_code: number;
};

declare type TAPOCameraResponseGetLensMask = {
  method: "getLensMaskConfig";
  result: {
    lens_mask: {
      lens_mask_info: {
        ".name": "lens_mask_info";
        ".type": "lens_mask_info";
        enabled: "on";
      };
    };
  };
  error_code: number;
};

declare type TAPOCameraResponseSet = {
  method: "setLensMaskConfig" | "setAlertConfig";
  result: {};
  error_code: number;
};

declare type TAPOCameraResponseDeviceInfo = {
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

declare type TAPOCameraResponse = {
  result: {
    responses: Array<
      | TAPOCameraResponseGetAlert
      | TAPOCameraResponseGetLensMask
      | TAPOCameraResponseSet
      | TAPOCameraResponseDeviceInfo
    >;
  };
  error_code: number;
};
