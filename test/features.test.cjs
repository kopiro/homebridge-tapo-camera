const assert = require('node:assert/strict');
const { test } = require('node:test');
const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const hap = require('hap-nodejs');
const { PlatformAccessory } = require('homebridge/lib/platformAccessory');

const { buildAudioFilter, BASE_AUDIO_FILTER } = require('../dist/audioFilters');
const { PresenceSensor } = require('../dist/presenceSensor');
const { DoorbellListener } = require('../dist/doorbellListener');
const { DetectionPoller, classifyAlarmType } = require('../dist/detectionPoller');
const { OnvifCamera } = require('../dist/onvifCamera');
const { TAPOCamera } = require('../dist/tapoCamera');
const { CameraAccessory } = require('../dist/cameraAccessory');

const quietLog = Object.assign(() => {}, {
  debug() {}, info() {}, warn() {}, error() {}, prefix: 'test',
});

// ---------------------------------------------------------------- sound

test('sound: no options keeps the old filter exactly', () => {
  assert.equal(BASE_AUDIO_FILTER, 'aresample=async=16000');
  assert.equal(buildAudioFilter(), 'aresample=async=16000');
  assert.equal(buildAudioFilter(100, 'off'), 'aresample=async=16000');
  assert.equal(buildAudioFilter('nonsense', 'nonsense'), 'aresample=async=16000');
});

test('sound: boost and noise reduction build a chain with no spaces', () => {
  const chain = buildAudioFilter(300, 'medium');
  assert.ok(!/\s/.test(chain), 'camera-ffmpeg splits on spaces');
  assert.ok(chain.startsWith('aresample=async=16000,'));
  assert.ok(chain.includes('afftdn=nr=24:nf=-40'));
  assert.ok(chain.includes('acompressor='));
  assert.ok(chain.includes('volume=3.00'));
  assert.ok(chain.endsWith('alimiter=limit=0.95:level=false'));
  // denoise before gain, limiter last
  assert.ok(chain.indexOf('afftdn') < chain.indexOf('volume='));
});

