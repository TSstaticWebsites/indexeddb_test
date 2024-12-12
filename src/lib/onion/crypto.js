/**
 * Core cryptographic functionality for browser-based onion routing
 * Implements layered encryption similar to Tor using Web Crypto API
 */

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_ALGORITHM = 'RSA-OAEP';
const KEY_LENGTH = 2048;
const AES_KEY_LENGTH = 256;

export class LayeredEncryption {
  constructor() {
    this.crypto = window.crypto.subtle;
  }

  /**
   * Generates RSA key pairs for each layer of the circuit
   * @param {number} numLayers - Number of layers in the circuit
   * @returns {Promise<Array<CryptoKeyPair>>} Array of key pairs for each layer
   */
  async createCircuitKeys(numLayers) {
    const keys = [];
    for (let i = 0; i < numLayers; i++) {
      const keyPair = await this.crypto.generateKey(
        {
          name: KEY_ALGORITHM,
          modulusLength: KEY_LENGTH,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256'
        },
        true,
        ['encrypt', 'decrypt']
      );
      keys.push(keyPair);
    }
    return keys;
  }

  /**
   * Generates a symmetric key for data encryption
   * @returns {Promise<CryptoKey>} AES-GCM key
   */
  async generateSymmetricKey() {
    return await this.crypto.generateKey(
      {
        name: ENCRYPTION_ALGORITHM,
        length: AES_KEY_LENGTH
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts data for a specific layer using hybrid encryption
   * @param {ArrayBuffer} data - Data to encrypt
   * @param {CryptoKey} publicKey - RSA public key for the layer
   * @returns {Promise<{encryptedData: ArrayBuffer, encryptedKey: ArrayBuffer, iv: Uint8Array}>}
   */
  async encryptLayer(data, publicKey) {
    // Generate a random IV
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // Generate a symmetric key for this layer
    const symmetricKey = await this.generateSymmetricKey();

    // Encrypt the data with the symmetric key
    const encryptedData = await this.crypto.encrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv
      },
      symmetricKey,
      data
    );

    // Export the symmetric key
    const rawKey = await this.crypto.exportKey('raw', symmetricKey);

    // Encrypt the symmetric key with the layer's public key
    const encryptedKey = await this.crypto.encrypt(
      {
        name: KEY_ALGORITHM,
        hash: 'SHA-256'
      },
      publicKey,
      rawKey
    );

    return {
      encryptedData,
      encryptedKey,
      iv
    };
  }

  /**
   * Decrypts data for a specific layer
   * @param {ArrayBuffer} encryptedData - Encrypted data
   * @param {ArrayBuffer} encryptedKey - Encrypted symmetric key
   * @param {Uint8Array} iv - Initialization vector
   * @param {CryptoKey} privateKey - RSA private key for the layer
   * @returns {Promise<ArrayBuffer>} Decrypted data
   */
  async decryptLayer(encryptedData, encryptedKey, iv, privateKey) {
    // Decrypt the symmetric key
    const rawKey = await this.crypto.decrypt(
      {
        name: KEY_ALGORITHM,
        hash: 'SHA-256'
      },
      privateKey,
      encryptedKey
    );

    // Import the symmetric key
    const symmetricKey = await this.crypto.importKey(
      'raw',
      rawKey,
      ENCRYPTION_ALGORITHM,
      true,
      ['decrypt']
    );

    // Decrypt the data
    return await this.crypto.decrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv
      },
      symmetricKey,
      encryptedData
    );
  }

  /**
   * Creates an onion-encrypted message through multiple layers
   * @param {ArrayBuffer} data - Original data to encrypt
   * @param {Array<CryptoKey>} publicKeys - Array of public keys for each layer
   * @returns {Promise<{data: ArrayBuffer, keys: Array<ArrayBuffer>, ivs: Array<Uint8Array>}>}
   */
  async createOnion(data, publicKeys) {
    let currentData = data;
    const encryptedKeys = [];
    const ivs = [];

    // Encrypt through each layer, starting from the exit node
    for (let i = publicKeys.length - 1; i >= 0; i--) {
      const { encryptedData, encryptedKey, iv } = await this.encryptLayer(
        currentData,
        publicKeys[i]
      );
      currentData = encryptedData;
      encryptedKeys.unshift(encryptedKey);
      ivs.unshift(iv);
    }

    return {
      data: currentData,
      keys: encryptedKeys,
      ivs
    };
  }

  /**
   * Peels one layer of encryption from an onion-encrypted message
   * @param {ArrayBuffer} data - Encrypted data
   * @param {ArrayBuffer} encryptedKey - Encrypted symmetric key for this layer
   * @param {Uint8Array} iv - Initialization vector for this layer
   * @param {CryptoKey} privateKey - Private key for this layer
   * @returns {Promise<ArrayBuffer>} Data with one layer of encryption removed
   */
  async peelOnionLayer(data, encryptedKey, iv, privateKey) {
    return await this.decryptLayer(data, encryptedKey, iv, privateKey);
  }

  /**
   * Utility function to convert ArrayBuffer to Base64 string
   * @param {ArrayBuffer} buffer - Buffer to convert
   * @returns {string} Base64 encoded string
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    return btoa(String.fromCharCode.apply(null, bytes));
  }

  /**
   * Utility function to convert Base64 string to ArrayBuffer
   * @param {string} base64 - Base64 string to convert
   * @returns {ArrayBuffer} Decoded array buffer
   */
  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
