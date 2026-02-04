/**
 * Provider bootstrap — registers built-in adapters.
 */

import { registerProviders } from "./registry";
import { BUILTIN_PROVIDERS } from "./builtin";

export function registerBuiltinProviders(): void {
  registerProviders(BUILTIN_PROVIDERS);
}