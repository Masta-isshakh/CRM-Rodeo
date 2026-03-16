/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_SESSION_CHECK_TIMEOUT_MS?: string;
	readonly VITE_DEBUG_SESSION_CHECK?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
