export type TAPOCameraRequestGetDeviceInfo = {
  method: "getDeviceInfo";
  params: {
    device_info: {
      name: ["basic_info"];
    };
  };
};

export type TAPOCameraRequestGetDayNightModeConfig = {
  method: "getDayNightModeConfig";
  params: {
    image: {
      name: "common";
    };
  };
};

export type TAPOCameraRequestGetAlertConfig = {
  method: "getAlertConfig";
  params: {
    msg_alarm: {
      name: "chn1_msg_alarm_info";
    };
  };
};

export type TAPOCameraRequestGetAudioConfig = {
  method: "getAudioConfig";
  params: {
    audio_config: {
      name: ["speaker", "microphone", "record_audio"];
    };
  };
};

export type TAPOCameraRequestGetLensMaskConfig = {
  method: "getLensMaskConfig";
  params: {
    lens_mask: {
      name: "lens_mask_info";
    };
  };
};

export type TAPOCameraRequestSetLensMaskConfig = {
  method: "setLensMaskConfig";
  params: {
    lens_mask: {
      lens_mask_info: {
        enabled: "off" | "on";
      };
    };
  };
};

export type TAPOCameraRequestSetAlertConfig = {
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
};

export type TAPOCameraRequestMovestep = {
  method: "do";
  motor: { movestep: { direction: string } };
};

export type TAPOCameraRequestMove = {
  method: "do";
  motor: { move: { x_coord: string; y_coord: string } };
};

export type TAPOCameraRequestMultiple =
  | TAPOCameraRequestGetDeviceInfo
  | TAPOCameraRequestGetDayNightModeConfig
  | TAPOCameraRequestGetAlertConfig
  | TAPOCameraRequestGetAudioConfig
  | TAPOCameraRequestGetLensMaskConfig
  | TAPOCameraRequestSetLensMaskConfig
  | TAPOCameraRequestSetAlertConfig;

export type TAPOCameraRequestSingle =
  | TAPOCameraRequestMovestep
  | TAPOCameraRequestMove;

export type TAPOCameraUnencryptedRequest =
  | TAPOCameraRequestSingle
  | {
      method: "multipleRequest";
      params: {
        requests: Array<TAPOCameraRequestMultiple>;
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
  result: {
    response: string;
  };
};

export type TAPOCameraResponseGetAlert = {
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

export type TAPOCameraResponseGetLensMask = {
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

export type TAPOCameraResponseSet = {
  method: "setLensMaskConfig" | "setAlertConfig";
  result: object;
  error_code: number;
};

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

export type TAPOCameraResponse = {
  result: {
    error_code: number;
    responses: Array<
      | TAPOCameraResponseGetAlert
      | TAPOCameraResponseGetLensMask
      | TAPOCameraResponseSet
      | TAPOCameraResponseDeviceInfo
    >;
  };
  error_code: number;
};
