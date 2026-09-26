// Resolve the repository's Deno npm imports to the installed, locked Node packages.
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('npm:')) specifier = specifier.replace(/^npm:(@[^/]+\/[^@/]+|[^@/]+)(?:@[^/]+)?(.*)$/, '$1$2');
  return nextResolve(specifier, context);
} });
