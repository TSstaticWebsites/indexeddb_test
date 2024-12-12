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
    this.role = this.selectInitialRole();
    this.status = NodeStatus.AVAILABLE;
    this.startTime = Date.now();
    this.successfulTransfers = 0;
    this.totalTransfers = 0;
    this.bandwidthSamples = [];
    this.lastBandwidthMeasurement = null;
    this.lastRoleRotation = Date.now();
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
   * Discover available relay nodes with enhanced anonymity properties
   * @param {NodeRole} role - Optional role to filter nodes by
   * @returns {Promise<Array<{nodeId: string, role: NodeRole, status: NodeStatus}>>}
   */
  async discoverNodes(role = null) {
    const discovery = {
      type: 'node_discovery',
      requestId: crypto.randomUUID(),
      capabilities: {
        bandwidth: this.getAvailableBandwidth(),
        latency: await this.measureLatency(),
        geolocation: await this.getApproximateLocation(),
        uptime: Date.now() - this.startTime,
        reliability: this.getReliabilityScore()
      }
    };
    this.signaling.send(JSON.stringify(discovery));

    // Wait for responses and filter nodes
    await new Promise(resolve => setTimeout(resolve, 2000));
    const now = Date.now();

    // Get active nodes and filter based on enhanced criteria
    const activeNodes = Array.from(this.nodes.entries())
      .filter(([_, node]) => {
        // Basic availability checks
        if (now - node.lastSeen > 30000) return false;
        if (role && node.role !== role) return false;

        // Enhanced anonymity checks
        if (!this.hasGeographicDiversity(node)) return false;
        if (!this.meetsReliabilityThreshold(node)) return false;
        if (!this.hasAcceptableLatency(node)) return false;

        return true;
      })
      .map(([nodeId, node]) => ({
        nodeId,
        role: node.role,
        status: node.status,
        capabilities: node.capabilities
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
   * Evaluate node capabilities for reliability and anonymity requirements
   * @private
   * @param {Object} capabilities - Node capabilities data
   * @returns {boolean} Whether the node meets minimum requirements
   */
  evaluateNodeCapabilities(capabilities) {
    const MIN_BANDWIDTH = 50 * 1024; // 50 KB/s
    const MAX_LATENCY = 1000; // 1 second
    const MIN_UPTIME = 5 * 60 * 1000; // 5 minutes
    const MIN_RELIABILITY = 0.8; // 80% success rate

    // Basic capability checks
    if (!capabilities.maxBandwidth || !capabilities.latency ||
        !capabilities.uptime || !capabilities.reliability) {
      return false;
    }

    // Verify all requirements are met
    return capabilities.maxBandwidth >= MIN_BANDWIDTH &&
           capabilities.latency <= MAX_LATENCY &&
           capabilities.uptime >= MIN_UPTIME &&
           capabilities.reliability >= MIN_RELIABILITY &&
           this.hasGeographicDiversity({ capabilities }) &&
           this.meetsReliabilityThreshold({ capabilities });
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
    // Use navigator.connection if available
    if (navigator.connection) {
      const connection = navigator.connection;
      if (connection.downlink) {
        return connection.downlink * 1024 * 1024 / 8; // Convert Mbps to Bytes/s
      }
    }
    return 1024 * 1024; // Fallback: 1 MB/s
  }

  /**
   * Get reliability score based on successful operations
   * @private
   * @returns {number} Score between 0 and 1
   */
  getReliabilityScore() {
    return this.successfulTransfers / Math.max(1, this.totalTransfers);
  }

  /**
   * Get approximate location using RTT measurements
   * @private
   * @returns {Promise<Object>} Approximate geolocation data
   */
  async getApproximateLocation() {
    // Use RTT measurements to known endpoints for coarse location
    const rttMeasurements = await Promise.all([
      this.measureLatency('us-east'),
      this.measureLatency('eu-west'),
      this.measureLatency('ap-east')
    ]);

    return {
      rttProfile: rttMeasurements,
      timestamp: Date.now()
    };
  }

  /**
   * Check if node adds geographic diversity to the network
   * @private
   * @param {Object} node - Node to check
   * @returns {boolean} Whether node adds geographic diversity
   */
  hasGeographicDiversity(node) {
    if (!node.capabilities?.geolocation) return false;

    // Compare RTT profiles to ensure nodes are geographically distributed
    const existingProfiles = Array.from(this.nodes.values())
      .filter(n => n.capabilities?.geolocation)
      .map(n => n.capabilities.geolocation.rttProfile);

    return !existingProfiles.some(profile =>
      this.isRTTProfileSimilar(profile, node.capabilities.geolocation.rttProfile)
    );
  }

  /**
   * Compare RTT profiles for similarity
   * @private
   * @param {Array} profile1 - First RTT profile
   * @param {Array} profile2 - Second RTT profile
   * @returns {boolean} Whether profiles are similar
   */
  isRTTProfileSimilar(profile1, profile2) {
    const SIMILARITY_THRESHOLD = 50; // ms
    return profile1.every((rtt, i) =>
      Math.abs(rtt - profile2[i]) < SIMILARITY_THRESHOLD
    );
  }

  /**
   * Check if node meets reliability threshold
   * @private
   * @param {Object} node - Node to check
   * @returns {boolean} Whether node is reliable
   */
  meetsReliabilityThreshold(node) {
    const MIN_RELIABILITY = 0.8;
    return node.capabilities?.reliability >= MIN_RELIABILITY;
  }

  /**
   * Check if node has acceptable latency
   * @private
   * @param {Object} node - Node to check
   * @returns {boolean} Whether node has acceptable latency
   */
  hasAcceptableLatency(node) {
    const MAX_LATENCY = 1000; // 1 second
    return node.capabilities?.latency <= MAX_LATENCY;
  }

  /**
   * Track successful transfer completion
   * @private
   */
  recordTransferSuccess() {
    this.successfulTransfers++;
    this.totalTransfers++;
  }

  /**
   * Track failed transfer
   * @private
   */
  recordTransferFailure() {
    this.totalTransfers++;
  }

  /**
   * Get reliability score based on successful operations
   * @private
   * @returns {number} Score between 0 and 1
   */
  getReliabilityScore() {
    if (this.totalTransfers === 0) return 1.0; // New nodes start with perfect score
    return this.successfulTransfers / this.totalTransfers;
  }

  /**
   * Get node uptime in milliseconds
   * @private
   * @returns {number} Uptime in milliseconds
   */
  getUptime() {
    return Date.now() - this.startTime;
  }

  /**
   * Measure available bandwidth using WebRTC data channels
   * @private
   * @returns {Promise<number>} Available bandwidth in bytes per second
   */
  async measureBandwidth() {
    const now = Date.now();

    // Only measure bandwidth every 30 seconds
    if (this.lastBandwidthMeasurement &&
        now - this.lastBandwidthMeasurement < 30000) {
      return this.bandwidthSamples[this.bandwidthSamples.length - 1] || 1024 * 1024;
    }

    try {
      // Create temporary data channel for measurement
      const pc1 = new RTCPeerConnection();
      const pc2 = new RTCPeerConnection();
      const dc1 = pc1.createDataChannel('bandwidth-test');

      // Set up connection
      pc2.ondatachannel = (event) => {
        const dc2 = event.channel;
        dc2.onmessage = (e) => {
          const endTime = performance.now();
          const duration = endTime - startTime;
          const bytesPerSecond = (TEST_SIZE / duration) * 1000;

          this.bandwidthSamples.push(bytesPerSecond);
          if (this.bandwidthSamples.length > 5) {
            this.bandwidthSamples.shift();
          }

          this.lastBandwidthMeasurement = now;
          pc1.close();
          pc2.close();
        };
      };

      // Connect peers
      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);

      // Wait for connection
      await new Promise(resolve => {
        const checkState = () => {
          if (dc1.readyState === 'open') {
            resolve();
          } else {
            setTimeout(checkState, 100);
          }
        };
        checkState();
      });

      // Send test data
      const TEST_SIZE = 1024 * 256; // 256KB
      const testData = new Uint8Array(TEST_SIZE);
      const startTime = performance.now();
      dc1.send(testData);

      // Return average of recent samples
      return this.bandwidthSamples.reduce((a, b) => a + b, 0) /
             Math.max(1, this.bandwidthSamples.length);
    } catch (error) {
      console.warn('Bandwidth measurement failed:', error);
      return 1024 * 1024; // Fallback: 1 MB/s
    }
  }

  /**
   * Update local node status and handle role rotation
   * @param {NodeStatus} status - New status
   */
  updateStatus(status) {
    this.status = status;

    // Rotate roles every 30 minutes
    const ROLE_ROTATION_INTERVAL = 30 * 60 * 1000;
    if (Date.now() - this.lastRoleRotation > ROLE_ROTATION_INTERVAL) {
      this.role = this.selectNewRole();
      this.lastRoleRotation = Date.now();
    }

    const statusUpdate = {
      type: 'node_status',
      nodeId: this.localNodeId,
      status: this.status,
      role: this.role
    };
    this.signaling.send(JSON.stringify(statusUpdate));
  }

  /**
   * Get suitable relays for circuit building with enhanced selection criteria
   * @param {number} count - Number of relays needed
   * @returns {Promise<Array<{nodeId: string, role: NodeRole}>>}
   */
  async getSuitableRelays(count) {
    // Get all available relays
    const allNodes = await this.discoverNodes();

    // Filter and sort nodes by capability score
    const validated = allNodes
      .filter(node => {
        const capabilities = this.nodes.get(node.nodeId)?.capabilities;
        return capabilities && this.evaluateNodeCapabilities(capabilities);
      })
      .sort((a, b) => {
        const capA = this.nodes.get(a.nodeId).capabilities;
        const capB = this.nodes.get(b.nodeId).capabilities;
        return this.calculateNodeScore(capB) - this.calculateNodeScore(capA);
      });

    // Ensure geographic diversity in selection
    const diverseNodes = this.ensureGeographicDiversity(validated);

    // Select nodes based on role requirements
    const selected = [];
    const roles = [NodeRole.ENTRY, ...Array(count - 2).fill(NodeRole.RELAY), NodeRole.EXIT];

    for (const requiredRole of roles) {
      const suitable = diverseNodes.filter(node =>
        node.role === requiredRole &&
        !selected.includes(node)
      );

      if (suitable.length === 0) return []; // Can't build circuit

      // Select randomly from top 3 candidates to prevent predictability
      const topCandidates = suitable.slice(0, Math.min(3, suitable.length));
      const selected_node = topCandidates[Math.floor(Math.random() * topCandidates.length)];
      selected.push(selected_node);
    }

    return selected;
  }

  calculateNodeScore(capabilities) {
    const weights = {
      bandwidth: 0.3,
      latency: 0.2,
      reliability: 0.3,
      uptime: 0.2
    };

    const scores = {
      bandwidth: Math.min(capabilities.maxBandwidth / (1024 * 1024), 1),
      latency: Math.max(0, 1 - capabilities.latency / 1000),
      reliability: capabilities.reliability,
      uptime: Math.min(capabilities.uptime / (24 * 60 * 60 * 1000), 1)
    };

    return Object.entries(weights).reduce((total, [metric, weight]) =>
      total + (scores[metric] * weight), 0);
  }

  ensureGeographicDiversity(nodes) {
    const regions = new Map();
    return nodes.filter(node => {
      const capabilities = this.nodes.get(node.nodeId)?.capabilities;
      if (!capabilities?.geolocation) return false;

      const region = this.determineRegion(capabilities.geolocation);
      if (!regions.has(region)) {
        regions.set(region, 1);
        return true;
      }

      if (regions.get(region) < 2) {
        regions.set(region, regions.get(region) + 1);
        return true;
      }

      return false;
    });
  }

  determineRegion(geolocation) {
    const [usRtt, euRtt, apRtt] = geolocation.rttProfile;

    const rtts = [
      { region: 'us', rtt: usRtt },
      { region: 'eu', rtt: euRtt },
      { region: 'ap', rtt: apRtt }
    ];

    return rtts.reduce((a, b) => a.rtt < b.rtt ? a : b).region;
  }
}
