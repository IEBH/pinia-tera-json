import { nanoid } from 'nanoid';
import { defineStore, PiniaPluginContext, StateTree, Store } from 'pinia';

/**
 * @constant {boolean}
 * @description Debug mode flag for logging
 */
const DEBUG = true;

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
 * @constant {TeraPluginConfig}
 * @description Default configuration for the TERA sync plugin
 */
const DEFAULT_CONFIG: TeraPluginConfig = {
  keyPrefix: '',
  isSeparateStateForEachUser: false,
  autoSaveIntervalMinutes: 10,
  showInitialAlert: true,
  enableSaveHotkey: true
};

/**
 * @enum {string}
 * @description Save status states
 */
enum SAVE_STATUS {
  SAVED = 'Saved',
  UNSAVED = 'Unsaved changes',
  SAVING = 'Saving...'
}

/**
 * @interface TeraInstance
 * @description Interface for TERA Vue instance properties
 */
interface TeraInstance {
  getUser: () => Promise<{ id: string }>;
  getProjectFileContents: (fileName: string, options: { format: string }) => Promise<any>;
  setProjectFileContents: (fileName: string, content: any, options: { format: string }) => Promise<void>;
  uiProgress: (options: any) => Promise<void>;
  createProjectFile?: (fileName: string) => Promise<void>;
  setProjectState?: (path: string, value: any) => Promise<void>;
  project?: {
    id?: string;
    temp?: Record<string, any>;
  };
}

/**
 * @interface VueInstance
 * @description Interface for Vue instance with TERA properties
 */
interface VueInstance {
  $tera: TeraInstance;
  $notify?: (options: { title: string, message: string, type: string, duration: number, showClose: boolean }) => void;
}

/**
 * Debug logging utility function
 * @param {...any} args - Arguments to log
 */
const debugLog = (...args: any[]): void => {
  if (DEBUG) console.log('[TERA File Sync]:', ...args);
};

/**
 * Error logging utility function
 * @param {Error} error - The error object
 * @param {string} context - Context description for the error
 */
const logError = (error: Error, context: string): void => {
  console.error(`[TERA File Sync] ${context}:`, error);
};

/**
 * Validates the plugin configuration
 * @param {TeraPluginConfig} config - The configuration to validate
 * @throws {Error} If configuration is invalid
 */
const validateConfig = (config: TeraPluginConfig): void => {
  if (typeof config.keyPrefix !== 'string') {
    throw new Error('keyPrefix must be a string');
  }

  if (typeof config.isSeparateStateForEachUser !== 'boolean') {
    throw new Error('isSeparateStateForEachUser must be a boolean');
  }

  if (typeof config.autoSaveIntervalMinutes !== 'number' || config.autoSaveIntervalMinutes < 0) {
    throw new Error('autoSaveIntervalMinutes must be a non-negative number');
  }

  if (typeof config.showInitialAlert !== 'boolean') {
    throw new Error('showInitialAlert must be a boolean');
  }

  if (typeof config.enableSaveHotkey !== 'boolean') {
    throw new Error('enableSaveHotkey must be a boolean');
  }
};

/**
 * Validates the Vue instance has required TERA properties
 * @param {VueInstance} instance - The Vue instance to validate
 * @throws {Error} If Vue instance is invalid
 */
const validateVueInstance = (instance: VueInstance | null): void => {
  if (!instance) {
    throw new Error('Vue instance is required');
  }

  if (!instance.$tera) {
    throw new Error('Vue instance must have $tera property');
  }

  if (typeof instance.$tera.getUser !== 'function') {
    throw new Error('$tera.getUser must be a function');
  }

  if (typeof instance.$tera.getProjectFileContents !== 'function') {
    throw new Error('$tera.getProjectFileContents must be a function');
  }

  if (typeof instance.$tera.setProjectFileContents !== 'function') {
    throw new Error('$tera.setProjectFileContents must be a function');
  }

  if (typeof instance.$tera.uiProgress !== 'function') {
    throw new Error('$tera.uiProgress must be a function');
  }
};

/**
 * Converts Maps and Sets to plain objects and arrays for serialization
 * @param {any} item - The item to convert
 * @returns {any} The converted item
 */
