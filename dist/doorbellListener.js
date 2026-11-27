"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoorbellListener = exports.DOORBELL_UDP_PORT = void 0;
const dgram_1 = __importDefault(require("dgram"));
/**
 * Tapo doorbells send a UDP broadcast to port 20005 every time the button is
 * pressed. The packet is not documented, so (like the Home Assistant and
 * ioBroker Tapo integrations) we treat any packet from the doorbell's IP
 * address as a press.
 *
 * One socket is shared by every camera in this Homebridge process.
 */
exports.DOORBELL_UDP_PORT = 20005;
// A single press can arrive as several packets.
const DEBOUNCE_MS = 3_000;
class DoorbellListener {
    log;
    port;
    static shared;
    static getShared(log) {
        if (!DoorbellListener.shared) {
            DoorbellListener.shared = new DoorbellListener(log);
        }
        return DoorbellListener.shared;
    }
    socket;
    handlers = new Map();
    lastPress = new Map();
    constructor(log, port = exports.DOORBELL_UDP_PORT) {
        this.log = log;
        this.port = port;
    }
    subscribe(ipAddress, handler) {
        let set = this.handlers.get(ipAddress);
        if (!set) {
            set = new Set();
            this.handlers.set(ipAddress, set);
        }
        set.add(handler);
        this.start();
        return () => {
            set?.delete(handler);
            if (set?.size === 0) {
                this.handlers.delete(ipAddress);
            }
            if (this.handlers.size === 0) {
                this.stop();
            }
        };
    }
    /** Called for every packet. Public so it can be tested without a network. */
    handlePacket(sourceIp, now = Date.now()) {
        const ip = sourceIp.replace(/^::ffff:/, "");
        const handlers = this.handlers.get(ip);
        if (!handlers) {
            this.log.debug(`Doorbell port packet from unknown device ${ip}, ignoring`);
            return;
        }
        const last = this.lastPress.get(ip) ?? 0;
        if (now - last < DEBOUNCE_MS) {
            return;
        }
        this.lastPress.set(ip, now);
        this.log.debug(`Doorbell press from ${ip}`);
        for (const handler of handlers) {
            try {
                handler();
            }
            catch (err) {
                this.log.error("Error handling doorbell press", err);
            }
        }
    }
    start() {
        if (this.socket) {
            return;
        }
        const socket = dgram_1.default.createSocket({ type: "udp4", reuseAddr: true });
        this.socket = socket;
        socket.on("message", (_msg, rinfo) => this.handlePacket(rinfo.address));
        socket.on("error", (err) => {
            this.log.error(`Doorbell listener on UDP port ${this.port} failed. Doorbell presses will not be detected.`, err);
            this.stop();
        });
        socket.on("listening", () => {
            this.log.debug(`Listening for doorbell presses on UDP port ${this.port}`);
        });
        socket.bind({ port: this.port, exclusive: false });
    }
    stop() {
        if (!this.socket) {
            return;
        }
        try {
            this.socket.close();
        }
        catch {
            // already closed
        }
        this.socket = undefined;
    }
}
exports.DoorbellListener = DoorbellListener;
//# sourceMappingURL=doorbellListener.js.map