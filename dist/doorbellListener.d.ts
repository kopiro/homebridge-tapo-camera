import type { Logging } from "homebridge";
/**
 * Tapo doorbells send a UDP broadcast to port 20005 every time the button is
 * pressed. The packet is not documented, so (like the Home Assistant and
 * ioBroker Tapo integrations) we treat any packet from the doorbell's IP
 * address as a press.
 *
 * One socket is shared by every camera in this Homebridge process.
 */
export declare const DOORBELL_UDP_PORT = 20005;
type PressHandler = () => void;
export declare class DoorbellListener {
    private readonly log;
    private readonly port;
    private static shared;
    static getShared(log: Logging): DoorbellListener;
    private socket;
    private readonly handlers;
    private readonly lastPress;
    constructor(log: Logging, port?: number);
    subscribe(ipAddress: string, handler: PressHandler): () => void;
    /** Called for every packet. Public so it can be tested without a network. */
    handlePacket(sourceIp: string, now?: number): void;
    private start;
    stop(): void;
}
export {};
