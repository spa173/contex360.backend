import { Injectable, Logger } from '@nestjs/common'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const ENCRYPTED_PREFIX = 'enc:'

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name)
  private readonly key: Buffer | null = null

  constructor() {
    const hexKey = process.env.ENCRYPTION_KEY
    if (hexKey) {
      try {
        this.key = Buffer.from(hexKey, 'hex')
        if (this.key.length !== 32) {
          this.logger.error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)')
          this.key = null
        }
      } catch {
        this.logger.error('ENCRYPTION_KEY is not valid hex')
      }
    } else {
      this.logger.warn('ENCRYPTION_KEY not set — encryption disabled. Set ENCRYPTION_KEY env var for production.')
    }
  }

  /**
   * Encrypt a plaintext string. Returns "enc:<base64>" format.
   */
  encrypt(plaintext: string): string {
    if (!this.key) return plaintext
    if (plaintext.startsWith(ENCRYPTED_PREFIX)) return plaintext

    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)

    let encrypted = cipher.update(plaintext, 'utf8', 'base64')
    encrypted += cipher.final('base64')

    const authTag = cipher.getAuthTag()

    // Format: enc:<iv>:<authTag>:<ciphertext>
    return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
  }

  /**
   * Decrypt an "enc:<base64>" string. Returns plaintext.
   * If the string is not encrypted, returns it as-is.
   */
  decrypt(ciphertext: string): string {
    if (!this.key) return ciphertext
    if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) return ciphertext

    try {
      const parts = ciphertext.slice(ENCRYPTED_PREFIX.length).split(':')
      if (parts.length !== 3) return ciphertext

      const iv = Buffer.from(parts[0], 'base64')
      const authTag = Buffer.from(parts[1], 'base64')
      const encrypted = parts[2]

      const decipher = createDecipheriv(ALGORITHM, this.key, iv)
      decipher.setAuthTag(authTag)

      let decrypted = decipher.update(encrypted, 'base64', 'utf8')
      decrypted += decipher.final('utf8')

      return decrypted
    } catch (error) {
      this.logger.error('Decryption failed — returning ciphertext as-is')
      return ciphertext
    }
  }

  /**
   * Check if a value is encrypted.
   */
  isEncrypted(value: string): boolean {
    return value.startsWith(ENCRYPTED_PREFIX)
  }

  /**
   * Generate a new ENCRYPTION_KEY (for initial setup).
   * Run once: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   */
  static generateKey(): string {
    return randomBytes(32).toString('hex')
  }
}
