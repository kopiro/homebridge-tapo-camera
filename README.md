# homebridge-tapo-camera

Add your TP-Link security camera to Homebridge.

It exposes the camera video feed and two accessories to control privacy mode and alarm.

#### Video Feed

<img width="200px" src="https://user-images.githubusercontent.com/839700/138455588-a0754e1c-2d85-4f3f-a5cf-8e2468236c1f.PNG" />

#### Accessories

<img width="200px" src="https://user-images.githubusercontent.com/839700/138455583-8a5f74e7-057d-457d-8efd-789d9976ddd7.PNG" />

## Installation

You can install it via Homebridge UI or manually using:

```sh
npm -g install homebridge-tapo-camera
```

### Configuration

Add this configuration in the `platforms` key in your Homebridge configuration.

- `__IP_ADDRESS__` is the IP address of the camera in your local network; as soon you have a bridge setup, you can also fully control the camera outisde your Home.
- `__PASSWORD__` is the password of your TAPO Cloud account, the username/email is not needed.
- `__STREAM_USER__` and `__STREAM_PASSWORD__` are the credentials you set in Settings > Advanced Settings > Camera Account.

```json
{
  "platform": "TAPO-CAMERA",
  "cameras": [
    {
      "name": "Adamo",
      "ipAddress": "__IP_ADDRESS__",
      "password": "__PASSWORD__",
      "streamPassword": "__STREAM_PASSWORD__",
      "streamUser": "__STREAM_USER__",
      "pullInterval": 60000 // Optional
    }
  ]
}
```