const mapSetToObject = (item: any): any => {
  try {
    if (item instanceof Map) {
      debugLog('Converting Map to object');
      const obj: Record<string | number, any> = { __isMap: true };
      item.forEach((value, key) => {
        obj[key as string | number] = mapSetToObject(value);
      });
      return obj;
    }

    if (item instanceof Set) {
      debugLog('Converting Set to array');
      return {
        __isSet: true,
        values: Array.from(item).map(mapSetToObject)
      };
    }

    if (Array.isArray(item)) {
      return item.map(mapSetToObject);
    }

    if (item && typeof item === 'object' && !(item instanceof Date)) {
      const obj: Record<string, any> = {};
      Object.entries(item).forEach(([key, value]) => {
        obj[key] = mapSetToObject(value);
      });
      return obj;
    }

    return item;
  } catch (error) {
    logError(error as Error, 'mapSetToObject conversion failed');
    return item;
  }
};

/**
 * Converts serialized objects back to Maps and Sets
 * @param {any} obj - The object to convert
 * @returns {any} The converted object with Maps and Sets restored
 */
const objectToMapSet = (obj: any): any => {
  try {
    if (!obj || typeof obj !== 'object' || obj instanceof Date) {
      return obj;
    }

    if ('__isMap' in obj) {
      debugLog('Converting object back to Map');
      const map = new Map();
      Object.entries(obj).forEach(([key, value]) => {
        if (key !== '__isMap') {
          map.set(key, objectToMapSet(value));
        }
      });
      return map;
    }

    if ('__isSet' in obj) {
      debugLog('Converting array back to Set');
      return new Set((obj.values as any[]).map(objectToMapSet));
    }

    if (Array.isArray(obj)) {
      return obj.map(objectToMapSet);
    }

    const newObj: Record<string, any> = {};
    Object.entries(obj).forEach(([key, value]) => {
      newObj[key] = objectToMapSet(value);
    });
    return newObj;
  } catch (error) {
    logError(error as Error, 'objectToMapSet conversion failed');
    return obj;
  }
};

/**
 * Shows an alert notification to the user
 * @param {string} message - The message to display
 */
const showNotification = (message: string): void => {
  if (typeof window !== 'undefined' && window.alert) {
    window.alert(message);
  } else {
    debugLog('Alert would be shown:', message);
  }
};

/**
 * @interface SyncStoreState
 * @description State interface for the sync status store
 */
interface SyncStoreState {
  saveStatus: SAVE_STATUS;
}

/**
 * @class TeraFileSyncPlugin
 * @description Plugin class for syncing Pinia store state with TERA JSON files
 */
class TeraFileSyncPlugin {
  private config: TeraPluginConfig;
  private initialized: boolean;
  private teraReady: boolean;
  private vueInstance: VueInstance | null;
  private userId: string | null;
  private saveInProgress: boolean;
  private autoSaveInterval: number | null;
  private saveStatus: SAVE_STATUS;
  private hasShownInitialAlert: boolean;
  private keydownHandler: (event: KeyboardEvent) => void;
  private beforeUnloadHandler: (event: BeforeUnloadEvent) => string | undefined;
  private syncStatusStore: Store | null;

  /**
   * @constructor
   * @param {TeraPluginConfig} [config=DEFAULT_CONFIG] - Plugin configuration
   * @throws {Error} If configuration is invalid
   */
  constructor(config: TeraPluginConfig = DEFAULT_CONFIG) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    validateConfig(mergedConfig);

