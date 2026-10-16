/**
 * Build-time constants.
 *
 * __BACKEND__ is true in the Vite web build (which may be deployed next to the
 * Go API) and false in the single-file build (claude.ai Artifact, offline),
 * which never probes for a server.
 */
declare const __BACKEND__: boolean;
