import { PiniaPluginContext } from 'pinia';
/**
 * @interface TeraPluginConfig
 * @description Configuration for the TERA sync plugin
 */
interface TeraPluginConfig {
    /** Prefix for storage keys and filenames */
    keyPrefix: string;
    /** Whether to maintain separate state for each user */
    isSeparateStateForEachUser: boolean;
    /** Auto-save interval in minutes (0 to disable) */
    autoSaveIntervalMinutes: number;
    /** Whether to show initial alert about manual saving */
    showInitialAlert: boolean;
    /** Whether to enable Ctrl+S hotkey for saving */
    enableSaveHotkey: boolean;
}
/**
 * Creates a new TERA file sync plugin for Pinia
 * @param {string} keyPrefix - Prefix for storage keys and filenames
 * @param {boolean} [isSeparateStateForEachUser=false] - Whether to maintain separate state for each user
 * @param {Partial<TeraPluginConfig>} [options={}] - Additional plugin options
 * @returns {(context: PiniaPluginContext) => void} Plugin installation function
 * @throws {Error} If parameters are invalid
 */
export declare const createTeraSyncPlugin: (keyPrefix: string, isSeparateStateForEachUser?: boolean, options?: Partial<Omit<TeraPluginConfig, "keyPrefix" | "isSeparateStateForEachUser">>) => ((context: PiniaPluginContext) => void);
export {};
