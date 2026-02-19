/**
 * AJV stub for Cloudflare Workers.
 *
 * Cloudflare Workers forbid `new Function()` / `eval()` which AJV uses
 * to compile JSON-schema validators.  The pi-ai validation module
 * detects a null AJV instance and falls back to trusting the LLM output
 * directly (same behaviour as the Chrome-extension / Manifest-V3 path).
 *
 * Add this to your wrangler.toml to replace AJV at bundle time:
 *
 *   [alias]
 *   "ajv" = "node_modules/@funtuantw/pi-agent-cf/stubs/ajv.js"
 */

class Ajv {
  constructor() {
    throw new Error("AJV disabled in Cloudflare Workers (no eval/new Function support)");
  }
}

export default Ajv;
