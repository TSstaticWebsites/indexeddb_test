import { NodeRegistry } from './nodeRegistry';
import { NodeRole, NodeStatus } from './types';

// Mock WebSocket
class MockWebSocket {
  constructor() {
    this.listeners = new Map();
    this.sent = [];
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  addEventListener(event, callback) {
    this.on(event, callback);
  }

  removeEventListener(event, callback) {
    const listeners = this.listeners.get(event) || [];
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  emit(event, data) {
    const listeners = this.listeners.get(event) || [];
    listeners.forEach(callback => callback({ data: JSON.stringify(data) }));
  }
}

describe('NodeRegistry', () => {
  let nodeRegistry;
  let mockSignaling;

  beforeEach(() => {
    mockSignaling = new MockWebSocket();
    nodeRegistry = new NodeRegistry(mockSignaling);
    jest.spyOn(global.crypto, 'randomUUID').mockReturnValue('test-node-id');
  });

  test('should register as node', async () => {
    await nodeRegistry.registerAsNode(NodeRole.RELAY);

    expect(mockSignaling.sent).toHaveLength(1);
    expect(mockSignaling.sent[0]).toMatchObject({
      type: 'node_announce',
      nodeId: 'test-node-id',
      role: NodeRole.RELAY,
      status: NodeStatus.AVAILABLE
    });
    expect(mockSignaling.sent[0].publicKey).toBeDefined();
  });

  test('should handle node announcements', async () => {
    const announcement = {
      type: 'node_announce',
      nodeId: 'other-node',
      role: NodeRole.RELAY,
      status: NodeStatus.AVAILABLE,
      publicKey: 'mock-public-key'
    };

    mockSignaling.emit('message', announcement);

    const nodes = await nodeRegistry.discoverNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      nodeId: 'other-node',
      role: NodeRole.RELAY,
      status: NodeStatus.AVAILABLE
    });
  });

  test('should validate nodes', async () => {
    const nodeId = 'test-relay';
    const announcement = {
      type: 'node_announce',
      nodeId,
      role: NodeRole.RELAY,
      status: NodeStatus.AVAILABLE,
      publicKey: 'mock-public-key'
    };

    mockSignaling.emit('message', announcement);

    const validationPromise = nodeRegistry.validateNode(nodeId);

    // Simulate validation response
    mockSignaling.emit('message', {
      type: 'node_validation_response',
      nodeId,
      targetNodeId: 'test-node-id',
      timestamp: Date.now(),
      capabilities: {
        maxBandwidth: 1024 * 1024,
        latency: 100,
        reliability: 0.9
      }
    });

    const isValid = await validationPromise;
    expect(isValid).toBe(true);
  });

  test('should handle node status updates', async () => {
    const nodeId = 'test-relay';

    // Announce node
    mockSignaling.emit('message', {
      type: 'node_announce',
      nodeId,
      role: NodeRole.RELAY,
      status: NodeStatus.AVAILABLE,
      publicKey: 'mock-public-key'
    });

    // Update status
    mockSignaling.emit('message', {
      type: 'node_status',
      nodeId,
      status: NodeStatus.BUSY
    });

    const nodes = await nodeRegistry.discoverNodes();
    const node = nodes.find(n => n.nodeId === nodeId);
    expect(node.status).toBe(NodeStatus.BUSY);
  });

  test('should get suitable relays', async () => {
    // Announce multiple nodes
    const nodes = [
      {
        nodeId: 'relay1',
        role: NodeRole.RELAY,
        status: NodeStatus.AVAILABLE,
        publicKey: 'mock-key-1'
      },
      {
        nodeId: 'relay2',
        role: NodeRole.RELAY,
        status: NodeStatus.AVAILABLE,
        publicKey: 'mock-key-2'
      }
    ];

    nodes.forEach(node => {
      mockSignaling.emit('message', {
        type: 'node_announce',
        ...node
      });
    });

    // Mock validation responses
    setTimeout(() => {
      nodes.forEach(node => {
        mockSignaling.emit('message', {
          type: 'node_validation_response',
          nodeId: node.nodeId,
          targetNodeId: 'test-node-id',
          timestamp: Date.now(),
          capabilities: {
            maxBandwidth: 1024 * 1024,
            latency: 100,
            reliability: 0.9
          }
        });
      });
    }, 100);

    const relays = await nodeRegistry.getSuitableRelays(2);
    expect(relays).toHaveLength(2);
    expect(relays[0]).toHaveProperty('nodeId');
    expect(relays[0]).toHaveProperty('publicKey');
  });

  describe('Node Role Management and Rotation', () => {
    test('should initialize with weighted role distribution', () => {
      const roles = new Array(100).fill(null).map(() => new NodeRegistry(mockSignaling).role);
      const relayCount = roles.filter(r => r === NodeRole.RELAY).length;
      const entryCount = roles.filter(r => r === NodeRole.ENTRY).length;
      const exitCount = roles.filter(r => r === NodeRole.EXIT).length;

      expect(relayCount).toBeGreaterThan(entryCount);
      expect(relayCount).toBeGreaterThan(exitCount);
      expect(entryCount + exitCount + relayCount).toBe(100);
    });

    test('should rotate roles after timeout', () => {
      jest.useFakeTimers();
      const initialRole = nodeRegistry.role;

      jest.advanceTimersByTime(31 * 60 * 1000); // 31 minutes
      nodeRegistry.updateStatus(NodeStatus.AVAILABLE);

      expect(nodeRegistry.role).not.toBe(initialRole);
      jest.useRealTimers();
    });
  });

  describe('Node Capability Evaluation', () => {
    test('should calculate node score based on multiple factors', () => {
      const capabilities = {
        maxBandwidth: 1024 * 1024, // 1 MB/s
        latency: 100, // 100ms
        reliability: 0.95,
        uptime: 12 * 60 * 60 * 1000 // 12 hours
      };

      const score = nodeRegistry.calculateNodeScore(capabilities);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    test('should enforce minimum requirements for relay selection', () => {
      const poorCapabilities = {
        maxBandwidth: 10 * 1024, // 10 KB/s
        latency: 2000, // 2s
        reliability: 0.5,
        uptime: 1 * 60 * 1000 // 1 minute
      };

      expect(nodeRegistry.evaluateNodeCapabilities(poorCapabilities)).toBeFalsy();
    });
  });

  describe('Browser-Only Implementation', () => {
    test('should use only browser-compatible APIs', () => {
      const mockRTCPeerConnection = {
        createDataChannel: jest.fn(),
        createOffer: jest.fn().mockResolvedValue({}),
        setLocalDescription: jest.fn(),
        close: jest.fn()
      };
      global.RTCPeerConnection = jest.fn().mockImplementation(() => mockRTCPeerConnection);

      expect(() => nodeRegistry.measureBandwidth()).not.toThrow();
      expect(global.RTCPeerConnection).toHaveBeenCalled();
    });

    test('should maintain anonymity through circuit building', async () => {
      const relays = await nodeRegistry.getSuitableRelays(3);

      // Verify minimum circuit length
      expect(relays.length).toBeGreaterThanOrEqual(3);

      // Verify role diversity
      const roles = relays.map(r => r.role);
      expect(roles).toContain(NodeRole.ENTRY);
      expect(roles).toContain(NodeRole.EXIT);
      expect(roles.filter(r => r === NodeRole.RELAY).length).toBeGreaterThan(0);
    });
  });
});

function getMockCapabilities(overrides = {}) {
  return {
    maxBandwidth: 500 * 1024, // 500KB/s
    latency: 100, // 100ms
    reliability: 0.9,
    uptime: 6 * 60 * 60 * 1000, // 6 hours
    ...overrides
  };
}
