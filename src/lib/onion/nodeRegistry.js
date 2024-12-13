/**
 * Node discovery and management for browser-based onion routing
 * Handles peer discovery and validation through WebSocket signaling
 */

import { NodeRole } from './types';
import { NodeStatus } from './types';
import { CONNECTION_CONSTANTS } from './constants';

import { LayeredEncryption } from './crypto';
import { SimpleEventEmitter } from './eventEmitter';


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
    this.status = NodeStatus.WAITING;  // Start in WAITING state

    // Get role from URL parameters and validate against NodeRole enum
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    this.role = Object.values(NodeRole).includes(urlRole) ? urlRole : NodeRole.RELAY;
    console.log('[Node Registry] Initialized with role:', this.role, 'from URL param:', urlRole);

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
          this.registerAsNode(this.role);
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
    console.log('[Node Registry] Updating network metrics');
    const connectedNodes = Array.from(this.nodes.values());

    // Always include local node in metrics if it exists
    const localNode = this.getLocalNode();
    if (localNode && !connectedNodes.some(node => node.nodeId === localNode.nodeId)) {
      connectedNodes.push(localNode);
    }

    const metrics = {
      totalNodes: connectedNodes.length,
      activeNodes: connectedNodes.filter(node =>
        node.status === NodeStatus.AVAILABLE ||
        node.status === NodeStatus.WAITING ||
        node.nodeId === this.localNodeId
      ).length,
      waitingNodes: connectedNodes.filter(node => node.status === NodeStatus.WAITING).length,
      availableNodes: connectedNodes.filter(node => node.status === NodeStatus.AVAILABLE).length
    };

    console.log('[Node Registry] Network metrics:', metrics);
    this.eventEmitter.emit('metricsUpdated', metrics);
    return metrics;
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
   * @param {NodeRole} role - The role this node should take
   * @returns {Promise<void>}
   */
  async registerAsNode(role = null) {
    console.log('[Node Registry] Starting node registration process');

    // Clear any existing registration state
    clearTimeout(this.registrationTimeout);

    // Set up registration timeout
    this.registrationTimeout = setTimeout(() => {
      console.log('[Node Registry] Registration timeout reached');
      this.attemptReconnection();
    }, 30000);

    // Set up WebSocket connection handler
    const onOpen = () => {
      console.log('[Node Registry] WebSocket connection established');
      clearTimeout(this.registrationTimeout);
    };

    // Prepare node announcement
    const announcement = {
      type: 'NODE_ANNOUNCEMENT',
      nodeId: this.localNodeId,
      role: role || this.selectInitialRole(),
      status: NodeStatus.WAITING,
      timestamp: Date.now()
    };

    // Add local node to registry immediately
    this.nodes.set(this.localNodeId, {
      nodeId: this.localNodeId,
      role: announcement.role,
      status: NodeStatus.WAITING,
      lastSeen: Date.now()
    });

    // Update metrics to include local node
    this.updateNetworkMetrics();

    // Set up discovery interval
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }

    this.discoveryInterval = setInterval(() => {
      if (this.signaling && this.signaling.readyState === WebSocket.OPEN) {
        console.log('[Node Registry] Running node discovery');
        this.discoverNodes();

        // Send status update
        const statusUpdate = {
          type: 'STATUS_UPDATE',
          nodeId: this.localNodeId,
          status: this.status,
          role: this.role,
          timestamp: Date.now()
        };

        this.signaling.send(JSON.stringify(statusUpdate));
        this.updateNetworkMetrics();
      }
    }, 5000);

    // Send initial announcement
    if (this.signaling && this.signaling.readyState === WebSocket.OPEN) {
      console.log('[Node Registry] Sending node announcement');
      this.signaling.send(JSON.stringify(announcement));
    }

    return announcement;
  }

  /**
   * Handle incoming node announcements
   * @param {Object} data Node announcement data
   */
  async handleNodeAnnouncement(data) {
    console.log(`[Node Announcement] Received from ${data.nodeId.slice(0, 8)}`);

    if (data.nodeId === this.localNodeId) {
      console.log('[Node Announcement] Ignoring announcement from self');
      return;
    }

    try {
      // Add or update node in registry
      const node = {
        nodeId: data.nodeId,
        role: data.role,
        status: data.status || 'WAITING',
        lastSeen: Date.now()
      };

      // Store node in registry
      this.nodes.set(data.nodeId, node);
      console.log(`[Node Announcement] Added/updated node ${data.nodeId.slice(0, 8)}`);

      // Emit node registered event
      this.eventEmitter.emit('nodeRegistered', data.nodeId);

      // Update network metrics
      this.updateNetworkMetrics();

      // Send validation response
      await this.validateNode(data.nodeId);
    } catch (error) {
      console.error('[Node Announcement] Error handling announcement:', error);
    }
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
      node.role = data.role || node.role;  // Preserve or update role
      node.lastSeen = Date.now();
      console.log(`[Node Status] Updated node ${data.nodeId} status to ${data.status}, role: ${node.role}`);
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
   * Discover and validate other nodes in the network
   * @returns {Promise<Array>} List of connected nodes
   */
  async discoverNodes() {
    console.log('[Node Registry] Starting node discovery');

    // Get local node info
    const localNode = {
      nodeId: this.localNodeId,
      role: this.role,
      status: this.status,
      lastSeen: Date.now()
    };

    // Update local node in registry
    this.nodes.set(this.localNodeId, localNode);

    // Prepare discovery announcement
    const announcement = {
      type: 'DISCOVERY_REQUEST',
      nodeId: this.localNodeId,
      role: this.role,
      status: this.status,
      timestamp: Date.now()
    };

    // Send discovery request
    if (this.signaling && this.signaling.readyState === WebSocket.OPEN) {
      console.log('[Node Registry] Sending discovery request');
      this.signaling.send(JSON.stringify(announcement));
    }

    // Filter and update active nodes
    const activeNodes = Array.from(this.nodes.values()).filter(node => {
      const isRecent = (Date.now() - node.lastSeen) < 30000; // 30 second timeout
      if (!isRecent) {
        console.log(`[Node Registry] Removing stale node ${node.nodeId}`);
        this.nodes.delete(node.nodeId);
      }
      return isRecent;
    });

    console.log(`[Node Registry] Active nodes: ${activeNodes.length}`);
    this.updateNetworkMetrics();

    return activeNodes;
  }

  /**
   * Validate a specific node's capabilities and reliability
   * @param {string} nodeId - ID of the node to validate
   * @returns {Promise<boolean>} Whether the node is valid and reliable
   */
  async validateNode(nodeId) {
    try {
      console.log(`[Node Validation] Validating node ${nodeId}`);
      const validation = {
        type: 'NODE_VALIDATION',
        nodeId: this.localNodeId,
        targetId: nodeId,
        timestamp: Date.now()
      };

      if (this.signaling?.readyState === WebSocket.OPEN) {
        this.signaling.send(JSON.stringify(validation));

        // Wait for validation response with increased timeout
        const isValid = await new Promise((resolve) => {
          const handler = (event) => {
            const response = JSON.parse(event.data);
            if (response.type === 'NODE_VALIDATION_RESPONSE' && response.nodeId === nodeId) {
              this.signaling.removeEventListener('message', handler);
              // Update node status to AVAILABLE if validation passes
              const node = this.nodes.get(nodeId);
              if (node) {
                node.status = NodeStatus.AVAILABLE;
                this.updateNetworkMetrics();
              }
              resolve(true);
            }
          };
          this.signaling.addEventListener('message', handler);
          // Increased timeout to 10 seconds but keep node in WAITING state
          setTimeout(() => {
            this.signaling.removeEventListener('message', handler);
            const node = this.nodes.get(nodeId);
            if (node && node.status === NodeStatus.WAITING) {
              resolve(true); // Consider WAITING nodes as valid for connection
            } else {
              resolve(false);
            }
          }, 10000);
        });

        return isValid;
      }
      return false;
    } catch (error) {
      console.error(`[Node Validation] Error validating node ${nodeId}:`, error);
      return false;
    }
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
    const TEST_SIZE = 1024 * 256; // 256KB

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
   * Update node status
   * @private
   * @param {string} status - New status
   */
  async updateStatus(status) {
    const prevStatus = this.status;
    this.status = status;

    // Create local node info for status update
    const localNode = {
      id: this.nodeId,
      role: this.role,
      status: status,
      capabilities: await this.evaluateNodeCapabilities()
    };

    // Broadcast status update to other nodes
    const statusUpdate = {
      type: 'STATUS_UPDATE',
      node: localNode
    };

    if (this.signaling && this.signaling.readyState === WebSocket.OPEN) {
      this.signaling.send(JSON.stringify(statusUpdate));
    }

    // Update metrics immediately when status changes
    if (prevStatus !== status) {
      console.log('[Status Update] Local node status changed:', prevStatus, '->', status);
      this.updateNetworkMetrics();
    }

    // Emit local status update event
    this.eventEmitter.emit('statusUpdate', status);

    return status;
  }

  /**
   * Get suitable relay nodes for circuit building
   * @param {number} numHops - Number of hops needed
   * @returns {Promise<Array>} Array of suitable relay nodes
   */
  async getSuitableRelays(numHops = 3) {
    // Get all available nodes with acceptable performance
    const validated = Array.from(this.nodes.values())
      .filter(node =>
        node.status === NodeStatus.AVAILABLE &&
        this.hasAcceptableLatency(node) &&
        this.meetsReliabilityThreshold(node)
      );

    if (validated.length < numHops) {
      console.warn(`[Node Registry] Insufficient relay nodes (${validated.length}/${numHops} needed)`);
      return [];
    }

    // Group nodes by role
    const nodesByRole = validated.reduce((acc, node) => {
      acc[node.role] = acc[node.role] || [];
      acc[node.role].push(node);
      return acc;
    }, {});

    // Sort each role group by performance score
    Object.values(nodesByRole).forEach(nodes => {
      nodes.sort((a, b) => this.calculateNodeScore(b.capabilities) - this.calculateNodeScore(a.capabilities));
    });

    // Select nodes ensuring role diversity
    const selected = [];
    const roles = [NodeRole.ENTRY, NodeRole.RELAY, NodeRole.EXIT];

    for (let i = 0; i < numHops; i++) {
      const role = roles[Math.min(i, roles.length - 1)];
      const availableNodes = nodesByRole[role] || [];

      if (availableNodes.length === 0) {
        console.warn(`[Node Registry] No available nodes for role ${role}`);
        return [];
      }

      selected.push(availableNodes.shift());
    }

    return selected;
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
   * Get the local node's information
   * @returns {Object} Local node information
   */
  getLocalNode() {
    return {
      nodeId: this.localNodeId,
      role: this.role,
      status: this.status,
      lastSeen: Date.now()
    };
  }

  /**
   * Select initial role for this node
   * @private
   * @returns {NodeRole} Selected role
   */
  selectInitialRole() {
    // Return the role that was set during initialization
    console.log('[Node Registry] Using initialized role:', this.role);
    return this.role;
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