test('sound: volume is kept within safe limits', () => {
  assert.ok(buildAudioFilter(99999).includes('volume=10.00'));
  assert.ok(buildAudioFilter(1).includes('volume=0.10'));
  // Turning it down needs no compressor or limiter
  assert.equal(buildAudioFilter(50), 'aresample=async=16000,volume=0.50');
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('sound: ffmpeg accepts every generated chain on Tapo-style audio', { skip: !hasFfmpeg }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tapo-audio-'));
  const file = join(dir, 'alaw.wav');
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'sine=frequency=500:sample_rate=8000:duration=1', '-c:a', 'pcm_alaw', file]);
    for (const level of ['off', 'light', 'medium', 'strong']) {
      for (const volume of [100, 400, 1000]) {
        const chain = buildAudioFilter(volume, level);
        const out = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file,
          '-map', '0:a:0', '-af', `${chain},volumedetect`, '-ar', '16k', '-ac', '1',
          '-f', 'null', '-'], { encoding: 'utf8' });
        assert.equal(out.status, 0, `${level}/${volume}: ${out.stderr}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- presence sensor

function makeSensor(hold) {
  const accessory = new hap.Accessory('Test', hap.uuid.generate('presence-test'));
  const sensor = new PresenceSensor({ hap }, accessory, 'Person', 'presence-person', hold, 300);
  const value = () => sensor.service.getCharacteristic(hap.Characteristic.OccupancyDetected).value;
  return { sensor, value };
}

test('presence sensor: follows a live signal and holds before turning off', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sensor, value } = makeSensor(30);
  assert.equal(value(), 0);
  sensor.set(true);
  assert.equal(value(), 1);
  sensor.set(false);
  assert.equal(value(), 1, 'still on during hold time');
  t.mock.timers.tick(29_000);
  assert.equal(value(), 1);
  sensor.set(true); // comes back before the hold ends
  t.mock.timers.tick(5_000);
  assert.equal(value(), 1);
  sensor.set(false);
  t.mock.timers.tick(30_000);
  assert.equal(value(), 0);
});

test('presence sensor: pulse turns off by itself, and a stuck signal clears', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sensor, value } = makeSensor(10);
  sensor.pulse();
  assert.equal(value(), 1);
  t.mock.timers.tick(10_000);
  assert.equal(value(), 0);

  sensor.set(true); // never gets a "false"
  t.mock.timers.tick(299_000);
  assert.equal(value(), 1);
  t.mock.timers.tick(1_000);
  assert.equal(value(), 0);
});

// ---------------------------------------------------------------- doorbell

test('doorbell: a real UDP packet from the doorbell IP counts as one press', async () => {
  const listener = new DoorbellListener(quietLog, 0);
  let presses = 0;
  const unsubscribe = listener.subscribe('127.0.0.1', () => presses++);
  try {
    await new Promise((resolve) => listener.socket.once('listening', resolve));
    const port = listener.socket.address().port;
    const sender = dgram.createSocket('udp4');
    // Several packets for one press are debounced
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => sender.send(Buffer.from('ring'), port, '127.0.0.1', resolve));
    }
    sender.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(presses, 1);
  } finally {
    unsubscribe();
  }
  assert.equal(listener.socket, undefined, 'socket closes when nobody listens');
});

test('doorbell: other devices are ignored, IPv6-mapped addresses work', () => {
  const listener = new DoorbellListener(quietLog, 0);
  const presses = [];
  listener.handlers.set('192.168.1.50', new Set([() => presses.push('door')]));
  listener.handlePacket('192.168.1.99', 0);
  assert.equal(presses.length, 0);
  listener.handlePacket('::ffff:192.168.1.50', 10_000);
  listener.handlePacket('192.168.1.50', 11_000); // same press
  listener.handlePacket('192.168.1.50', 20_000); // new press
  assert.equal(presses.length, 2);
});

// ---------------------------------------------------------------- ONVIF person events

function onvifEvent(topic, items) {
  const simpleItem = items.map(([Name, Value]) => ({ $: { Name, Value } }));
  return {
    topic: { _: topic },
    message: { message: { data: { simpleItem: simpleItem.length === 1 ? simpleItem[0] : simpleItem } } },
  };
}

test('ONVIF: person events from Tapo topics, motion unchanged', async () => {
  const cam = new OnvifCamera(quietLog, {});
  const device = new EventEmitter();
  cam.device = device;
  cam.events = new EventEmitter();
  const seen = [];
  cam.events.on('motion', (v) => seen.push(['motion', v]));
  cam.events.on('person', (v) => seen.push(['person', v]));
  await cam.startOnvifListener();

  device.emit('event', onvifEvent('tns1:RuleEngine/CellMotionDetector/Motion', [['IsMotion', true]]));
  device.emit('event', onvifEvent('tns1:RuleEngine/PeopleDetector/People', [['IsPeople', true]]));
  device.emit('event', onvifEvent('tns1:RuleEngine/TPSmartEventDetector/TPSmartEvent', [['IsPeople', 'true']])); // repeat
  device.emit('event', onvifEvent('tns1:RuleEngine/TPSmartEventDetector/TPSmartEvent', [['Other', 1], ['IsPeople', false]]));
  device.emit('event', onvifEvent('tns1:RuleEngine/TPSmartEventDetector/TPSmartEvent', [['IsVehicle', true]]));
  device.emit('event', onvifEvent('tns1:RuleEngine/CellMotionDetector/Motion', [['IsMotion', false]]));

  assert.deepEqual(seen, [
    ['motion', true],
    ['person', true],
    ['person', false],
    ['motion', false],
  ]);
});

// ---------------------------------------------------------------- event history

test('event history: alarm types', () => {
  assert.equal(classifyAlarmType(6), 'person');
  assert.equal(classifyAlarmType(17), 'doorbell');
  assert.equal(classifyAlarmType(18), 'doorbell');
  assert.equal(classifyAlarmType(2), undefined);
});

test('event history: old events are ignored, new ones fire once', async () => {
  let nowMs = 1_000_000_000;
  let events = [{ start_time: 999_900 - 30, end_time: 0, alarm_type: 6 }];
  const camera = {
    async getClockOffsetSeconds() { return 100; }, // camera 100 s behind
    async getDetectionEvents(start, end) {
      assert.ok(start < end);
      return events;
    },
  };
  const fired = [];
  const poller = new DetectionPoller(camera, quietLog, 5, (k) => fired.push(k), () => nowMs);

  await poller.poll(); // primes, ignores the event that was already there
  assert.deepEqual(fired, []);

  nowMs += 5_000;
  events = [...events,
    { start_time: 999_905 - 2, end_time: 0, alarm_type: 17 },
    { start_time: 999_905 - 1, end_time: 0, alarm_type: 6 },
    { start_time: 999_905 - 1, end_time: 0, alarm_type: 2 }];
  await poller.poll();
  assert.deepEqual(fired, ['doorbell', 'person']);

  nowMs += 5_000;
  await poller.poll(); // nothing new
  assert.deepEqual(fired, ['doorbell', 'person']);
});

test('event history: errors are reported once, not every poll', async () => {
  const warnings = [];
  const log = { ...quietLog, warn: (...a) => warnings.push(a) };
  const camera = {
    async getClockOffsetSeconds() { return 0; },
    async getDetectionEvents() { throw new Error('no SD card'); },
  };
  const poller = new DetectionPoller(camera, log, 5, () => {});
  await poller.poll();
  await poller.poll();
  assert.equal(warnings.length, 1);
});

// ---------------------------------------------------------------- Tapo API parsing

function fakeCamera(response) {
  const camera = new TAPOCamera(quietLog, { ipAddress: '127.0.0.1', password: 'x' });
  camera.apiRequest = async () => ({ error_code: 0, result: { error_code: 0, responses: [response] } });
  return camera;
}

test('Tapo API: light status in every format', async () => {
  for (const [status, expected] of [['on', true], ['1', true], [1, true], ['off', false], [0, false]]) {
    const camera = fakeCamera({ method: 'getWhitelampStatus', error_code: 0,
      result: { image: { get_wtl_status: { status } } } });
    assert.equal(await camera.getLightOn(), expected, String(status));
  }
  const unsupported = fakeCamera({ method: 'getWhitelampStatus', error_code: -40210 });
  assert.equal(await unsupported.getLightOn(), undefined);
});

test('Tapo API: detection history and clock', async () => {
  const camera = fakeCamera({ method: 'searchDetectionList', error_code: 0,
    result: { playback: { search_detection_list: [
      { start_time: '100', end_time: '110', alarm_type: '6' },
      { start_time: 'bad', alarm_type: 6 },
    ] } } });
  assert.deepEqual(await camera.getDetectionEvents(0, 200), [{ start_time: 100, end_time: 110, alarm_type: 6 }]);

  const failing = fakeCamera({ method: 'searchDetectionList', error_code: -71114 });
  await assert.rejects(failing.getDetectionEvents(0, 200));

  const nowS = Math.round(Date.now() / 1000);
  const clock = fakeCamera({ method: 'getClockStatus', error_code: 0,
    result: { system: { clock_status: { seconds_from_1970: nowS - 7 } } } });
  const offset = await clock.getClockOffsetSeconds();
  assert.ok(offset >= 6 && offset <= 8);
});

// ---------------------------------------------------------------- accessory: nothing existing changes

function makeAccessory(extra) {
  const published = [];
  const api = {
    hap,
    platformAccessory: PlatformAccessory,
    on() {},
    publishExternalAccessories(_plugin, accessories) { published.push(...accessories); },
  };
  const platform = { api, log: quietLog, kDefaultPullInterval: 60000 };
  const config = { name: 'Front Door', ipAddress: '127.0.0.1', password: 'x', streamUser: 'u', streamPassword: 'p', disableStreaming: true, ...extra };
  const camera = new CameraAccessory(platform, config);
  camera.camera.getBasicInfo = async () => ({ device_info: 'D235', mac: 'AA', sw_version: '1' });
  camera.camera.getStatus = async () => ({});
  camera.setupPolling = () => {};
  camera.startPresenceSources = () => {};
  return { camera, published };
}

const services = (accessory) => accessory.services
  .map((s) => `${s.UUID}/${s.subtype ?? ''}`)
  .sort();

test('accessory: same ID and same existing services; new sensors only when turned on', async () => {
  const before = makeAccessory({});
  await before.camera.setup();
  const after = makeAccessory({
    enableMotionPresenceSensor: true,
    enablePersonSensor: true,
    enableDoorbellSensor: true,
    enableLightSensor: true,
  });
  await after.camera.setup();

  const a = before.published[0];
  const b = after.published[0];
  assert.equal(a.UUID, hap.uuid.generate('Front Door'), 'ID still comes from the camera name');
  assert.equal(b.UUID, a.UUID);
  assert.equal(b.category, a.category);

  const oldServices = services(a);
  const newServices = services(b);
  for (const s of oldServices) {
    assert.ok(newServices.includes(s), `existing service kept: ${s}`);
  }
  const added = newServices.filter((s) => !oldServices.includes(s));
  const occupancy = hap.Service.OccupancySensor.UUID;
  assert.ok(oldServices.includes(`${hap.Service.MotionSensor.UUID}/motion`), 'motion sensor present');
  assert.deepEqual(added, [
    `${occupancy}/presence-doorbell`,
    `${occupancy}/presence-light`,
    `${occupancy}/presence-motion`,
    `${occupancy}/presence-person`,
  ]);
});

test('accessory: video settings only change when the new options are set', () => {
  const plain = makeAccessory({}).camera.getVideoConfig();
  assert.equal(plain.vcodec, 'copy');
  assert.equal(plain.mapaudio, '0:a:0 -af aresample=async=16000');
  assert.equal(plain.videoFilter, undefined);
  assert.equal(plain.encoderOptions, undefined);

  const x264 = makeAccessory({ videoCodec: 'libx264' }).camera.getVideoConfig();
  assert.equal(x264.encoderOptions, '-preset ultrafast -tune zerolatency -profile:v baseline -level:v 3.1 -g 30');

  const enhanced = makeAccessory({ videoEnhance: true, audioVolume: 300, audioNoiseReduction: 'light' }).camera.getVideoConfig();
  assert.equal(enhanced.vcodec, 'libx264');
  assert.ok(enhanced.encoderOptions.includes('-profile:v high'));
  assert.ok(enhanced.videoFilter.startsWith('hqdn3d'));
  assert.ok(enhanced.mapaudio.includes('volume=3.00'));
  assert.ok(enhanced.source.startsWith('-rtsp_transport udp -i rtsp://'));

  const hw = makeAccessory({ videoEnhance: true, videoCodec: 'h264_videotoolbox' }).camera.getVideoConfig();
  assert.equal(hw.vcodec, 'h264_videotoolbox', 'a chosen hardware codec is kept');
});
