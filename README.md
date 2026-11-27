# homebridge-tapo-camera

Make your TP-Link TAPO security camera compatible with Homekit through Homebridge / HOOBS.

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

![photo_2021-11-23 11 57 48](https://user-images.githubusercontent.com/839700/143013358-9f6eed44-3aad-40b0-b1e5-ddc2c5bb24e4.png)

The plugin exposes the camera RTSP video feed, and toggle accessories to configure your automations.

If your video feed is not working, try to check if any of the parameters at the video config can be tuned. You can use [https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/configs](https://homebridge-plugins.github.io/homebridge-camera-ffmpeg/configs) to check if someone has already found the right values for your camera.

> [!IMPORTANT]
> ~On firmware build 230921 and higher, [please follow this guide](https://github.com/JurajNyiri/HomeAssistant-Tapo-Control/blob/main/add_camera_with_new_firmware.md) to make your camera compatible with this integration.~
> 
> **Update March 2025**
> In the Tapo app, go to "Me" (bottom right), then "Tapo Lab", then "Third-Party Compatibility", change to "On" and the integration should start working again.
> 

### Toggle accessories

- _"Eyes"_ controls the privacy mode; when it's on it means that the camera is able to see
(this is to make sure we support the command "Hey Siri, turn _on_ Camera", as this will _disable_ privacy mode).

- _"Alarm"_ switches on/off the alarm sound.

- _"Notifications"_ switches on/off the notifications sent to your TAPO app.

- _"Motion Detection"_ switches on/off the motion detection system.

- _"LED"_ switches on/off the LED.

- _"Floodlight"_ switches on/off the floodlight (only for supported cameras, opt-in via config).

An example Home automation could be:

- When leaving home, enable *Eyes, Alarm, Notifications, Motion Detection, LED*
- When arriving home:
	- If you care about your privacy, disable *Eyes* to switch on privacy mode
	- If you want the camera always on, but no notifications, just disable *Alarm* and *Notifications*

### Motion sensor

The motion detection sensor is built on top of the ONVIF protocol and it is enabled by default.

Therefore you can set up automations and Homekit can send you notification in the Home app when motion is detected.

Make sure you activate "Activity Notifications" in the "Status and Notifications" tab in the accessory.

> [!NOTE]  
> Some people may have issues resulting the plugin crashing at startup when this option is enabled. If you see an error like `Error: read ECONNRESET at TCP.onStreamRead` try to disable the motion sensor by setting `disableMotionSensorAccessory` to `true`

## Installation

You can install it via Homebridge UI or manually using:

```sh
npm -g install homebridge-tapo-camera
```

### Configuration

It is highly recommended that you use either Homebridge Config UI X or the HOOBS UI to install and configure this plugin.

#### Expose only switches and sensors

If your camera is already paired with HomeKit natively, you can use this plugin only for the TAPO controls that native HomeKit does not expose.

Set `disableStreaming` to `true` to skip the Homebridge camera stream while keeping the toggle accessories. If you also do not want the ONVIF motion sensor, set `disableMotionSensorAccessory` to `true`; in that setup, `streamUser` and `streamPassword` are not required.

```json
{
  "name": "My Camera Controls",
  "ipAddress": "192.168.0.XXX",
  "password": "your-tapo-password",
  "disableStreaming": true,
  "disableMotionSensorAccessory": true
}
```

To keep the ONVIF motion sensor enabled, provide `streamUser` and `streamPassword` from the TAPO app camera account.

#### RTSP transport

Camera streams use UDP by default. Set `rtspTransport` to `"tcp"` for a camera if UDP is unreliable on your network.

```json
{
  "name": "My Camera",
  "rtspTransport": "tcp"
}
```

#### Sound and picture

All of these are off by default, so existing setups don't change.

- `audioVolume` – sound volume in percent. `100` is normal, `400` is four times louder. Loud settings go through a limiter so they don't crackle.
- `audioNoiseReduction` – `"off"`, `"light"`, `"medium"` or `"strong"`. Removes hiss, hum and wind rumble. `"strong"` can thin out quiet voices.
- `videoEnhance` – re-encodes the video with noise reduction and High-profile H.264. Cleaner picture, mostly at night, but uses a lot more CPU. If `videoCodec` is empty or `copy`, `libx264` is used.

Picture breaking up or smearing grey is usually lost packets. Try `"rtspTransport": "tcp"` first; it costs nothing.

#### Presence sensors

Optional occupancy sensors you can use in automations. They are added to the camera; nothing existing is renamed or removed, so rooms and automations stay as they are.

| Option | Sensor is on when | Notes |
| --- | --- | --- |
| `enableMotionPresenceSensor` | the camera sees motion | Needs `streamUser` / `streamPassword` |
| `enablePersonSensor` | the camera sees a person | Turn on Person Detection in the Tapo app. Uses ONVIF person events, and the camera's event history (microSD card needed) as a backup |
| `enableDoorbellSensor` | a Tapo doorbell is pressed | Listens on UDP port 20005. In Docker, use host networking |
| `enableLightSensor` | the camera's own light is on | Checked every `lightSensorPollInterval` seconds (default 10) and right after motion |

Each has a matching `...Name` option. `presenceHoldTime` (default 30 seconds) sets how long the motion, person and doorbell sensors stay on. `eventPollInterval` (default 5 seconds, `0` to turn off) sets how often the event history is checked.

```json
{
  "name": "Front Door",
  "rtspTransport": "tcp",
  "audioVolume": 300,
  "audioNoiseReduction": "medium",
  "enablePersonSensor": true,
  "enableDoorbellSensor": true,
  "enableLightSensor": true,
  "lightSensorName": "Porch Light On"
}
```

### FFmpeg installation

The plugin should take care of installing the `ffmpeg` automatically.

> [!IMPORTANT]  
> If you're getting errors like `FFmpeg exited with code: 1 and signal: null (Error)`, please follow the instructions here on how to install [ffmpeg-for-homebridge](https://github.com/homebridge/ffmpeg-for-homebridge) binaries manually.
