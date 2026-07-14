/**
 * Firmware-version helpers over the bundled protocol descriptors.
 */
import type { HandlerLibrary } from './handlers.js';
import { parse } from './parser.js';
import { descriptorFiles, descriptorVersions } from './descriptors.js';

export interface ProtocolVersion {
  major: number;
  minor: number;
  patch: number;
}

export type VersionInput = string | ProtocolVersion | readonly number[];

/** Normalize a version given as "1.6.0", {major,minor,patch}, or [1, 6, 0]. */
export const versionKey = (version: VersionInput): string => {
  if (typeof version === 'string') {
    return version;
  }
  if (Array.isArray(version)) {
    return version.join('.');
  }
  const v = version as ProtocolVersion;
  return v.major + '.' + v.minor + '.' + v.patch;
};

// Descriptor files are parsed once and shared between all versions that map
// to the same file (e.g. 1.5.0 and 1.5.1 both use 1.5.txt).
const parsedByFile: Record<string, HandlerLibrary> = {};

/**
 * Returns the parsed handler library for a given firmware version, or
 * undefined if that version has no bundled descriptor.
 */
export const getHandlersForVersion = (version: VersionInput): HandlerLibrary | undefined => {
  const filename = descriptorVersions[versionKey(version)];
  if (!filename) {
    return undefined;
  }
  return (parsedByFile[filename] ??= parse(descriptorFiles[filename]));
};

/** All firmware versions with bundled descriptors, e.g. ["1.4.0", "1.5.0", ...]. */
export const supportedDescriptorVersions = (): string[] => Object.keys(descriptorVersions);

/** The newest firmware version that has a bundled descriptor. */
export const newestDescriptorVersion = (): ProtocolVersion => {
  let newest: ProtocolVersion = { major: 0, minor: 0, patch: 0 };
  for (const key of Object.keys(descriptorVersions)) {
    const [major = 0, minor = 0, patch = 0] = key.split('.').map(Number);
    const candidate = { major, minor, patch };
    if (
      candidate.major > newest.major ||
      (candidate.major === newest.major && candidate.minor > newest.minor) ||
      (candidate.major === newest.major &&
        candidate.minor === newest.minor &&
        candidate.patch > newest.patch)
    ) {
      newest = candidate;
    }
  }
  return newest;
};
