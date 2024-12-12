import { NodeRegistry, NodeRole, NodeStatus } from './nodeRegistry';

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
        latency: 100
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
            latency: 100
          }
        });
      });
    }, 100);

    const relays = await nodeRegistry.getSuitableRelays(2);
    expect(relays).toHaveLength(2);
    expect(relays[0]).toHaveProperty('nodeId');
    expect(relays[0]).toHaveProperty('publicKey');
  });
});
