export interface UploadedFile {
  /** Public URL to access the file */
  url: string
  /** Storage key (path within the bucket/folder) */
  key: string
  /** Detected MIME type */
  mimeType: string
  /** File size in bytes */
  sizeBytes: number
}

export interface IStorageProvider {
  /**
   * Upload a file buffer to the storage backend.
   * Returns the public URL and metadata.
   */
  upload(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<UploadedFile>

  /**
   * Delete a file by its storage key.
   * Tolerant — does not throw if the file does not exist.
   */
  delete(key: string): Promise<void>

  /**
   * Build a deterministic, sanitized storage key.
   * Format: tenants/<tenantId>/<folder>/<yyyy-mm>/<uuid>.<ext>
   */
  buildKey(tenantId: string, folder: string, uuid: string, ext: string): string
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER')
