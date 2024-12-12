/**
 * Node discovery and management for browser-based onion routing
 * Handles peer discovery and validation through WebSocket signaling
 */

import { LayeredEncryption } from './crypto';

// Node roles in the network
export const NodeRole = {
  RELAY: 'relay',
  EXIT: 'exit',
  ENTRY: 'entry'
};

// Node status in the network
export const NodeStatus = {
  AVAILABLE: 'available',
  BUSY: 'busy',
  OFFLINE: 'offline'
};

export class NodeRegistry {
  constructor(signaling) {
    this.nodes = new Map();
    this.signaling = signaling;
    this.crypto = new LayeredEncryption();
    this.localNodeId = crypto.randomUUID();
    this.role = NodeRole.RELAY;
    this.status = NodeStatus.AVAILABLE;
    this.setupSignalingHandlers();
  }

  /**
   * Set up WebSocket message handlers for node discovery
   * @private
   */
  setupSignalingHandlers() {
    this.signaling.on('message', async (message) => {
      const data = JSON.parse(message.data);
      switch (data.type) {
        case 'node_announce':
          await this.handleNodeAnnouncement(data);
          break;
        case 'node_status':
          await this.handleNodeStatus(data);
          break;
        case 'node_validation':
          await this.handleNodeValidation(data);
          break;
      }
    });
  }

  /**
   * Register the current browser as a relay node
   * @param {NodeRole} role - Role of this node in the network
   * @returns {Promise<void>}
   */
  async registerAsNode(role = NodeRole.RELAY) {
    this.role = role;
    const keys = await this.crypto.createCircuitKeys(1);
    const announcement = {
      type: 'node_announce',
      nodeId: this.localNodeId,
      role: this.role,
      status: this.status,
      publicKey: await this.crypto.arrayBufferToBase64(
        await crypto.subtle.exportKey('spki', keys[0].publicKey)
      )
    };

    this.signaling.send(JSON.stringify(announcement));
  }

  /**
   * Handle incoming node announcements
   * @private
   * @param {Object} data - Node announcement data
   */
  async handleNodeAnnouncement(data) {
    if (data.nodeId === this.localNodeId) return;

    this.nodes.set(data.nodeId, {
      role: data.role,
      status: data.status,
      publicKey: await crypto.subtle.importKey(
        'spki',
        this.crypto.base64ToArrayBuffer(data.publicKey),
        {
          name: 'RSA-OAEP',
          hash: 'SHA-256'
        },
        true,
        ['encrypt']
      ),
      lastSeen: Date.now()
    });
  }

  /**
   * Handle node status updates
   * @private
   * @param {Object} data - Node status data
   */
  handleNodeStatus(data) {
    const node = this.nodes.get(data.nodeId);
    if (node) {
      node.status = data.status;
      node.lastSeen = Date.now();
    }
  }

  /**
   * Handle node validation requests
   * @private
   * @param {Object} data - Validation request data
   */
  async handleNodeValidation(data) {
    if (data.targetNodeId === this.localNodeId) {
      const response = {
        type: 'node_validation_response',
        nodeId: this.localNodeId,
        targetNodeId: data.nodeId,
        timestamp: Date.now(),
        status: this.status,
        capabilities: {
          maxBandwidth: this.getAvailableBandwidth(),
          latency: await this.measureLatency(data.nodeId)
        }
      };
      this.signaling.send(JSON.stringify(response));
    }
  }

  /**
   * Discover available relay nodes
   * @param {NodeRole} role - Optional role to filter nodes by
   * @returns {Promise<Array<{nodeId: string, role: NodeRole, status: NodeStatus}>>}
   */
  async discoverNodes(role = null) {
    const discovery = {
      type: 'node_discovery',
      requestId: crypto.randomUUID()
    };
    this.signaling.send(JSON.stringify(discovery));

    // Wait for responses and filter stale nodes
    await new Promise(resolve => setTimeout(resolve, 1000));
    const now = Date.now();
    const activeNodes = Array.from(this.nodes.entries())
      .filter(([_, node]) => now - node.lastSeen < 30000)
      .filter(([_, node]) => !role || node.role === role)
      .map(([nodeId, node]) => ({
        nodeId,
        role: node.role,
        status: node.status
      }));

    return activeNodes;
  }

