import { EventEmitter } from "events";

export type VideoSource = {
  framerate: number;
  resolution: {
    width: number;
    height: number;
  };
};

export interface Bounds {
  $: {
    height: number;
    width: number;
    y: number;
    x: number;
  };
}

export interface VideoSourceConfiguration {
  $: {
    token: string;
  };
  name: string;
  useCount: number;
  sourceToken: string;
  bounds: Bounds;
}

export interface AudioSourceConfiguration {
  $: {
    token: string;
  };
  name: string;
  useCount: number;
  sourceToken: string;
}
export interface Resolution {
  width: number;
  height: number;
}

export interface RateControl {
  frameRateLimit: number;
  encodingInterval: number;
  bitrateLimit: number;
}

export interface H264 {
  govLength: number;
  H264Profile: string;
}

export interface Address {
  type: string;
  IPv4Address: string;
}

export interface Multicast {
  address: Address;
  port: number;
  TTL: number;
  autoStart: boolean;
}

export interface VideoEncoderConfiguration {
  $: {
    token: string;
  };
  name: string;
  useCount: number;
  encoding: string;
  resolution: Resolution;
  quality: number;
  rateControl: RateControl;
  H264: H264;
  multicast: Multicast;
  sessionTimeout: string;
}

export interface Address2 {
  type: string;
  IPv4Address: string;
}

export interface Multicast2 {
  address: Address2;
  port: number;
  TTL: number;
  autoStart: boolean;
}

export interface AudioEncoderConfiguration {
  $: {
    token: string;
  };
  name: string;
  useCount: number;
  encoding: string;
  bitrate: number;
  sampleRate: number;
  multicast: Multicast2;
  sessionTimeout: string;
}

export interface SimpleItem {
  $: {
    Value: string | boolean;
    Name: string;
  };
}

export interface Translate {
  $: {
    y: number;
    x: number;
  };
}

export interface Scale {
  $: {
    y: number;
    x: number;
  };
}

export interface Transformation {
  translate: Translate;
  scale: Scale;
}

export interface CellLayout {
  $: {
    Rows: number;
    Columns: number;
  };
  transformation: Transformation;
}

export interface ElementItem {
  $: {
    Name: string;
  };
  cellLayout: CellLayout;
}

export interface Parameters {
  simpleItem: SimpleItem[];
  elementItem: ElementItem;
}

export interface AnalyticsModule {
  parameters: Parameters;
}

export interface AnalyticsEngineConfiguration {
  analyticsModule: AnalyticsModule[];
}

export interface Rule {
  $: {
    Name: string;
    Type: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: any;
}

export interface RuleEngineConfiguration {
  rule: Rule[];
}

export interface VideoAnalyticsConfiguration {
  $: {
    token: string;
  };
  name: string;
  useCount: number;
  analyticsEngineConfiguration: AnalyticsEngineConfiguration;
  ruleEngineConfiguration: RuleEngineConfiguration;
}

export interface PanTilt {
  $: {
    space: string;
    y: number;
    x: number;
  };
}

export interface DefaultPTZSpeed {
  panTilt: PanTilt;
}

export interface XRange {
  min: number;
  max: number;
}

export interface YRange {
  min: number;
  max: number;
}

export interface Range {
  URI: string;
  XRange: XRange;
  YRange: YRange;
}

export interface PanTiltLimits {
  range: Range;
}

export interface PTZConfiguration {
  $: {
    token: string;
  };
  name: string;
  useCount: number;
  nodeToken: string;
  defaultAbsolutePantTiltPositionSpace: string;
  defaultRelativePanTiltTranslationSpace: string;
  defaultContinuousPanTiltVelocitySpace: string;
  defaultPTZSpeed: DefaultPTZSpeed;
  defaultPTZTimeout: string;
  panTiltLimits: PanTiltLimits;
}

export interface Profile {
  $: {
    fixed: boolean;
    token: string;
  };
  name: string;
  videoSourceConfiguration: VideoSourceConfiguration;
  audioSourceConfiguration: AudioSourceConfiguration;
  videoEncoderConfiguration: VideoEncoderConfiguration;
  audioEncoderConfiguration: AudioEncoderConfiguration;
  videoAnalyticsConfiguration: VideoAnalyticsConfiguration;
  PTZConfiguration: PTZConfiguration;
}

export type DeviceInformation = {
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  serialNumber: string;
  hardwareId: string;
};

export type ConnectionCallback = (error?: Error) => void;

export interface NotificationMessage {
  topic: { _: string };
  message: {
    message: {
      $: object;
      source: object;
      data: {
        simpleItem: SimpleItem;
      };
    };
  };
}

export interface CamOptions {
  hostname: string;
  username?: string;
  password?: string;
  port?: number;
  path?: string;
  timeout?: number;
  preserveAddress?: boolean;
}

export interface Cam extends EventEmitter {
  connect(callback: ConnectionCallback): void;
  on(event: "event", listener: (message: NotificationMessage) => void): this;
  getDeviceInformation(
    callback: (error: Error, deviceInformation: DeviceInformation) => void
  ): void;
  getProfiles(callback: (error: Error, profiles: Profile[]) => void): void;

  videoSources: VideoSource[];
}
