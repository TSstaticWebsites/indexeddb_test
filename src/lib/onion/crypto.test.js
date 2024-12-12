import { LayeredEncryption } from './crypto';

describe('LayeredEncryption', () => {
  let layeredEncryption;

  beforeEach(() => {
    layeredEncryption = new LayeredEncryption();
  });

  test('should generate circuit keys', async () => {
    const numLayers = 3;
    const keys = await layeredEncryption.createCircuitKeys(numLayers);

    expect(keys).toHaveLength(numLayers);
    keys.forEach(keyPair => {
      expect(keyPair).toHaveProperty('publicKey');
      expect(keyPair).toHaveProperty('privateKey');
    });
  });

  test('should encrypt and decrypt single layer', async () => {
    const testData = new TextEncoder().encode('test message');
    const keys = await layeredEncryption.createCircuitKeys(1);
    const { publicKey, privateKey } = keys[0];

    const { encryptedData, encryptedKey, iv } = await layeredEncryption.encryptLayer(
      testData,
      publicKey
    );

    const decrypted = await layeredEncryption.decryptLayer(
      encryptedData,
      encryptedKey,
      iv,
      privateKey
    );

    const decryptedText = new TextDecoder().decode(decrypted);
    expect(decryptedText).toBe('test message');
  });

  test('should create and peel onion encryption', async () => {
    const testData = new TextEncoder().encode('test message');
    const numLayers = 3;
    const keys = await layeredEncryption.createCircuitKeys(numLayers);
    const publicKeys = keys.map(k => k.publicKey);

    const onion = await layeredEncryption.createOnion(testData, publicKeys);

    expect(onion.keys).toHaveLength(numLayers);
    expect(onion.ivs).toHaveLength(numLayers);

    let currentData = onion.data;

    // Peel each layer
    for (let i = 0; i < numLayers; i++) {
      currentData = await layeredEncryption.peelOnionLayer(
        currentData,
        onion.keys[i],
        onion.ivs[i],
        keys[i].privateKey
      );
    }

    const finalText = new TextDecoder().decode(currentData);
    expect(finalText).toBe('test message');
  });

  test('should convert between ArrayBuffer and Base64', () => {
    const original = new TextEncoder().encode('test message');
    const base64 = layeredEncryption.arrayBufferToBase64(original);
    const converted = layeredEncryption.base64ToArrayBuffer(base64);

    expect(new TextDecoder().decode(converted)).toBe('test message');
  });
});