    this.config = mergedConfig;
    this.initialized = false;
    this.teraReady = false;
    this.vueInstance = null;
    this.userId = null;
    this.saveInProgress = false;
    this.autoSaveInterval = null;
    this.saveStatus = SAVE_STATUS.SAVED;
    this.hasShownInitialAlert = false;
    this.keydownHandler = this.handleKeyDown.bind(this);
    this.beforeUnloadHandler = this.handleBeforeUnload.bind(this);
    this.syncStatusStore = null;
  }

  /**
   * Handle keyboard events for the Ctrl+S hotkey
   * @param {KeyboardEvent} event - The keyboard event
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Check for Ctrl+S (Windows/Linux) or Command+S (Mac)
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault(); // Prevent the browser's save dialog
      debugLog('Ctrl+S hotkey detected, saving state');
      this.saveAllStores().then(success => {
        if (success) {
          debugLog('Save completed via hotkey');
        }
      });
    }
  }

  /**
   * Handles the beforeunload event to warn users about unsaved changes.
   * @param {BeforeUnloadEvent} event - The beforeunload event.
   * @returns {string | undefined} - The message to show in the confirmation dialog, if any.
   */
  private handleBeforeUnload(event: BeforeUnloadEvent): string | undefined {
    if (this.saveStatus === SAVE_STATUS.UNSAVED) {
      const message = 'You have unsaved changes. Are you sure you want to leave?';
      event.returnValue = message; // Standard for most browsers
      return message; // For some older browsers
    }
    return undefined;
  }

  /**
   * Register the keyboard event listener for hotkeys
   */
  private registerHotkeys(): void {
    if (!this.config.enableSaveHotkey) {
      debugLog('Save hotkey disabled in configuration');
      return;
    }

    debugLog('Registering Ctrl+S hotkey');
    if (typeof window !== 'undefined') {
      // Remove any existing handler to prevent duplicates
      window.removeEventListener('keydown', this.keydownHandler);
      // Add the event listener
      window.addEventListener('keydown', this.keydownHandler);
    }
  }

  /**
   * Remove the keyboard event listener
   */
  private unregisterHotkeys(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keydownHandler);
      debugLog('Unregistered hotkeys');
    }
  }

  /**
   * Registers the beforeunload event listener.
   */
  private registerBeforeUnload(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
      debugLog('Registered beforeunload listener');
    }
  }

  /**
   * Unregisters the beforeunload event listener.
   */
  private unregisterBeforeUnload(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      debugLog('Unregistered beforeunload listener');
    }
  }

  /**
   * Show initial alert about manual saving
   */
  private showInitialAlert(): void {
    if (this.config.showInitialAlert && !this.hasShownInitialAlert) {
      this.hasShownInitialAlert = true;
      const message = "This tool no longer automatically saves progress, please use Ctrl+S to save progress";

      // Use Vue notification system if available
      if (this.vueInstance && this.vueInstance.$notify) {
        this.vueInstance.$notify({
          title: 'Important',
          message,
          type: 'warning',
          duration: 10000,
          showClose: true
        });
      } else {
        // Fallback to regular alert with a short delay to ensure it shows after UI loads
        setTimeout(() => {
          showNotification(message);
        }, 1000);
      }

      debugLog('Showed initial manual save alert');
    }
  }

  /**
   * Updates the save status in the store
   * @param {SAVE_STATUS} status - The new save status
   */
  private updateSaveStatus(status: SAVE_STATUS): void {
    if (!this.syncStatusStore) return;

    debugLog(`Updating save status: ${status}`);
    this.saveStatus = status;

    // Update the status in the Pinia store
    (this.syncStatusStore as any).updateSaveStatus(status);
  }

  /**
   * Gets the storage key for the current user
   * @async
   * @returns {Promise<string>} The storage key
   * @throws {Error} If unable to get user ID when separate state is enabled
   */
  private async getStorageKey(): Promise<string> {
    if (this.config.isSeparateStateForEachUser) {
      if (!this.userId && this.vueInstance) {
        try {
          const user = await this.vueInstance.$tera.getUser();
          this.userId = user.id;
          debugLog('User ID initialized:', this.userId);
        } catch (error) {
          logError(error as Error, 'Failed to get user ID');
          throw error;
        }
      }
      return `${this.config.keyPrefix}-${this.userId}`;
    }
    return `${this.config.keyPrefix}`;
  }

  /**
   * Gets the storage file name for the current user
   * @async
   * @returns {Promise<string>} The storage file name
   * @throws {Error} If unable to get user ID when separate state is enabled
   */
  private async getStorageFileName(): Promise<string> {
    if (!this.vueInstance || !this.vueInstance.$tera || !this.vueInstance.$tera.project) {
      console.warn("Error getting fileStorageName: vueInstance, $tera or $tera.project missing:", this.vueInstance?.$tera);
      throw new Error("Missing vueInstance.$tera.project");
    }

    if (!this.vueInstance.$tera.project.temp) {
      console.warn("Error getting fileStorageName: $tera.project.temp missing:", this.vueInstance.$tera.project);
      console.warn("Creating $tera.project.temp...");
      // Create temp object if it doesn't exist
      this.vueInstance.$tera.project.temp = {};
    }

    if (!this.vueInstance.$tera.project.id) {
      console.warn("Error getting fileStorageName: $tera.project.id missing:", this.vueInstance.$tera.project);
      throw new Error("Missing vueInstance.$tera.project.id");
    }

    const key = await this.getStorageKey();
    let fileStorageName = this.vueInstance.$tera.project.temp[key];

    if (!fileStorageName) {
      debugLog("No existing file for project/tool, creating one");
      fileStorageName = `data-${this.config.keyPrefix}-${nanoid()}.json`;

      if (typeof this.vueInstance.$tera.createProjectFile === 'function') {
        await this.vueInstance.$tera.createProjectFile(fileStorageName);
      } else {
        throw new Error("createProjectFile function not available");
      }

      if (typeof this.vueInstance.$tera.setProjectState === 'function') {
        await this.vueInstance.$tera.setProjectState(`temp.${key}`, fileStorageName);
      } else {
        throw new Error("setProjectState function not available");
      }
    }

    if (typeof fileStorageName !== 'string') {
      throw new Error(`fileStorageName is not a string: ${fileStorageName}`);
    }

    const fullFileStoragePath = `${this.vueInstance.$tera.project.id}/${fileStorageName}`;
    return fullFileStoragePath;
  }

  /**
   * Loads state from JSON file
   * @async
   * @returns {Promise<StateTree|null>} The loaded state or null if file not found
   */
  private async loadStateFromFile(): Promise<StateTree | null> {
    try {
      const fileName = await this.getStorageFileName();
      debugLog(`Loading state from file: ${fileName}`);

      if (!fileName) {
        console.warn('No file name returned when expected!');
        return null;
      }

      const encodedFileName = btoa(fileName);

      if (!this.vueInstance) throw new Error("Vue instance is null");

      const fileContent = await this.vueInstance.$tera.getProjectFileContents(encodedFileName, { format: 'json' });
      if (!fileContent) {
        debugLog('File not found or empty');
        return null;
      }

      // Update last saved state for change tracking
      this.updateSaveStatus(SAVE_STATUS.SAVED);

      debugLog('State loaded from file successfully:', fileContent);
      return fileContent;
    } catch (error) {
      if ((error as Error).message && (error as Error).message.includes('not found')) {
        debugLog('State file not found, will be created on first save');
        return null;
      }
      logError(error as Error, 'Failed to load state from file');
      return null;
    }
  }

  /**
   * Saves state to JSON file
   * @async
   * @param {StateTree} state - The state to save
   * @returns {Promise<boolean>} Whether the save was successful
   */
  private async saveStateToFile(state: StateTree): Promise<boolean> {
    if (this.saveInProgress) {
      debugLog('Save already in progress, skipping');
      return false;
    }

    try {
      this.saveInProgress = true;
      this.updateSaveStatus(SAVE_STATUS.SAVING);

      if (!this.vueInstance) throw new Error("Vue instance is null");

      // Show loading progress
      await this.vueInstance.$tera.uiProgress({ title: 'Saving tool data', backdrop: 'static' });

      const fileName = await this.getStorageFileName();

      if (!fileName) {
        throw new Error('No fileName returned');
      }

      const encodedFileName = btoa(fileName);

      const stateToSave = mapSetToObject(state);

      await this.vueInstance.$tera.setProjectFileContents(encodedFileName, stateToSave, { format: 'json' });

      // Update last saved state reference after successful save
      this.updateSaveStatus(SAVE_STATUS.SAVED);

      debugLog(`State saved to file: ${fileName}`);
      return true;
    } catch (error) {
      logError(error as Error, 'Failed to save state to file');
      this.updateSaveStatus(SAVE_STATUS.UNSAVED);
      return false;
    } finally {
      this.saveInProgress = false;
      // Hide loading progress
      if (this.vueInstance) {
        await this.vueInstance.$tera.uiProgress(false);
      }
    }
  }

  /**
   * Save all stores
   * @async
   * @returns {Promise<boolean>} Whether all saves were successful
   */
  private async saveAllStores(): Promise<boolean> {
    // Collect all store states
    const allState: StateTree = {};

    // Get all stores that have been tracked
    const trackedStores = (window as any).__pinia?._s;

    if (!trackedStores) {
      debugLog('No stores found to save');
      return false;
    }

    // Merge all store states into one object
    trackedStores.forEach((store: Store, id: string) => {
      // Skip our internal sync status store
      if (id === 'tera-file-sync-status') return;

      allState[id] = { ...store.$state };
    });

    debugLog('Saving state for all stores:', Object.keys(allState));
    return await this.saveStateToFile(allState);
  }

  /**
   * Initialize all stores from loaded state
   * @async
   * @param {StateTree} loadedState - The loaded state
   */
  private async initializeStores(loadedState: StateTree): Promise<void> {
    if (!loadedState) return;

    // Get all stores that have been registered
    const trackedStores = (window as any).__pinia?._s;

    if (!trackedStores) {
      debugLog('No stores found to initialize');
      return;
    }

    // Update each store with its corresponding state
    Object.entries(loadedState).forEach(([storeId, storeState]) => {
      const store = trackedStores.get(storeId);
      if (store) {
        // Convert any serialized Maps/Sets back to their original form
        const parsedState = objectToMapSet(storeState);
        // Reset the store with the loaded state
        store.$patch({ ...parsedState });
        debugLog(`Initialized store ${storeId} with loaded state`);
      }
    });
  }

  /**
   * Sets up automatic saving on a timer
   */
  private setupAutoSave(): void {
    if (this.config.autoSaveIntervalMinutes <= 0) {
      debugLog('Auto-save disabled');
      return;
    }

    // Clear any existing interval
    if (this.autoSaveInterval !== null) {
      window.clearInterval(this.autoSaveInterval);
    }

    const intervalMs = this.config.autoSaveIntervalMinutes * 60 * 1000;
    debugLog(`Setting up auto-save every ${this.config.autoSaveIntervalMinutes} minutes`);

    this.autoSaveInterval = window.setInterval(() => {
      if (this.saveStatus !== SAVE_STATUS.SAVED) {
        debugLog('Auto-save triggered');
        this.saveAllStores();
      } else {
        debugLog('Auto-save skipped - no changes detected');
      }
    }, intervalMs);
  }

  /**
   * Sets up change tracking for all Pinia stores
   */
  private setupStateChangeTracking(): void {
    // Get Pinia instance
    const pinia = (window as any).__pinia;

    if (!pinia) {
      console.warn('Pinia instance not found for change tracking');
      return;
    }

    // Subscribe to store changes globally using Pinia's built-in mechanism
    pinia.use(({ store }: { store: Store }) => {
      // Skip our own status store to avoid circular updates
      if (store.$id === 'tera-file-sync-status') return;

      // Subscribe to state changes
      store.$subscribe(() => {
        if (this.saveStatus !== SAVE_STATUS.SAVING) {
          this.updateSaveStatus(SAVE_STATUS.UNSAVED);
        }
      });
    });
  }

  /**
   * Creates the sync status store
   */
  private createSyncStatusStore(): void {
    // Define a Pinia store for sync status
    const useSyncStatusStore = defineStore('tera-file-sync-status', {
      state: (): SyncStoreState => ({
        saveStatus: SAVE_STATUS.SAVED
      }),
      actions: {
        updateSaveStatus(status: SAVE_STATUS) {
          this.saveStatus = status;
        }
      }
    });

    // Create the store instance
    const pinia = (window as any).__pinia;
    if (pinia) {
      this.syncStatusStore = useSyncStatusStore(pinia);
    } else {
      console.warn('Pinia instance not found, sync status store not created');
    }
  }

  /**
   * Initializes the plugin state and setup
   * @async
   */
  private async initialize(): Promise<void> {
    if (!this.teraReady || !this.vueInstance || !this.vueInstance.$tera) {
      debugLog('TERA not ready, skipping initialization');
      return;
    }

    // Show loading
    if (typeof this.vueInstance.$tera.uiProgress !== 'function') {
      console.warn('Not showing loading because uiProgress is not a function');
    } else {
      await this.vueInstance.$tera.uiProgress({ title: 'Loading tool data', backdrop: 'static' });
    }

    try {
      // Create our sync status store
      this.createSyncStatusStore();

      // Set up change tracking for all stores
      this.setupStateChangeTracking();

      // Try to load from file
      const fileData = await this.loadStateFromFile();
      if (fileData) {
        // Initialize all stores with the loaded data
        await this.initializeStores(fileData);
        debugLog('Stores initialized from file data');
        this.updateSaveStatus(SAVE_STATUS.SAVED);
      } else {
        debugLog('No existing data found, using default store states');
        this.updateSaveStatus(SAVE_STATUS.UNSAVED);
      }

      this.initialized = true;

      // Hide loading
      if (typeof this.vueInstance.$tera.uiProgress === 'function') {
        await this.vueInstance.$tera.uiProgress(false);
      }

      // Show initial alert about manual saving
      this.showInitialAlert();

      // Register hotkeys
      this.registerHotkeys();

      // Register the beforeunload listener
      this.registerBeforeUnload();

      // Setup auto-save
      this.setupAutoSave();

    } catch (error) {
      logError(error as Error, 'State initialization failed');
    }
  }

  /**
   * Clean up resources used by the plugin
   */
  private cleanup(): void {
    // Clear auto-save interval
    if (this.autoSaveInterval !== null) {
      window.clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    // Unregister event listeners
    this.unregisterHotkeys();
    this.unregisterBeforeUnload();

    this.initialized = false;
    this.teraReady = false;
  }

  /**
   * Creates the Pinia plugin
   * @returns {(context: PiniaPluginContext) => void} Plugin installation function
   */
  public createPlugin(): (context: PiniaPluginContext) => void {
    // Return the Pinia plugin function
    return (context: PiniaPluginContext) => {
      // This is called for each store that is created
      debugLog(`Plugin installed for store: ${context.store.$id}`);

      // Expose API on each store
      const store = context.store as Store & {
        $teraFileSync?: {
          setTeraReady: () => Promise<void>;
          setVueInstance: (instance: VueInstance) => void;
          saveState: () => Promise<boolean>;
          getSaveStatus: () => SAVE_STATUS;
          destroy: () => void;
        }
      };

      // Add our API to the store
      store.$teraFileSync = {
        /**
         * Sets the TERA ready state and triggers initial load
         * @async
         */
        setTeraReady: async (): Promise<void> => {
          validateVueInstance(this.vueInstance);
          this.teraReady = true;
          await this.initialize();
        },

        /**
         * Sets the Vue instance
         * @param {VueInstance} instance - Vue instance
         * @throws {Error} If Vue instance is invalid
         */
        setVueInstance: (instance: VueInstance): void => {
          this.vueInstance = instance;
        },

        /**
         * Manually saves all store states to file
         * @async
         * @returns {Promise<boolean>} Whether the save was successful
         */
        saveState: async (): Promise<boolean> => {
          return await this.saveAllStores();
        },

        /**
         * Gets the current save status
         * @returns {SAVE_STATUS} The current save status
         */
        getSaveStatus: (): SAVE_STATUS => {
          return this.saveStatus;
        },

        /**
         * Cleans up the plugin
         */
        destroy: (): void => {
          this.cleanup();
        }
      };
    };
  }
}