  /**
   * Validate a specific node's capabilities and reliability
   * @param {string} nodeId - ID of the node to validate
   * @returns {Promise<boolean>} Whether the node is valid and reliable
   */
  async validateNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    const validation = {
      type: 'node_validation',
      nodeId: this.localNodeId,
      targetNodeId: nodeId,
      timestamp: Date.now()
    };
    this.signaling.send(JSON.stringify(validation));

    // Wait for validation response
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      const handler = (message) => {
        const data = JSON.parse(message.data);
        if (data.type === 'node_validation_response' &&
            data.nodeId === nodeId &&
            data.targetNodeId === this.localNodeId) {
          clearTimeout(timeout);
          this.signaling.removeEventListener('message', handler);
          resolve(this.evaluateNodeCapabilities(data.capabilities));
        }
      };
      this.signaling.addEventListener('message', handler);
    });
  }

  /**
   * Evaluate node capabilities for reliability
   * @private
   * @param {Object} capabilities - Node capabilities data
   * @returns {boolean} Whether the node meets minimum requirements
   */
  evaluateNodeCapabilities(capabilities) {
    const MIN_BANDWIDTH = 50 * 1024; // 50 KB/s
    const MAX_LATENCY = 1000; // 1 second

    return capabilities.maxBandwidth >= MIN_BANDWIDTH &&
           capabilities.latency <= MAX_LATENCY;
  }

  /**
   * Measure latency to a node
   * @private
   * @param {string} nodeId - ID of the node to measure
   * @returns {Promise<number>} Latency in milliseconds
   */
  async measureLatency(nodeId) {
    const start = Date.now();
    const ping = {
      type: 'node_ping',
      nodeId: this.localNodeId,
      targetNodeId: nodeId,
      timestamp: start
    };
    this.signaling.send(JSON.stringify(ping));

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(Infinity), 5000);
      const handler = (message) => {
        const data = JSON.parse(message.data);
        if (data.type === 'node_pong' &&
            data.nodeId === nodeId &&
            data.targetNodeId === this.localNodeId) {
          clearTimeout(timeout);
          this.signaling.removeEventListener('message', handler);
          resolve(Date.now() - start);
        }
      };
      this.signaling.addEventListener('message', handler);
    });
  }

  /**
   * Get available bandwidth for this node
   * @private
   * @returns {number} Available bandwidth in bytes per second
   */
  getAvailableBandwidth() {
    // In a real implementation, this would measure actual network conditions
    // For now, return a reasonable default
    return 1024 * 1024; // 1 MB/s
  }

  /**
   * Update local node status
   * @param {NodeStatus} status - New status
   */
  updateStatus(status) {
    this.status = status;
    const statusUpdate = {
      type: 'node_status',
      nodeId: this.localNodeId,
      status: this.status
    };
    this.signaling.send(JSON.stringify(statusUpdate));
  }

  /**
   * Get a list of suitable relay nodes for circuit building
   * @param {number} count - Number of nodes needed
   * @returns {Promise<Array<{nodeId: string, publicKey: CryptoKey}>>}
   */
  async getSuitableRelays(count) {
    const nodes = await this.discoverNodes(NodeRole.RELAY);
    const available = nodes.filter(node => node.status === NodeStatus.AVAILABLE);
    const validated = await Promise.all(
      available.map(async node => ({
        ...node,
        isValid: await this.validateNode(node.nodeId)
      }))
    );

    return validated
      .filter(node => node.isValid)
      .slice(0, count)
      .map(node => ({
        nodeId: node.nodeId,
        publicKey: this.nodes.get(node.nodeId).publicKey
      }));
  }
}
