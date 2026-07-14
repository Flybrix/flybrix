/**
 * Per-firmware-version handler registry.
 * Ported from flybrix-common/src/serializationHandler.js (Angular factory ->
 * plain class), seeded from the descriptors bundled in @flybrix/protocol.
 */
import {
  descriptorFiles,
  descriptorVersions,
  parse,
  type HandlerLibrary,
} from '@flybrix/protocol';

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export const versionToString = (version: Version): string =>
  version.major.toString() + '.' + version.minor.toString() + '.' + version.patch.toString();

export const stringToVersion = (version: string): Version => {
  const parts = version.split('.');
  return {
    major: parseInt(parts[0], 10),
    minor: parseInt(parts[1], 10),
    patch: parseInt(parts[2], 10),
  };
};

export class SerializationHandlerRegistry {
  private handlerCache: Record<string, HandlerLibrary> = {};
  private newestVersion: Version = { major: 0, minor: 0, patch: 0 };

  /**
   * @param seedFromDescriptors when true (default), pre-populates the cache
   *   with all descriptor files bundled in @flybrix/protocol, mirroring the
   *   legacy descriptorsHandler bootstrap.
   */
  constructor(seedFromDescriptors = true) {
    if (!seedFromDescriptors) {
      return;
    }
    const reverseMap: Record<string, Version> = {};
    Object.keys(descriptorVersions).forEach((key) => {
      const vers = stringToVersion(key);
      const filename = descriptorVersions[key];
      if (filename in reverseMap) {
        this.copyHandler(vers, reverseMap[filename]);
      } else {
        this.addHandler(vers, descriptorFiles[filename]);
        reverseMap[filename] = vers;
      }
    });
  }

  private isNewerVersion(version: Version): boolean {
    if (version.major !== this.newestVersion.major) {
      return version.major > this.newestVersion.major;
    }
    if (version.minor !== this.newestVersion.minor) {
      return version.minor > this.newestVersion.minor;
    }
    return version.patch > this.newestVersion.patch;
  }

  private bumpNewest(version: Version): void {
    if (this.isNewerVersion(version)) {
      this.newestVersion = {
        major: version.major,
        minor: version.minor,
        patch: version.patch,
      };
    }
  }

  /** Parse a descriptor structure and register it under the given version. */
  addHandler(version: Version, structure: string): void {
    this.bumpNewest(version);
    this.handlerCache[versionToString(version)] = parse(structure);
  }

  /** Register an existing version's handler library under a new version. */
  copyHandler(version: Version, srcVersion: Version): void {
    this.bumpNewest(version);
    this.handlerCache[versionToString(version)] = this.handlerCache[versionToString(srcVersion)];
  }

  getHandler(firmware: string): HandlerLibrary | undefined {
    return this.handlerCache[firmware];
  }

  getNewestVersion(): Version {
    return this.newestVersion;
  }
}

/**
 * Recursively merge `source` into `target`, keeping target values where the
 * source value is null/undefined. Ported verbatim from the legacy service.
 */
export function updateFields(target: any, source: any): any {
  if (source instanceof Array) {
    return updateFieldsArray(target, source);
  } else if (source instanceof Object) {
    return updateFieldsObject(target, source);
  } else {
    return source === null || source === undefined ? target : source;
  }
}

function updateFieldsObject(target: any, source: any): any {
  const result: Record<string, any> = {};
  Object.keys(target).forEach((key) => {
    result[key] = updateFields(target[key], source[key]);
  });
  Object.keys(source).forEach((key) => {
    if (key in result) {
      return;
    }
    result[key] = updateFields(target[key], source[key]);
  });
  return result;
}

function updateFieldsArray(target: any, source: any): any {
  const length = Math.max(target.length, source.length);
  const result: any[] = [];
  for (let idx = 0; idx < length; ++idx) {
    result.push(updateFields(target[idx], source[idx]));
  }
  return result;
}
