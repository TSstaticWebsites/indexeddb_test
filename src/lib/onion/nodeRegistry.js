/**
 * Node discovery and management for browser-based onion routing
 * Handles peer discovery and validation through WebSocket signaling
 */

import { NodeRole } from './types';
import { NodeStatus } from './types';
import { CONNECTION_CONSTANTS } from './constants';

// Node roles in the network
export const NodeRole = {
  ENTRY: 'ENTRY',
  RELAY: 'RELAY',
  EXIT: 'EXIT'
};

// Node status in the network
export const NodeStatus = {
  AVAILABLE: 'AVAILABLE',
  BUSY: 'BUSY',
  OFFLINE: 'OFFLINE',
  WAITING: 'WAITING'  // New status for nodes waiting for connections
};

// Constants for connection management
export const CONNECTION_CONSTANTS = {
  WAITING_PERIOD: 30000,  // 30 seconds waiting period
  MAX_RECONNECT_ATTEMPTS: 5,
  RECONNECT_BACKOFF_MS: 1000,
  MIN_NODES_REQUIRED: 2
};

export class NodeRegistry {
  constructor() {
    this.nodes = new Map();
    this.localNodeId = crypto.randomUUID();
    this.eventEmitter = new SimpleEventEmitter();
    this.crypto = new LayeredEncryption();
    this.startTime = Date.now();
    this.successfulTransfers = 0;
    this.totalTransfers = 0;
    this.bandwidthSamples = [];
    this.lastBandwidthMeasurement = null;
    this.lastRoleRotation = Date.now();
    this.wsConnected = false;  // Add connection state tracking

    // Get role from URL parameters and validate against NodeRole enum
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    this.localNodeRole = Object.values(NodeRole).includes(urlRole) ? urlRole : NodeRole.RELAY;
    console.log('[Node Registry] Initialized with role:', this.localNodeRole, 'from URL param:', urlRole);

    // Initialize WebSocket connection
    console.log(`[Node Registry] Initializing node ${this.localNodeId.slice(0, 8)}`);

    try {
      // Get base URL without trailing slash and ensure single /ws path
      const baseUrl = process.env.REACT_APP_SIGNALING_SERVER.replace(/\/ws\/?$/, '');
      const wsUrl = `${baseUrl}/ws/${this.localNodeId}`;
      console.log('Connecting to WebSocket URL:', wsUrl);
      this.signaling = new WebSocket(wsUrl);

      // Generate RSA key pair for encryption
      this.keyPairPromise = crypto.subtle.generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256'
        },
        true,
        ['encrypt', 'decrypt']
      );