/**
 * Creates a new TERA file sync plugin for Pinia
 * @param {string} keyPrefix - Prefix for storage keys and filenames
 * @param {boolean} [isSeparateStateForEachUser=false] - Whether to maintain separate state for each user
 * @param {Partial<TeraPluginConfig>} [options={}] - Additional plugin options
 * @returns {(context: PiniaPluginContext) => void} Plugin installation function
 * @throws {Error} If parameters are invalid
 */
export const createTeraSyncPlugin = (
  keyPrefix: string,
  isSeparateStateForEachUser = false,
  options: Partial<Omit<TeraPluginConfig, 'keyPrefix' | 'isSeparateStateForEachUser'>> = {}
): ((context: PiniaPluginContext) => void) => {
  if (typeof keyPrefix !== 'string') {
    throw new Error('keyPrefix must be a string');
  }

  const config: TeraPluginConfig = {
    keyPrefix,
    isSeparateStateForEachUser,
    autoSaveIntervalMinutes: options.autoSaveIntervalMinutes ?? DEFAULT_CONFIG.autoSaveIntervalMinutes,
    showInitialAlert: options.showInitialAlert ?? DEFAULT_CONFIG.showInitialAlert,
    enableSaveHotkey: options.enableSaveHotkey ?? DEFAULT_CONFIG.enableSaveHotkey
  };

  const plugin = new TeraFileSyncPlugin(config);
  return plugin.createPlugin();
};