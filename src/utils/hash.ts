  import { sha256 } from '@noble/hashes/sha256'
  import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils'

  export function hashSha256(text: string): string {
    return bytesToHex(sha256(utf8ToBytes(text)))
  }
