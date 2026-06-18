import {appConfig} from "./config.js";

export type LogLevel = "info" | "debug";

function isDebug(): boolean {
    return appConfig.logLevel === "debug";
}

export const log = {
    info(...args: unknown[]) {
        console.log(...args);
    },

    debug(...args: unknown[]) {
        if (isDebug()) {
            console.log("[DEBUG]", ...args);
        }
    },

    warn(...args: unknown[]) {
        console.warn(...args);
    },

    error(...args: unknown[]) {
        console.error(...args);
    },
};