      // Set up handlers after key pair is generated
      this.keyPairPromise.then(keyPair => {
        this.keyPair = keyPair;
        this.setupSignalingHandlers();
        // Register node after WebSocket connection is established
        if (this.signaling.readyState === WebSocket.OPEN) {
          this.registerAsNode(this.localNodeRole);
        }
      }).catch(error => {
        console.error('[Node Registry] Failed to generate key pair:', error);
      });
    } catch (error) {
      console.error('[Node Registry] Failed to initialize node:', error);
      throw error;
    }

    // Add event listeners for node updates with detailed logging
    this.eventEmitter.on('nodeRegistered', (nodeId) => {
      console.log(`[Node ${this.localNodeId.slice(0, 8)}] Node registered event emitted:`, nodeId);
      this.updateNetworkMetrics();
    });

    this.eventEmitter.on('nodeDisconnected', (nodeId) => {
      console.log(`[Node ${this.localNodeId.slice(0, 8)}] Node disconnected event emitted:`, nodeId);
      this.updateNetworkMetrics();
    });
  }

  /**
   * Attempts to reconnect to the signaling server with exponential backoff
   * @returns {Promise<boolean>} Success status of reconnection
   */
  async attemptReconnection() {
    let attempts = 0;
    while (attempts < CONNECTION_CONSTANTS.MAX_RECONNECT_ATTEMPTS) {
      try {
        const backoff = CONNECTION_CONSTANTS.RECONNECT_BACKOFF_MS * Math.pow(2, attempts);
        console.log(`[Reconnection] Attempt ${attempts + 1}, waiting ${backoff}ms`);
        await new Promise(resolve => setTimeout(resolve, backoff));

        const baseUrl = process.env.REACT_APP_SIGNALING_SERVER.replace(/\/ws\/?$/, '');
        const wsUrl = `${baseUrl}/ws/${this.localNodeId}`;
        this.signaling = new WebSocket(wsUrl);
        this.setupSignalingHandlers();

        // Wait for connection to establish
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Connection timeout'));
          }, 5000);

          this.signaling.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
        });

        console.log(`[Reconnection] Successfully reconnected after ${attempts + 1} attempts`);
        return true;
      } catch (error) {
        console.warn(`[Reconnection] Attempt ${attempts + 1} failed:`, error);
        attempts++;
      }
    }
    console.error('[Reconnection] Max attempts reached, giving up');
    return false;
  }

  updateNetworkMetrics() {
    const nodes = Array.from(this.nodes.values());
    const metrics = {
      totalNodes: nodes.length,
      activeNodes: nodes.filter(node => node.status === NodeStatus.WAITING || node.status === NodeStatus.AVAILABLE).length,
      waitingNodes: nodes.filter(node => node.status === NodeStatus.WAITING).length,
      readyNodes: nodes.filter(node => node.status === NodeStatus.AVAILABLE).length,
      avgLatency: this.getAvailableBandwidth(),
      avgBandwidth: this.getReliabilityScore()
    };
    this.eventEmitter.emit('metricsUpdated', metrics);
  }

  /**
   * Set up WebSocket event handlers for signaling
   */
  setupSignalingHandlers() {
    console.log(`[Signaling] Setting up handlers for node ${this.localNodeId.slice(0, 8)}`);

    this.signaling.onopen = () => {
      console.log(`[Signaling] WebSocket connected for node ${this.localNodeId.slice(0, 8)}`);
      this.wsConnected = true;  // Update connection state
      // Node registration is now handled by the constructor
    };

    this.signaling.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[Signaling] Received message type: ${data.type} from ${data.nodeId?.slice(0, 8) || 'unknown'}`);

        switch (data.type) {
          case 'NODE_ANNOUNCEMENT':
            await this.handleNodeAnnouncement(data);
            break;
          case 'NODE_STATUS':
            await this.handleNodeStatus(data);
            break;
          case 'NODE_VALIDATION':
            await this.handleNodeValidation(data);
            break;
          default:
            console.log(`[Signaling] Unhandled message type: ${data.type}`);
        }
      } catch (error) {
        console.error(`[Signaling] Error handling message:`, error);
      }
    };

    this.signaling.onclose = () => {
      console.log(`[Signaling] WebSocket closed for node ${this.localNodeId.slice(0, 8)}`);
      this.wsConnected = false;  // Update connection state
      this.attemptReconnection();
    };

    this.signaling.onerror = (error) => {
      console.error(`[Signaling] WebSocket error for node ${this.localNodeId.slice(0, 8)}:`, error);
    };
  }

  /**
   * Register this instance as a node in the network
   * @param {NodeRole} providedRole - Role override for the node
   */
  async registerAsNode(providedRole) {
    console.log(`[Node Registration] Starting registration process with WebSocket state:`, this.signaling?.readyState);
    try {
      // Wait for key pair to be generated
      if (!this.keyPair) {
        console.log('[Node Registration] Waiting for key pair generation...');
        this.keyPair = await this.keyPairPromise;
      }

      console.log(`[Node Registration] Registering as ${role} node`);

      // Use provided role or get from URL, fallback to RELAY
      const role = providedRole || this.selectInitialRole();
      console.log(`[Node Registration] Using role:`, role);

      // Set initial status to WAITING
      this.status = NodeStatus.WAITING;

      // Add local node to nodes Map
      this.nodes.set(this.localNodeId, {
        role: role,
        status: this.status,
        publicKey: this.keyPair.publicKey,
        lastSeen: Date.now()
      });

      // Emit nodeRegistered event for local node
      this.eventEmitter.emit('nodeRegistered', this.localNodeId);
      console.log(`[Node Registration] Added local node to registry:`, {
        nodeId: this.localNodeId.slice(0, 8),
        role: role,
        status: this.status
      });

      // Wait for WebSocket connection to be ready
      if (!this.signaling || this.signaling.readyState !== WebSocket.OPEN) {
        console.log('[Node Registration] WebSocket not ready, attempting to connect...');
        const baseUrl = process.env.REACT_APP_SIGNALING_SERVER || 'wss://app-bxlpryvg.fly.dev';
        const wsUrl = `${baseUrl}/ws/${this.localNodeId}`;
        console.log(`[Node Registration] Connecting to WebSocket at ${wsUrl}`);

        this.signaling = new WebSocket(wsUrl);
        this.setupSignalingHandlers();

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('WebSocket connection timeout'));
          }, 5000);

          const onOpen = () => {
            clearTimeout(timeout);
            resolve();
          };

          this.signaling.addEventListener('open', onOpen);
          this.signaling.addEventListener('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      }

      console.log(`[Node Registration] WebSocket connected, preparing announcement`);
      const announcement = {
        type: 'NODE_ANNOUNCEMENT',
        nodeId: this.localNodeId,
        role: role,
        status: NodeStatus.WAITING,
        publicKey: await crypto.subtle.exportKey(
          'spki',
          this.keyPair.publicKey
        )
      };

      console.log(`[Node Registration] Sending announcement:`, {
        nodeId: announcement.nodeId.slice(0, 8),
        role: announcement.role,
        status: announcement.status
      });

      this.signaling.send(JSON.stringify(announcement));
      console.log(`[Node Registration] Announcement sent successfully`);

      // Start waiting period with active node discovery
      console.log('[Node Registration] Starting waiting period with active discovery');
      const discoveryInterval = setInterval(async () => {
        try {
          const nodes = await this.discoverNodes();
          console.log(`[Node Discovery] Found ${nodes.length} nodes:`,
            nodes.map(n => ({ id: n.nodeId.slice(0, 8), role: n.role, status: n.status }))
          );
          this.updateNetworkMetrics();
        } catch (error) {
          console.error('[Node Discovery] Error during discovery:', error);
        }
      }, 5000);  // Check every 5 seconds

      setTimeout(() => {
        clearInterval(discoveryInterval);  // Stop discovery interval
        const connectedNodes = Array.from(this.nodes.values()).filter(
          node => node.status === NodeStatus.WAITING || node.status === NodeStatus.AVAILABLE
        ).length;

        console.log(`[Node Registration] Waiting period ended. Connected nodes: ${connectedNodes}`);
        if (connectedNodes >= CONNECTION_CONSTANTS.MIN_NODES_REQUIRED) {
          console.log('[Node Registration] Sufficient nodes joined during waiting period');
          this.updateStatus(NodeStatus.AVAILABLE);
          // Notify other nodes
          const statusUpdate = {
            type: 'NODE_STATUS',
            nodeId: this.localNodeId,
            status: NodeStatus.AVAILABLE
          };
          this.signaling.send(JSON.stringify(statusUpdate));
        } else {
          console.log('[Node Registration] Not enough nodes joined during waiting period');
          // Keep waiting for more nodes
          this.updateNetworkMetrics();
        }
      }, CONNECTION_CONSTANTS.WAITING_PERIOD);

    } catch (error) {
      console.error(`[Node Registration] Registration failed:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming node announcements
   * @private
   * @param {Object} data - Node announcement data
   */
  async handleNodeAnnouncement(data) {
    if (data.nodeId === this.localNodeId) return;

    console.log(`[Node ${this.localNodeId.slice(0, 8)}] Processing node announcement:`, {
      nodeId: data.nodeId.slice(0, 8),
      role: data.role,
      location: data.location
    });

    this.nodes.set(data.nodeId, {
      role: data.role,
      status: data.status,
      location: data.location,
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

    // Emit nodeRegistered event after successfully adding the node
    this.eventEmitter.emit('nodeRegistered', data.nodeId);

    // Update network metrics after node addition
    this.updateNetworkMetrics();
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
      this.updateNetworkMetrics();
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
    // Wait for WebSocket connection to be ready
    if (!this.signaling || this.signaling.readyState !== WebSocket.OPEN) {
      console.log('[Node Registry] Waiting for WebSocket connection to be ready...');
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('WebSocket connection timeout'));
          }, 5000);

          const checkConnection = () => {
            if (this.signaling.readyState === WebSocket.OPEN) {
              clearTimeout(timeout);
              resolve();
            } else if (this.signaling.readyState === WebSocket.CLOSED || this.signaling.readyState === WebSocket.CLOSING) {
              clearTimeout(timeout);
              reject(new Error('WebSocket connection failed'));
            } else {
              setTimeout(checkConnection, 100);
            }
          };
          checkConnection();
        });
      } catch (error) {
        console.error('[Node Registry] Failed to establish WebSocket connection:', error);
        return [];
      }
    }

    const discovery = {
      type: 'node_discovery',
      requestId: crypto.randomUUID(),
      capabilities: {
        bandwidth: this.getAvailableBandwidth(),
        latency: await this.measureLatency(),
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
      .filter(([nodeId, node]) => {
        // During waiting period, include all recently seen nodes
        if (this.status === NodeStatus.WAITING) {
          return (now - node.lastSeen <= 30000); // Include all recent nodes, including local
        }

        // Basic availability checks
        if (now - node.lastSeen > 30000) return false;
        if (role && node.role !== role) return false;

        // Enhanced anonymity checks only after waiting period
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

    console.log(`[Node Discovery] Found ${activeNodes.length} active nodes:`,
      activeNodes.map(n => ({ id: n.nodeId.slice(0, 8), role: n.role, status: n.status }))
    );

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
   * Evaluate node capabilities
   * @private
   * @returns {Object} Node capabilities
   */
  async evaluateNodeCapabilities() {
    const latency = await this.measureLatency();
    const bandwidth = this.getAvailableBandwidth();
    const reliability = this.getReliabilityScore();

    return {
      latency,
      maxBandwidth: bandwidth,
      reliability,
      timestamp: Date.now()
    };
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
   * Compare node performance profiles
   * @private
   * @param {Object} node - Node to check
   * @returns {boolean} Whether performance is acceptable
   */
  isRTTProfileSimilar(node) {
    return this.hasAcceptableLatency(node);
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

    // Update local node in Map
    const localNode = this.nodes.get(this.localNodeId);
    if (localNode) {
      localNode.status = status;
      localNode.lastSeen = Date.now();
    }

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
   * Get suitable relay nodes for circuit building
   * @private
   * @returns {Promise<Array>} Array of suitable relay nodes
   */
  async getSuitableRelays() {
    const validated = Array.from(this.nodes.values())
      .filter(node =>
        node.status === NodeStatus.AVAILABLE &&
        this.hasAcceptableLatency(node) &&
        this.meetsReliabilityThreshold(node)
      );

    if (validated.length === 0) {
      console.warn('[Node Registry] No suitable relay nodes found');
      return [];
    }

    // Sort by performance score
    const suitable = validated.sort((a, b) =>
      this.calculateNodeScore(b.capabilities) -
      this.calculateNodeScore(a.capabilities)
    );

    return suitable;
  }

  calculateNodeScore(capabilities) {
    const weights = {
      bandwidth: 0.35,
      latency: 0.35,
      reliability: 0.3
    };

    const scores = {
      bandwidth: Math.min(capabilities.maxBandwidth / (1024 * 1024), 1),
      latency: Math.max(0, 1 - capabilities.latency / 1000),
      reliability: capabilities.reliability
    };

    return Object.entries(weights).reduce((total, [metric, weight]) =>
      total + (scores[metric] * weight), 0);
  }





  /**
   * Select initial role for this node
   * @private
   * @returns {NodeRole} Selected role
   */
  selectInitialRole() {
    // Return the role that was set during initialization
    console.log('[Node Registry] Using initialized role:', this.localNodeRole);
    return this.localNodeRole;
  }

  /**
   * Select new role during rotation
   * @private
   * @returns {NodeRole} New role
   */
  selectNewRole() {
    const roles = [NodeRole.RELAY, NodeRole.ENTRY, NodeRole.EXIT];
    const currentIndex = roles.indexOf(this.role);
    return roles[(currentIndex + 1) % roles.length];
  }
}
