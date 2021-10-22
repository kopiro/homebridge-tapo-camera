# homebridge-tapo-camera

Add your TP-Link security camera to Homebridge.

It exposes the camera video feed and two accessories to control privacy mode and alarm.


#### Video Feed

![IMG_0793](https://user-images.githubusercontent.com/839700/138455588-a0754e1c-2d85-4f3f-a5cf-8e2468236c1f.PNG)

#### Accessories

![IMG_0794](https://user-images.githubusercontent.com/839700/138455583-8a5f74e7-057d-457d-8efd-789d9976ddd7.PNG)


## Installation

```
npm -g install homebridge-tapo-camera
```

### Configuration

- `__HEX_PASSWORD__` is the password used to connect to camera by the app; I've not been able to understand
  how they encode it, therefore you need a TCP dump and understand what's yours.
- `__STREAM_USER__` and `__STREAM_PASSWORD__` are the credentials you can set for the RSTP stream in the app

```json
"platforms": [
	{
	"platform": "TAPO-CAMERA",
	"cameras": [
		{
			"name": "TAPO Adamo",
			"ipAddress": "192.168.0.178",
			"password": "__HEX_PASSWORD__",
			"pullInterval": 60000,
			"streamPassword": "__STREAM_PASSWORD__",
			"streamUser": "__STREAM_USER__"
		}
	]
	}
]
```
