/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_SESSION_CHECK_TIMEOUT_MS?: string;
	readonly VITE_DEBUG_SESSION_CHECK?: string;
	readonly VITE_I18N_DOM_TRANSLATE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
