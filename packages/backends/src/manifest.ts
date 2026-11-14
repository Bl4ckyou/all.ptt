import raw from '../../../backends.json';
import type { Manifest } from './types.js';

export function loadManifest(): Manifest {
  return raw as unknown as Manifest;
}
