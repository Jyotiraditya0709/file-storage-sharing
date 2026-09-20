import { config } from '../config.js';
import { LocalDiskStorageProvider } from './local.provider.js';
import { S3StorageProvider } from './s3.provider.js';
import type { StorageProvider } from './StorageProvider.js';

function build(): StorageProvider {
  if (config.storageDriver === 'local') {
    return new LocalDiskStorageProvider(config.localStoragePath);
  }
  const { accessKey, secretKey } = config.s3;
  if (!accessKey || !secretKey) {
    throw new Error('STORAGE_DRIVER=s3 requires S3_ACCESS_KEY and S3_SECRET_KEY');
  }
  return new S3StorageProvider({ ...config.s3, accessKey, secretKey });
}

export const storage: StorageProvider = build();

export { LocalDiskStorageProvider } from './local.provider.js';
export { S3StorageProvider } from './s3.provider.js';
export * from './StorageProvider.js';
