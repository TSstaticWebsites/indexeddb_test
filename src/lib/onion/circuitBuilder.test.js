import { CircuitBuilder, CircuitStatus } from './circuitBuilder';
import { NodeRegistry, NodeRole, NodeStatus } from './nodeRegistry';
import { LayeredEncryption } from './crypto';

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  constructor() {
    this.dataChannels = [];
  }

  createDataChannel(label, options) {
    const channel = {
      label,
      options,
      send: jest.fn(),
      close: jest.fn(),
      onopen: null,
      onerror: null
    };
    this.dataChannels.push(channel);
    // Simulate successful connection
    setTimeout(() => channel.onopen?.(), 100);
    return channel;
  }

  close() {
    this.dataChannels.forEach(channel => channel.close());
  }
}

// Mock NodeRegistry
class MockNodeRegistry {
  async getSuitableRelays(count) {
    const relays = [];
    for (let i = 0; i < count; i++) {
      const keyPair = await crypto.subtle.generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256'
        },
        true,
        ['encrypt']
      );
      relays.push({
        nodeId: `relay-${i}`,
        publicKey: keyPair.publicKey
      });
    }
    return relays;
  }
}

describe('CircuitBuilder', () => {
  let circuitBuilder;
  let nodeRegistry;
  let layeredEncryption;

  beforeEach(() => {
    global.RTCPeerConnection = MockRTCPeerConnection;
    jest.spyOn(global.crypto, 'randomUUID')
      .mockImplementation(() => 'test-circuit-id');

    nodeRegistry = new MockNodeRegistry();
    layeredEncryption = new LayeredEncryption();
    circuitBuilder = new CircuitBuilder(nodeRegistry, layeredEncryption);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should build circuit with minimum 3 hops', async () => {
    const { circuitId, status } = await circuitBuilder.buildCircuit(2); // Try with less than minimum

    expect(circuitId).toBe('test-circuit-id');
    expect(status).toBe(CircuitStatus.READY);

    const circuit = circuitBuilder.circuits.get(circuitId);
    expect(circuit.hops).toHaveLength(3); // Should enforce minimum 3 hops
    expect(circuit.connections).toHaveLength(3);
  });

  test('should create unique data channels for each hop', async () => {
    const { circuitId } = await circuitBuilder.buildCircuit(3);
    const circuit = circuitBuilder.circuits.get(circuitId);

    circuit.connections.forEach((connection, index) => {
      expect(connection.dataChannel.label).toBe(`circuit-${circuitId}-${index}`);
      expect(connection.dataChannel.options.ordered).toBe(true);
      expect(connection.dataChannel.options.maxRetransmits).toBe(0);
    });
  });

  test('should send data through circuit with proper encryption', async () => {
    const { circuitId } = await circuitBuilder.buildCircuit(3);
    const testData = new TextEncoder().encode('test message');

    await circuitBuilder.sendThroughCircuit(circuitId, testData);

    const circuit = circuitBuilder.circuits.get(circuitId);
    const firstHopChannel = circuit.connections[0].dataChannel;

    expect(firstHopChannel.send).toHaveBeenCalled();
    const sentMessage = JSON.parse(firstHopChannel.send.mock.calls[0][0]);

    expect(sentMessage).toMatchObject({
      type: 'circuit_data',
      circuitId: 'test-circuit-id'
    });
    expect(sentMessage.data).toBeDefined(); // Base64 encrypted data
    expect(sentMessage.keys).toHaveLength(3); // One for each hop
    expect(sentMessage.ivs).toHaveLength(3); // One for each hop
  });

  test('should close circuit and clean up resources', async () => {
    const { circuitId } = await circuitBuilder.buildCircuit(3);

    await circuitBuilder.closeCircuit(circuitId);

    expect(circuitBuilder.getCircuitStatus(circuitId)).toBe(CircuitStatus.CLOSED);
    expect(circuitBuilder.circuits.has(circuitId)).toBe(false);

    const circuit = circuitBuilder.circuits.get(circuitId);
    expect(circuit).toBeUndefined();
  });

  test('should handle circuit building failure', async () => {
    // Mock getSuitableRelays to simulate failure
    nodeRegistry.getSuitableRelays = jest.fn().mockRejectedValue(
      new Error('Failed to get relays')
    );


    await expect(circuitBuilder.buildCircuit(3)).rejects.toThrow('Failed to get relays');

    const circuit = circuitBuilder.circuits.get('test-circuit-id');
    expect(circuit.status).toBe(CircuitStatus.FAILED);
  });

  test('should maintain perfect forward secrecy', async () => {
    const { circuitId } = await circuitBuilder.buildCircuit(3);
    const circuit = circuitBuilder.circuits.get(circuitId);

    // Verify unique keys for each hop
    const keySet = new Set(circuit.keys.map(key =>
      crypto.subtle.exportKey('jwk', key.publicKey)
    ));
    expect(keySet.size).toBe(3); // All keys should be unique
  });

  test('should prevent single node from knowing complete circuit', async () => {
    const { circuitId } = await circuitBuilder.buildCircuit(3);
    const circuit = circuitBuilder.circuits.get(circuitId);

    // Check establishment messages for each hop
    circuit.connections.forEach((connection, index) => {
      const dataChannel = connection.dataChannel;
      expect(dataChannel.send).toHaveBeenCalled();

      const message = JSON.parse(dataChannel.send.mock.calls[0][0]);
      if (index === 0) {
        expect(message.previousHopId).toBeUndefined();
      } else {
        expect(message.previousHopId).toBe(circuit.hops[index - 1].nodeId);
      }

      // Next hop should only be known if not exit node
      if (index < circuit.hops.length - 1) {
        expect(message.nextHopPublicKey).toBeDefined();
      } else {
        expect(message.nextHopPublicKey).toBeUndefined();
      }
    });
  });
});
